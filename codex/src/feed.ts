import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parseFeed, type FeedFile } from '../../hooks/feed'

export async function readFeedFiles(path?: string): Promise<{ root: string; files: FeedFile[] } | null> {
  if (!path) return null
  const root = resolve(path)
  try {
    const info = await stat(root)
    if (info.isDirectory()) {
      const files: FeedFile[] = []
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const file = join(root, entry.name)
        try {
          files.push({ path: file, feed: parseFeed(await readFile(file, 'utf8')) })
        } catch (error) {
          if (!missing(error)) files.push({ path: file, feed: null })
        }
      }
      return { root, files }
    }
    if (!info.isFile()) return null
    return { root, files: [{ path: root, feed: parseFeed(await readFile(root, 'utf8')) }] }
  } catch (error) {
    return missing(error) ? { root, files: [] } : null
  }
}

const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
