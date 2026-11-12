import { applyFeedFiles, parseFeed, type FeedFile } from './feed'
import type { Ledger } from '../types'

export function modFeedPoller(
  path: string,
  stat: (path: string) => Promise<{ kind?: string; mtimeMs: number; isLink?: boolean }>,
  list: (path: string) => Promise<{ name: string; isLink?: boolean }[]>,
  exists: (path: string) => Promise<boolean>,
  read: (path: string) => Promise<string>,
  now: () => Promise<number>,
  commit: (change: (ledger: Ledger) => Ledger) => Promise<unknown>,
): () => Promise<void> {
  let mtimes = new Map<string, number>()
  let isRunning = false
  const save = async (files: FeedFile[]) => now().then(at => commit(ledger => applyFeedFiles(ledger, path, files, at)))

  return async () => {
    if (isRunning) return
    isRunning = true
    try {
      const root = await stat(path)
      if (root.kind !== 'directory') {
        const file: FeedFile = { path, feed: undefined }
        if (root.mtimeMs !== mtimes.get(path)) {
          try {
            file.feed = parseFeed(await read(path))
            mtimes = new Map([[path, root.mtimeMs]])
          } catch {
            return
          }
        }
        await save([file])
        return
      }

      const nextMtimes = new Map<string, number>()
      const files: FeedFile[] = []
      for (const entry of await list(path)) {
        if (!entry.name.endsWith('.json') || entry.isLink) continue
        const file = `${path.replace(/[\\/]+$/, '')}/${entry.name}`
        try {
          const current = await stat(file)
          if (current.isLink || (current.kind && current.kind !== 'file')) continue
          files.push({
            path: file,
            feed: current.mtimeMs === mtimes.get(file) ? undefined : parseFeed(await read(file)),
          })
          nextMtimes.set(file, current.mtimeMs)
        } catch {
          files.push({ path: file, feed: undefined })
        }
      }
      mtimes = nextMtimes
      await save(files)
    } catch {
      if (!(await exists(path).catch(() => true))) {
        mtimes.clear()
        await save([])
      }
    } finally {
      isRunning = false
    }
  }
}
