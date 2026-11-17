import { createTaskProjection, writeProjectionAtomically } from './task-projection'
import { modTaskTreeExport } from './mod-task-tree-export'
import type { ProjectionFiles } from './task-projection'
import type { Run } from './gh'

const COMMAND_TIMEOUT_MS = 10_000

type ModProjectionFs = {
  exists(path: string): Promise<boolean>
  write(path: string, text: string): Promise<void>
  home(): Promise<string | undefined>
  now(): Promise<number>
  log(text: string): void
}

/** Claude Code's engine has no rename or exclusive-create operation, so use its process runner for both. */
export function modTaskProjection(fs: ModProjectionFs, run: Run, nonce: () => string, path: string | null) {
  const parent = (path: string) => {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '.'
  }
  const command = async (argv: string[]) => {
    const result = await run(argv, { cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `command failed: ${argv[0]}`)
  }
  const files: ProjectionFiles = {
    acquireLock: async path => {
      await command(['mkdir', '-p', '--', parent(path)])
      const lock = `${path}.lock`
      const result = await run(['mkdir', '--', lock], { cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS })
      if (result.code === 0) return true
      if (await fs.exists(lock).catch(() => false)) return false
      throw new Error(result.stderr.trim() || 'could not acquire the task projection lock')
    },
    releaseLock: path => command(['rmdir', '--', `${path}.lock`]).catch(() => undefined),
    writeAtomic: (path, text) =>
      writeProjectionAtomically(path, text, {
        write: (temporary, contents) => fs.write(temporary, contents),
        rename: async (temporary, destination) => void (await command(['mv', '-f', '--', temporary, destination])),
        remove: temporary => command(['rm', '-f', '--', temporary]),
        nonce,
      }),
  }
  const exportTree = modTaskTreeExport({ home: fs.home, now: fs.now, write: fs.write, run, nonce, log: fs.log })
  return {
    ...createTaskProjection(files, path),
    exportTree,
    exportSnapshot: (sessionId: string, session: Parameters<typeof exportTree>[2]) =>
      exportTree(sessionId, session, session),
  }
}

export type ModTaskProjection = ReturnType<typeof modTaskProjection>
