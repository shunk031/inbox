import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

import { applyFeedFiles, MAX_FEED_FILE_BYTES } from '../../hooks/feed'
import { EMPTY } from '../../hooks/ledger'
import { readFeedFiles } from '../../feed-reader'

test('the shared feed reader stats before reading and skips files above the size cap', async () => {
  const text = JSON.stringify({ version: 1, source: 'patrol', writtenAt: 1, entries: [] })
  const reads: string[] = []
  const io = {
    resolve: (path: string) => path,
    realpath: async () => null,
    join: (root: string, name: string) => `${root}/${name}`,
    stat: async (path: string) => ({
      isDirectory: () => path === '/feed',
      isFile: () => path !== '/feed',
      size: path === '/feed/large.json' || path === '/large.json' ? MAX_FEED_FILE_BYTES + 1 : text.length,
    }),
    list: async () => ['small.json', 'large.json'].map(name => ({ name, isFile: () => true })),
    read: async (path: string) => {
      reads.push(path)
      return text
    },
  }
  const directory = await readFeedFiles('/feed', io)
  assert.deepEqual(
    directory?.files.map(f => [f.path, f.feed?.source ?? null]),
    [
      ['/feed/small.json', 'patrol'],
      ['/feed/large.json', null],
    ],
  )
  assert.deepEqual(reads, ['/feed/small.json'])
  assert.equal((await readFeedFiles('/large.json', io))?.files[0]?.feed, null)
  assert.deepEqual(reads, ['/feed/small.json'])
})

test('the feed reader skips a projection through relative, dotted and symlinked paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inbox-feed-reader-'))
  const actual = join(root, 'actual')
  const linked = join(root, 'linked')
  const projection = join(actual, 'meta-open-items.json')
  const content = JSON.stringify({
    version: 1,
    source: 'meta-open-items',
    writtenAt: 1,
    entries: [{ key: 'task-1', kind: 'task', state: 'working', title: 'Task', detail: 'Work', at: 1 }],
  })
  try {
    await mkdir(actual)
    await symlink(actual, linked, 'dir')
    await writeFile(projection, content)
    const relativeProjection = relative(process.cwd(), projection)

    for (const configured of [relativeProjection, `./${relativeProjection}`]) {
      const feed = await readFeedFiles(linked, undefined, [configured])
      assert.ok(feed)
      assert.equal(feed.skippedPaths.includes(join(linked, 'meta-open-items.json')), true)
      assert.deepEqual(applyFeedFiles(EMPTY, feed.root, feed.files, 2, feed.skippedPaths).items, [])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
