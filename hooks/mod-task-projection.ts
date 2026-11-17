import { createTaskProjection, writeProjectionAtomically } from './task-projection'
import type { ProjectionFiles } from './task-projection'
import type { Run } from './gh'

export type ModTaskProjection = ReturnType<typeof createTaskProjection>

const COMMAND_TIMEOUT_MS = 10_000

type ModProjectionFs = {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
}

/** Claude Code's engine has no rename or exclusive-create operation, so use its process runner for both. */
export function modTaskProjection(fs: ModProjectionFs, run: Run, nonce: () => string) {
  const parent = (path: string) => {
    const at = path.lastIndexOf('/')
    return at < 0 ? '.' : at === 0 ? '/' : path.slice(0, at)
  }
  const command = async (argv: string[]) => {
    const result = await run(argv, { cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `command failed: ${argv[0]}`)
    return result
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
    releaseLock: async path => {
      await run(['rmdir', '--', `${path}.lock`], { cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS }).catch(() => undefined)
    },
    read: async path => ((await fs.exists(path)) ? fs.read(path) : null),
    writeAtomic: (path, text) =>
      writeProjectionAtomically(path, text, {
        write: (temporary, contents) => fs.write(temporary, contents),
        rename: async (temporary, destination) => void (await command(['mv', '-f', '--', temporary, destination])),
        remove: async temporary =>
          void (await run(['rm', '-f', '--', temporary], { cwd: '/', timeoutMs: COMMAND_TIMEOUT_MS })),
        nonce,
      }),
  }
  return createTaskProjection(files)
}
