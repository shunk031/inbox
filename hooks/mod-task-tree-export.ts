import { sessionFile } from './session-files'
import { taskTreeExport, writeProjectionAtomically } from './task-projection'
import type { Run } from './gh'
import type { Session } from '../types'

export function modTaskTreeExport(deps: {
  home: () => Promise<string | undefined>
  now: () => Promise<number>
  write: (path: string, text: string) => Promise<void>
  run: Run
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
      before.taskStatusMismatches === session.taskStatusMismatches
    )
      return null
    try {
      const home = await deps.home()
      if (!home) return null
      const savedAt = await deps.now()
      const root = home.replace(/\/+$/, '')
      const path = `${root}/.local/state/inbox/task-tree/${sessionFile(sessionId)}`
      const projection = taskTreeExport(sessionId, session.taskTree, session.taskStatusMismatches, savedAt)
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
