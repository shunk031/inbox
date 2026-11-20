import { describe, expect, test } from 'claude-code/testing'

import {
  createTaskProjection,
  mergeProjectedTasks,
  projectedTaskEntries,
  writeProjectionAtomically,
} from '../hooks/task-projection'
import { afterTaskTreeUpdate } from '../hooks/task-projection-host'
import { runModTool } from '../hooks/mod-task-run'
import { emptySession } from '../hooks/session-files'
import type { TaskNode, TaskTree } from '../types'

const node = (id: string, status: TaskNode['status'] = 'working', changes: Partial<TaskNode> = {}): TaskNode => ({
  id,
  parentId: null,
  status,
  weight: 1,
  title: `Title ${id}`,
  detail: '',
  notes: [],
  createdAt: 1,
  updatedAt: 1,
  history: [],
  ...changes,
})

const memoryFiles = (path: string, initial?: string) => {
  const contents = new Map<string, string>()
  if (initial !== undefined) contents.set(path, initial)
  let locked = false
  const writes: string[] = []
  const reads: string[] = []
  return {
    contents,
    writes,
    reads,
    files: {
      acquireLock: async () => (locked ? false : (locked = true)),
      releaseLock: async () => void (locked = false),
      exists: async (file: string) => contents.has(file),
      read: async (file: string) => {
        reads.push(file)
        return contents.get(file) ?? null
      },
      writeAtomic: async (file: string, text: string) => {
        writes.push(file)
        contents.set(file, text)
      },
    },
  }
}

describe('task-tree projection', () => {
  test('projects every open status with the current text and owner', () => {
    const tree: TaskTree = [
      node('working', 'working', { detail: 'Latest detail', links: { owner: { agent: 'worker', machine: 'host' } } }),
      node('queued', 'queued', {
        notes: ['Newest note'],
        history: [{ at: 7, source: 'agent', kind: 'note', detail: 'Newest note' }],
      }),
      node('blocked', 'waits-on-other'),
      node('done', 'done'),
      node('dropped', 'dropped'),
    ]

    expect(projectedTaskEntries(tree)).toEqual([
      {
        key: 'working',
        kind: 'task',
        state: 'working',
        title: 'Title working',
        detail: 'Latest detail',
        at: 1,
        owner: { agent: 'worker', machine: 'host' },
      },
      { key: 'queued', kind: 'task', state: 'working', title: 'Title queued', detail: 'Newest note', at: 7 },
      { key: 'blocked', kind: 'task', state: 'blocked', title: 'Title blocked', detail: '', at: 1 },
    ])
  })

  test('writes an adjacent temporary file before renaming it into place', async () => {
    const calls: string[] = []
    await writeProjectionAtomically('/feed/meta-open-items.json', '{snapshot}', {
      nonce: () => 'unique',
      write: async path => void calls.push(`write:${path}`),
      rename: async (from, to) => void calls.push(`rename:${from}:${to}`),
      remove: async path => void calls.push(`remove:${path}`),
    })

    expect(calls).toEqual([
      'write:/feed/meta-open-items.json.unique.tmp',
      'rename:/feed/meta-open-items.json.unique.tmp:/feed/meta-open-items.json',
    ])
  })

  test('writes the current task tree and holds the lock through later writes', async () => {
    const path = '/feed/meta-open-items.json'
    const store = memoryFiles(path)
    const projection = createTaskProjection(store.files, path)
    const initial = {
      ...emptySession(),
      taskTree: [node('projected', 'waits-on-other', { detail: 'Waiting for the owner' })],
    }
    const first = await projection.sync('meta', initial, 20, change => Promise.resolve(change(initial)))

    expect(first.kind).toBe('written')
    expect(JSON.parse(store.contents.get(path)!).projected).toBe(true)
    expect(JSON.parse(store.contents.get(path)!).entries).toMatchObject([
      { key: 'projected', kind: 'task', state: 'blocked', title: 'Title projected', detail: 'Waiting for the owner' },
    ])
    if (first.kind !== 'written') return
    const second = await projection.sync('meta', first.session, 30, change => Promise.resolve(change(first.session)))
    expect(second.kind).toBe('written')
    expect(store.writes.filter(file => file === path)).toHaveLength(2)
    await projection.release('meta')
  })

  test('imports hand-written entries once, preserving existing status and text', async () => {
    const path = '/feed/meta-open-items.json'
    const original = JSON.stringify({
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      entries: [
        {
          key: 'existing',
          kind: 'task',
          state: 'done',
          title: 'Feed title',
          detail: 'Feed text',
          at: 10,
          owner: { agent: 'worker', machine: 'host' },
        },
        {
          key: 'fill-text',
          kind: 'task',
          state: 'blocked',
          title: 'Unused title',
          detail: 'Imported missing text',
          at: 11,
          owner: { agent: 'worker', machine: 'host' },
        },
        {
          key: 'new-blocked',
          kind: 'work',
          state: 'blocked',
          title: 'New title',
          detail: 'New text',
          at: 12,
          owner: { agent: 'worker', machine: 'host' },
        },
      ],
    })
    const store = memoryFiles(path, original)
    const projection = createTaskProjection(store.files, path)
    let session = {
      ...emptySession(),
      taskTree: [
        node('existing', 'queued', { title: 'Tree title', detail: 'Keep this text' }),
        node('fill-text', 'working'),
      ],
    }
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const first = await afterTaskTreeUpdate(projection, 'meta', session, 20, save)

    expect(first.session.taskTreeProjectionVersion).toBe(1)
    expect(first.session.taskTree).toMatchObject([
      {
        id: 'existing',
        status: 'queued',
        title: 'Tree title',
        detail: 'Keep this text',
        links: { owner: { agent: 'worker' } },
      },
      { id: 'fill-text', status: 'working', detail: 'Imported missing text' },
      { id: 'new-blocked', status: 'waits-on-other', title: 'New title', detail: 'New text' },
    ])
    expect(store.contents.get(`${path}.pre-projection`)).toBe(original)
    expect(JSON.parse(store.contents.get(path)!).projected).toBe(true)

    await afterTaskTreeUpdate(projection, 'meta', first.session, 30, save)
    expect(store.reads).toEqual([path])
    expect(store.writes.filter(file => file === `${path}.pre-projection`)).toHaveLength(1)
    expect(session.taskTree.filter(task => task.id === 'new-blocked')).toHaveLength(1)
    await projection.release('meta')
  })

  test('a pruned id cannot return through the one-time feed import or next projection', async () => {
    const path = '/feed/meta-open-items.json'
    const old =
      '{"version":1,"source":"meta-open-items","writtenAt":10,"entries":[{"key":"removed","kind":"task","state":"working","title":"Old task","detail":"","at":10,"owner":{"agent":"worker","machine":"host"}}]}'
    const store = memoryFiles(path, old)
    const owner = { id: 'meta', generation: 0 }
    let session = {
      ...emptySession(),
      taskTree: Array.from({ length: 21 }, (_, i) => node(i === 0 ? 'removed' : `r${i}`, 'done', { updatedAt: i })),
    }
    await runModTool(
      {
        now: async () => 100,
        owner: () => owner,
        preview: async input => input,
        commit: async (_owner, change) => (session = change(session)),
        refused: () => false,
        projection: null,
        savePersonLine: async () => undefined,
      },
      'tasks',
      { operation: 'add', task_id: 'next', title: 'Next task' },
      undefined,
      true,
      false,
    )
    const projection = createTaskProjection(store.files, path)
    const result = await afterTaskTreeUpdate(projection, 'meta', session, 20, change =>
      Promise.resolve(change(session)),
    )

    expect(result.session.taskTree.map(task => task.id)).not.toContain('removed')
  })

  test('does not import rows from an existing projected snapshot', async () => {
    const path = '/feed/meta-open-items.json'
    const original = JSON.stringify({
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      projected: true,
      entries: [{ key: 'transport-only', state: 'working', title: 'Projected', detail: '', at: 10 }],
    })
    const store = memoryFiles(path, original)
    const projection = createTaskProjection(store.files, path)
    let session = emptySession()
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const result = await afterTaskTreeUpdate(projection, 'meta', session, 20, save)

    expect(result.session.taskTree).toEqual([])
    expect(JSON.parse(store.contents.get(path)!).entries).toEqual([])
    expect(store.contents.get(`${path}.pre-projection`)).toBe(original)
    await projection.release('meta')
  })

  test('an empty file imports nothing, is preserved, and is replaced with a projection', async () => {
    const path = '/feed/meta-open-items.json'
    const store = memoryFiles(path, '')
    const projection = createTaskProjection(store.files, path)
    let session = emptySession()
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const result = await afterTaskTreeUpdate(projection, 'meta', session, 20, save)

    expect(result.session.taskTree).toEqual([])
    expect(result.session.taskTreeProjectionVersion).toBe(1)
    expect(store.contents.get(`${path}.pre-projection`)).toBe('')
    expect(JSON.parse(store.contents.get(path)!).projected).toBe(true)
    expect(result.message).toBeNull()
    await projection.release('meta')
  })

  test('an invalid file is copied once, reported, skipped, and then replaced', async () => {
    const path = '/feed/meta-open-items.json'
    const original = '{ invalid json'
    const now = Date.UTC(2026, 10, 18, 2, 30)
    const invalidPath = `${path}.invalid-${new Date(now).toISOString()}`
    const store = memoryFiles(path, original)
    const projection = createTaskProjection(store.files, path)
    let session = emptySession()
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const first = await afterTaskTreeUpdate(projection, 'meta', session, now, save)

    expect(first.session.taskTree).toEqual([])
    expect(first.session.taskTreeProjectionInvalidAt).toBe(now)
    expect(first.session.taskTreeProjectionInvalidReported).toBe(true)
    expect(store.contents.get(invalidPath)).toBe(original)
    expect(store.contents.get(`${path}.pre-projection`)).toBe(original)
    expect(JSON.parse(store.contents.get(path)!).projected).toBe(true)
    expect(first.message).toContain(invalidPath)

    const second = await afterTaskTreeUpdate(projection, 'meta', first.session, now + 1, save)
    expect(second.message).toBeNull()
    expect(store.writes.filter(file => file === invalidPath)).toHaveLength(1)
    expect(store.writes.filter(file => file === `${path}.pre-projection`)).toHaveLength(1)
    expect(store.contents.get(invalidPath)).toBe(original)
    await projection.release('meta')
  })

  test('a failed migration save leaves the source and backups untouched', async () => {
    const path = '/feed/meta-open-items.json'
    const original = JSON.stringify({
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      entries: [
        {
          key: 'handwritten',
          kind: 'task',
          state: 'working',
          title: 'Hand-written',
          detail: 'Keep me',
          at: 10,
          owner: { agent: 'worker', machine: 'host' },
        },
      ],
    })
    const store = memoryFiles(path, original)
    const projection = createTaskProjection(store.files, path)
    const initial = emptySession()
    const result = await afterTaskTreeUpdate(projection, 'meta', initial, 20, async () => {
      throw new Error('session save failed')
    })

    expect(result.message).toContain('session save failed')
    expect(result.session).toBe(initial)
    expect(store.contents.get(path)).toBe(original)
    expect(store.contents.has(`${path}.pre-projection`)).toBe(false)
    expect(store.writes).toEqual([])
    await projection.release('meta')
  })

  test('a crash after the migration save does not import entries twice', async () => {
    const path = '/feed/meta-open-items.json'
    const original = JSON.stringify({
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      entries: [
        {
          key: 'handwritten',
          kind: 'task',
          state: 'working',
          title: 'Hand-written',
          detail: 'Keep me',
          at: 10,
          owner: { agent: 'worker', machine: 'host' },
        },
      ],
    })
    const store = memoryFiles(path, original)
    const projection = createTaskProjection(store.files, path)
    let session = emptySession()
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const originalWrite = store.files.writeAtomic
    store.files.writeAtomic = async (file, text) => {
      if (file === path) throw new Error('simulated crash after save')
      return originalWrite(file, text)
    }
    const failed = await afterTaskTreeUpdate(projection, 'meta', session, 20, save)

    expect(failed.message).toContain('simulated crash after save')
    expect(failed.session.taskTree).toMatchObject([{ id: 'handwritten', detail: 'Keep me' }])
    expect(failed.session.taskTreeProjectionVersion).toBe(1)
    expect(store.contents.get(path)).toBe(original)
    expect(store.contents.get(`${path}.pre-projection`)).toBe(original)

    store.files.writeAtomic = originalWrite
    const retried = await afterTaskTreeUpdate(projection, 'meta', failed.session, 30, save)
    expect(retried.session.taskTree.filter(task => task.id === 'handwritten')).toHaveLength(1)
    expect(JSON.parse(store.contents.get(path)!).entries).toHaveLength(1)
    expect(store.reads).toEqual([path])
    await projection.release('meta')
  })

  test('merge helper fills only missing text and owner for an existing id', () => {
    const tree = [node('task', 'queued', { detail: 'Keep current text' })]
    const result = mergeProjectedTasks(tree, {
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      entries: [
        {
          key: 'task',
          kind: 'task',
          state: 'done',
          title: 'Other title',
          detail: 'Other text',
          at: 10,
          owner: { agent: 'worker', machine: 'host' },
        },
      ],
    })
    expect(result[0]).toMatchObject({
      status: 'queued',
      title: 'Title task',
      detail: 'Keep current text',
      links: { owner: { agent: 'worker' } },
    })
  })

  test('a second session reports a lock conflict once and never writes', async () => {
    let writes = 0
    const projection = createTaskProjection(
      {
        acquireLock: async () => false,
        releaseLock: async () => {},
        exists: async () => false,
        read: async () => null,
        writeAtomic: async () => void writes++,
      },
      '/feed/meta-open-items.json',
    )
    let session = emptySession()
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const first = await afterTaskTreeUpdate(projection, 'second', session, 1, save)
    const second = await afterTaskTreeUpdate(projection, 'second', first.session, 2, save)

    expect(first.message).toContain('another session already owns')
    expect(second.message).toBeNull()
    expect([session.taskTreeProjectionConflictReported, writes]).toEqual([true, 0])
  })

  test('an unset path performs no file or lock operation', async () => {
    let operations = 0
    const projection = createTaskProjection(
      {
        acquireLock: async () => {
          operations++
          return true
        },
        releaseLock: async () => void operations++,
        exists: async () => {
          operations++
          return false
        },
        read: async () => {
          operations++
          return null
        },
        writeAtomic: async () => void operations++,
      },
      null,
    )

    expect(await projection.sync('session', emptySession(), 1, async change => change(emptySession()))).toEqual({
      kind: 'disabled',
    })
    expect(operations).toBe(0)
  })
})
