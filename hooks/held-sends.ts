import type { Session } from '../types'
import { reopenOnFailure, withFailure, withUnconfirmed } from './press-reducer'
import { completedAttempt } from './session-presses'
import type { SendOutcome } from './session-presses'
import type { SessionHost } from './session-host'

type ReleaseHost<S extends Session> = Pick<
  SessionHost<S>,
  'now' | 'read' | 'update' | 'deliver' | 'prepare' | 'newId' | 'isDeliveryHeldUntilRun'
>
const answerPressWaits = new Set<{ id: string; wait: AbortController }>()

export function withAnswerPressWait<T>(
  action: string,
  id: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (action === 'undo') abortAnswerPressWaits(id)
  const wait = new AbortController()
  const pending = action === 'answer' ? { id, wait } : null
  if (pending) answerPressWaits.add(pending)
  return run(wait.signal).finally(() => pending && answerPressWaits.delete(pending))
}

export function abortAnswerPressWaits(id?: string): void {
  answerPressWaits.forEach(p => (!id || p.id === id) && p.wait.abort())
}

/** The rows whose held message is due: Undo can no longer take its press back. */
function dueRows(s: Session, now: number): string[] {
  return Object.entries(s.lastActions)
    .filter(([, a]) => a.delivery?.state === 'held' && a.delivery.until <= now)
    .map(([id]) => id)
}

/**
 * Sends each answer and Fix whose Undo window has passed, as its press would have sent it. Undo drops a held press
 * before this runs, so it sends nothing. A refused answer reopens its question, as a refused press does.
 */
export async function releaseHeldSends<S extends Session>(host: ReleaseHost<S>, current?: S): Promise<void> {
  const due = dueRows(current ?? (await host.read()), await host.now())
  for (const id of due) await releaseOne(host, id, false)
}

/**
 * Sends row `id`'s held message now, before Undo's window ends. A second press on the row replaces its last press, so
 * the held message goes first or it would never go.
 */
export async function releaseHeldSendEarly<S extends Session>(host: ReleaseHost<S>, id: string): Promise<void> {
  await releaseOne(host, id, true)
}

export function waitForPressWindow(
  ms: number,
  signal: AbortSignal,
  after: (ms: number, run: () => void) => { cancel: () => void },
): Promise<void> {
  return new Promise(resolve => {
    let timer: { cancel: () => void } | undefined
    const finish = () => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const abort = () => {
      timer?.cancel()
      finish()
    }
    if (signal.aborted) return finish()
    signal.addEventListener('abort', abort, { once: true })
    timer = after(ms, finish)
    if (signal.aborted) abort()
  })
}

/** Holds an Answer's live UI press through Undo, then submits it while that press still vouches for it. */
export async function releaseAnswerInPress<S extends Session>(
  host: ReleaseHost<S>,
  id: string,
  after: (ms: number, run: () => void) => { cancel: () => void },
  canDeliver: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  const delivery = (await host.read()).lastActions[id]?.delivery
  if (delivery?.state !== 'held') return
  const remaining = delivery.until - (await host.now())
  if (remaining > 0) await waitForPressWindow(remaining, signal, after)
  if (!signal.aborted && canDeliver()) await releaseHeldSendEarly(host, id)
}

/** Retries stopped-session Answer sends once a later human prompt has cleared the host's stop latch. */
export async function retryDeferredAnswers<S extends Session>(host: ReleaseHost<S>): Promise<void> {
  for (const attempt of (await host.read()).sent)
    if (attempt.phase === 'deferred' && attempt.press?.action === 'answer' && attempt.row && attempt.deliveryId)
      await releaseOne(host, attempt.row, false, attempt.deliveryId)
}

/** Marks a held row Not sent with `reason`, and reopens an answer it closed, as a refused send does. */
function refusedHeld<S extends Session>(s: S, id: string, reason: string): S {
  const last = s.lastActions[id]
  if (last?.delivery?.state !== 'held') return s

  return {
    ...s,
    lastActions: { ...s.lastActions, [id]: { ...last, delivery: { state: 'failed', reason } } },
    ledger: last.kind === 'mark' ? reopenOnFailure(s.ledger, id, last.at) : s.ledger,
  }
}

async function releaseOne<S extends Session>(
  host: ReleaseHost<S>,
  id: string,
  isEarly: boolean,
  retryId?: string,
): Promise<void> {
  let attempt: { deliveryId: string; text: string; at: number } | null = null
  const started = host.update(async s => {
    // A host may run the change again on a newer session, where Undo or another release already took the row.
    attempt = null
    const deferred = retryId && s.sent.find(s => s.deliveryId === retryId && s.row === id && s.phase === 'deferred')
    const last = s.lastActions[id]
    const held = last?.delivery
    const now = await host.now()
    if (deferred && deferred.pressedAt !== null && held?.state === 'queued' && held.id === retryId) {
      attempt = { deliveryId: retryId, text: deferred.text, at: deferred.pressedAt }
      return {
        ...s,
        sent: s.sent.map(s => (s === deferred ? { ...s, phase: 'attempting' as const } : s)),
      }
    }
    if (retryId) return s
    if (!last || held?.state !== 'held' || (held.until > now && !isEarly)) return s
    await host.prepare?.(s)
    const deliveryId = host.newId()
    attempt = { deliveryId, text: held.message, at: last.at }
    const state = host.isDeliveryHeldUntilRun ? ('queued' as const) : ('unconfirmed' as const)

    return {
      ...s,
      lastActions: { ...s.lastActions, [id]: { ...last, delivery: { state, message: held.message, id: deliveryId } } },
      sent: [
        ...s.sent,
        {
          text: held.message,
          press: held.by,
          at: now,
          row: id,
          queuedId: null,
          pressedAt: last.at,
          deliveryId,
          phase: 'attempting' as const,
        },
      ],
    }
  })
  // A host that cannot prepare the send, as a Codex with no CLI to run, refuses it before anything leaves.
  const why = await started.then(
    () => null,
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  )
  if (why !== null) {
    await host.update(s => refusedHeld(s, id, why))
    return
  }
  const sending = attempt as { deliveryId: string; text: string; at: number } | null
  if (!sending) return
  const outcome: SendOutcome = await host
    .deliver(await host.read(), sending.text, sending.deliveryId)
    .catch((err: unknown) => ({ state: 'unconfirmed', reason: err instanceof Error ? err.message : String(err) }))
  const finalOutcome =
    retryId && outcome.state === 'deferred' ? { state: 'rejected' as const, reason: outcome.reason } : outcome
  await host.update(s => {
    const after = completedAttempt(s, sending.deliveryId, finalOutcome)
    if (finalOutcome.state === 'deferred') return after
    if (finalOutcome.state === 'unconfirmed')
      return { ...after, lastActions: withUnconfirmed(after.lastActions, sending.text, sending.at, sending.deliveryId) }
    if (finalOutcome.state !== 'rejected') return after
    const lastActions = withFailure(after.lastActions, [id], sending.at, finalOutcome.reason, sending.deliveryId)
    const last = lastActions[id]
    const isRowFailed = last?.delivery?.state === 'failed' && last.delivery.id === sending.deliveryId

    return {
      ...after,
      lastActions,
      ledger: isRowFailed && last.kind === 'mark' ? reopenOnFailure(after.ledger, id, sending.at) : after.ledger,
    }
  })
}
