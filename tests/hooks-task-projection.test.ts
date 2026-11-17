import { describe, expect, test } from 'claude-code/testing'

import {
  createTaskProjection,
  mergeProjectedTasks,
  projectedTaskEntries,
  writeProjectionAtomically,
} from '../hooks/task-projection'
import { afterTaskTreeUpdate } from '../hooks/task-projection-host'
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
    let file = ''
    let writes = 0
    let locked = false
    const projection = createTaskProjection(
      {
        acquireLock: async () => {
          if (locked) return false
          locked = true
          return true
        },
        releaseLock: async () => void (locked = false),
        read: async () => null,
        writeAtomic: async (_path, text) => {
          writes++
          file = text
        },
      },
      '/feed/meta-open-items.json',
    )
    const initial = {
      ...emptySession(),
      taskTree: [node('projected', 'waits-on-other', { detail: 'Waiting for the owner' })],
    }
    const first = await projection.sync('meta', initial, 20)

    expect(first.kind).toBe('written')
    expect(JSON.parse(file!).projected).toBe(true)
    expect(JSON.parse(file!).entries).toMatchObject([
      { key: 'projected', kind: 'task', state: 'blocked', title: 'Title projected', detail: 'Waiting for the owner' },
    ])
    await projection.sync('meta', initial, 30)
    expect(writes).toBe(2)
    await projection.release('meta')
  })

  test('imports hand-written entries once, preserving existing status and text', async () => {
    let file: string | null = JSON.stringify({
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
    let reads = 0
    let locked = false
    const projection = createTaskProjection(
      {
        acquireLock: async () => (locked ? false : (locked = true)),
        releaseLock: async () => void (locked = false),
        read: async () => {
          reads++
          return file
        },
        writeAtomic: async (_path, text) => void (file = text),
      },
      '/feed/meta-open-items.json',
    )
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
    expect(JSON.parse(file!).projected).toBe(true)

    await afterTaskTreeUpdate(projection, 'meta', first.session, 30, save)
    expect(reads).toBe(1)
    expect(session.taskTree.filter(task => task.id === 'new-blocked')).toHaveLength(1)
    await projection.release('meta')
  })

  test('does not import entries from an already projected snapshot', async () => {
    let file = JSON.stringify({
      version: 1,
      source: 'meta-open-items',
      writtenAt: 10,
      projected: true,
      entries: [{ key: 'transport-only', state: 'working', title: 'Projected', detail: '', at: 10 }],
    })
    const projection = createTaskProjection(
      {
        acquireLock: async () => true,
        releaseLock: async () => {},
        read: async () => file,
        writeAtomic: async (_path, text) => void (file = text),
      },
      '/feed/meta-open-items.json',
    )

    const result = await projection.sync('meta', emptySession(), 20)
    expect(result).toMatchObject({ kind: 'written', imported: [], version: 1 })
    expect(JSON.parse(file).entries).toEqual([])
    await projection.release('meta')
  })

  test('does not mark the import complete when the first write fails', async () => {
    const projection = createTaskProjection(
      {
        acquireLock: async () => true,
        releaseLock: async () => {},
        read: async () => null,
        writeAtomic: async () => {
          throw new Error('write failed')
        },
      },
      '/feed/meta-open-items.json',
    )

    expect(await projection.sync('meta', emptySession(), 20)).toMatchObject({ kind: 'failed' })
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
        read: async () => {
          operations++
          return null
        },
        writeAtomic: async () => void operations++,
      },
      null,
    )

    expect(await projection.sync('session', emptySession(), 1)).toEqual({ kind: 'disabled' })
    expect(operations).toBe(0)
  })
})
