import { NL } from './status-limits'

/** One line of the Status call's answer. */
export type Op =
  | { kind: 'none' }
  | { kind: 'head'; title: string; description: string }
  | { kind: 'link'; ref: string; taskId: string }
  | {
      kind: 'task-mismatch'
      taskId: string
      claim: import('../types').TaskStatus
      savedStatus: import('../types').TaskStatus
    }
  | { kind: 'task-clear'; taskId: string; reason: string }
  | { kind: 'goal'; text: string }
  /** Clears an inferred goal the session's work has left, when no next goal is clear. */
  | { kind: 'retire'; why: string }

/** What the Status call answered: nothing to change, or the changes to make. */
export type StatusAnswer = { kind: 'unchanged' } | { kind: 'ops'; ops: Op[] }

const LINE =
  /^\s*[-*]?\s*(NO CHANGE|NOCHANGE|UNCHANGED|TASK-MISMATCH|TASK-CLEAR|NEW|SET|DONE|DROP|WAS|HEAD|LINK|GOAL|RETIRE|MILESTONE|SERVES)\s*(?::\s*(.*))?$/i
const IGNORED = new Set(['NEW', 'SET', 'DONE', 'DROP', 'WAS', 'MILESTONE', 'SERVES'])
const TASK_STATUSES = new Set(['working', 'queued', 'waits-on-other', 'done', 'dropped'])

function fields(value: string): string[] {
  return value.split('|').map(f => f.trim())
}

function opOf(key: string, f: string[]): Op | null {
  if (key === 'NOCHANGE' || key === 'UNCHANGED') return { kind: 'none' }
  if (key === 'HEAD') return f[0] ? { kind: 'head', title: f[0], description: f[1] ?? '' } : null
  if (key === 'LINK') return f[0] && f[1] ? { kind: 'link', ref: f[0], taskId: f[1] } : null
  if (
    key === 'TASK-MISMATCH' &&
    f.length === 3 &&
    f[0] &&
    TASK_STATUSES.has(f[1]!) &&
    TASK_STATUSES.has(f[2]!) &&
    f[1] !== f[2]
  )
    return {
      kind: 'task-mismatch',
      taskId: f[0],
      claim: f[1] as import('../types').TaskStatus,
      savedStatus: f[2] as import('../types').TaskStatus,
    }
  if (key === 'TASK-CLEAR' && f.length === 2 && f[0] && f[1]) return { kind: 'task-clear', taskId: f[0], reason: f[1] }
  if (key === 'GOAL') return f[0] ? { kind: 'goal', text: f[0] } : null
  if (key === 'RETIRE') return { kind: 'retire', why: f[0] ?? '' }

  return null
}

/** Parses Status updates; legacy subject and milestone lines are ignored as unchanged input. */
export function parseStatus(text: string | null, requireHead = false): StatusAnswer | null {
  let ignoredLegacy = false
  let ignoredTaskLine = false
  const ops = (text ?? '').split(NL).flatMap(raw => {
    const m = LINE.exec(raw.trim())
    if (!m) return []
    const key = m[1]!.toUpperCase().replace(' ', '')
    if (IGNORED.has(key)) {
      ignoredLegacy = true
      return []
    }
    const op = opOf(key, fields(m[2] ?? ''))
    if (op === null && (key === 'TASK-MISMATCH' || key === 'TASK-CLEAR')) ignoredTaskLine = true

    return op === null ? [] : [op]
  })
  if (ops.length === 0) {
    if (requireHead) return null
    return ignoredLegacy || ignoredTaskLine ? { kind: 'unchanged' } : null
  }

  if (requireHead && !ops.some(op => op.kind === 'head')) return null

  return ops.every(o => o.kind === 'none') ? { kind: 'unchanged' } : { kind: 'ops', ops }
}

/** Asks again when the answer has no recognized Status line or lacks a required HEAD. */
export async function askStatus<T extends { text: string | null }>(
  ask: () => Promise<T>,
  requireHead = false,
): Promise<{ first: T; last: T }> {
  const first = await ask()
  const isUnreadable = first.text !== null && parseStatus(first.text, requireHead) === null

  return { first, last: isUnreadable ? await ask() : first }
}
