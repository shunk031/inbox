/// <reference path="./codex/node_modules/@types/node/index.d.ts" />
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { MAX_FEED_FILE_BYTES, parseFeed, type FeedFile } from './hooks/feed'
import { createTaskProjection } from './hooks/task-projection'

type FeedReadIo = {
  resolve(path: string): string
  join(root: string, name: string): string
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>
  list(path: string): Promise<{ name: string; isFile(): boolean }[]>
  read(path: string): Promise<string>
}
const feedIo: FeedReadIo = {
  resolve,
  join,
  stat,
  list: root => readdir(root, { withFileTypes: true }),
  read: path => readFile(path, 'utf8'),
}

export async function readFeedFiles(path: string | undefined, io = feedIo) {
  if (!path) return null
  const root = io.resolve(path)
  const read = async (path: string, size: number) => ({
    path,
    feed: size > MAX_FEED_FILE_BYTES ? null : parseFeed(await io.read(path)),
  })
  try {
    const info = await io.stat(root)
    if (info.isFile()) return { root, files: [await read(root, info.size)] }
    if (!info.isDirectory()) return null
    const files: FeedFile[] = []
    for (const entry of await io.list(root)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const file = io.join(root, entry.name)
      try {
        files.push(await read(file, (await io.stat(file)).size))
      } catch (error) {
        if (!missing(error)) files.push({ path: file, feed: null })
      }
    }
    return { root, files }
  } catch (error) {
    return missing(error) ? { root, files: [] } : null
  }
}

const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'

/** The omp host's filesystem adapter for its session-scoped task projection. */
export function nodeTaskProjection() {
  return createTaskProjection({
    acquireLock: async path => {
      await mkdir(dirname(path), { recursive: true })
      try {
        await mkdir(`${path}.lock`)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
    },
    releaseLock: async path => {
      await rmdir(`${path}.lock`).catch(() => undefined)
    },
    read: async path =>
      readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      }),
    writeAtomic: async (path, text) => {
      const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`
      try {
        await writeFile(temporary, text, { flag: 'wx' })
        await rename(temporary, path)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
      }
    },
  })
}
