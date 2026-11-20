import { sessionFile } from './session-files'
import { taskTreeExport, writeProjectionAtomically } from './task-projection'
import { taskTimelineWarnings } from './session-view'
import { taskOwnerInHerdr } from './herdr'
import { observedTaskOwnerFact, taskOwnerKey } from './task-facts'
import type { Run } from './gh'
import type { Session, TaskFactWarning, TaskOwner, TaskOwnerFacts, TaskOwnerState } from '../types'

const isOwnerWarning = (warning: TaskFactWarning): warning is Extract<TaskFactWarning, { owner: TaskOwner }> =>
  warning.message === 'Owner idle 15m+' || warning.message === 'Owner finished, task open'

export function modTaskTreeExport(deps: {
  home: () => Promise<string | undefined>
  now: () => Promise<number>
  write: (path: string, text: string) => Promise<void>
  run: Run
  updateSession: (change: (session: Session) => Session) => Promise<Session>
  nonce: () => string
  log: (text: string) => void
}) {
  const reported = new Set<string>()
  const exported = new Set<string>()
  const command = async (args: string[]) => {
    const { code, stderr } = await deps.run(args, { cwd: '/', timeoutMs: 10_000 })
    if (code !== 0) throw new Error(stderr.trim() || `command failed: ${args[0]}`)
  }
  const files: Parameters<typeof writeProjectionAtomically>[2] & { mkdir(path: string): Promise<void> } = {
    mkdir: async path => command(['mkdir', '-p', '--', path]),
    write: deps.write,
    rename: async (from, to) => command(['mv', '-f', '--', from, to]),
    remove: async path => command(['rm', '-f', '--', path]),
    nonce: deps.nonce,
  }

  return async (sessionId: string, before: Session, session: Session) => {
    if (
      exported.has(sessionId) &&
      before.taskTree === session.taskTree &&
      before.taskFactWarnings === session.taskFactWarnings &&
      before.taskStatusMismatches === session.taskStatusMismatches &&
      before.taskOwnerFacts === session.taskOwnerFacts &&
      before.ledger.findings === session.ledger.findings
    )
      return null
    try {
      const home = await deps.home()
      if (!home) return null
      const savedAt = await deps.now()
      const root = home.replace(/\/+$/, '')
      const path = `${root}/.local/state/inbox/task-tree/${sessionFile(sessionId)}`
      const warnings = taskTimelineWarnings(session, session.taskTree, savedAt)
      const warnedOwners = new Map(
        warnings.filter(isOwnerWarning).map(warning => [taskOwnerKey(warning.owner), warning.owner]),
      )
      let current = session
      if (warnedOwners.size > 0) {
        const observations = await Promise.all(
          [...warnedOwners]
            .filter(([, owner]) => owner.machine === 'local')
            .map(async ([key, owner]) => [key, await taskOwnerInHerdr(owner.agent, deps.run)] as const),
        )
        const refreshed = observations.filter((entry): entry is readonly [string, TaskOwnerState] => entry[1] !== null)
        if (refreshed.length > 0) {
          const checkedAt = await deps.now().catch(() => savedAt)
          current = await deps
            .updateSession(saved => {
              const taskOwnerFacts: TaskOwnerFacts = { ...saved.taskOwnerFacts }
              for (const [key, state] of refreshed)
                taskOwnerFacts[key] = observedTaskOwnerFact(taskOwnerFacts[key], state, checkedAt)
              return { ...saved, taskOwnerFacts }
            })
            .catch(() => session)
        }
      }
      const savedAtFinal = warnedOwners.size > 0 ? await deps.now().catch(() => savedAt) : savedAt
      const finalWarnings = taskTimelineWarnings(current, current.taskTree, savedAtFinal)
      const projection = taskTreeExport(
        sessionId,
        current.taskTree,
        finalWarnings,
        current.taskStatusMismatches,
        savedAtFinal,
      )
      await writeProjectionAtomically(path, `${JSON.stringify(projection, null, 2)}\n`, files)
      exported.add(sessionId)
      return projection
    } catch {
      if (!reported.has(sessionId)) {
        reported.add(sessionId)
        deps.log('inbox: task-tree export failed; the saved task tree is available in the inbox.')
      }
      return null
    }
  }
}
