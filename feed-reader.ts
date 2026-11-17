/// <reference path="./codex/node_modules/@types/node/index.d.ts" />
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { MAX_FEED_FILE_BYTES, parseFeed, skippedFeedPaths, type FeedFile } from './hooks/feed'

type FeedReadIo = {
  resolve(path: string): string
  realpath(path: string): Promise<string | null>
  join(root: string, name: string): string
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>
  list(path: string): Promise<{ name: string; isFile(): boolean }[]>
  read(path: string): Promise<string>
}
const feedIo: FeedReadIo = {
  resolve,
  realpath: async path => realpath(path).catch(() => null),
  join,
  stat,
  list: root => readdir(root, { withFileTypes: true }),
  read: path => readFile(path, 'utf8'),
}

export async function readFeedFiles(path: string | undefined, io = feedIo, skipPaths: string[] = []) {
  if (!path) return null
  const root = io.resolve(path)
  const result = async (files: FeedFile[]) => ({
    root,
    files,
    skippedPaths: await skippedFeedPaths(files, skipPaths, io),
  })
  const read = async (path: string, size: number) => ({
    path,
    feed: size > MAX_FEED_FILE_BYTES ? null : parseFeed(await io.read(path)),
  })
  try {
    const info = await io.stat(root)
    if (info.isFile()) return result([await read(root, info.size)])
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
    return result(files)
  } catch (error) {
    return missing(error) ? result([]) : null
  }
}

const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
