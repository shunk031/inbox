import { describe, expect, test } from 'claude-code/testing'

import {
  createTaskProjection,
  mergeProjectedTasks,
  projectedTaskEntries,
  writeProjectionAtomically,
} from '../hooks/task-projection'
import { afterTaskTreeUpdate } from '../hooks/task-projection-host'
import { emptySession } from '../hooks/session-files'
import type { Feed } from '../hooks/feed'
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

const taskFeed = (...entries: Feed['entries']): Feed => ({
  version: 1,
  source: 'meta-open-items',
  writtenAt: 10,
  entries,
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

  test('imports old entries once and keeps tree status and text for matching ids', () => {
    const tree: TaskTree = [
      node('existing', 'queued', { title: 'Tree title', detail: 'Tree text' }),
      node('missing-text', 'queued'),
    ]
    const feed = taskFeed(
      {
        key: 'new-blocked',
        kind: 'work',
        state: 'blocked',
        title: 'Imported title',
        detail: 'Imported text',
        at: 9,
        owner: { agent: 'worker', machine: 'host' },
      },
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
        key: 'missing-text',
        kind: 'task',
        state: 'done',
        title: 'Feed title',
        detail: 'Fill the missing text',
        at: 10,
      },
      {
        key: 'new-done',
        kind: 'task',
        state: 'done',
        title: 'Completed title',
        detail: 'Completed text',
        at: 10,
      },
      {
        key: 'new-queued',
        kind: 'task',
        state: 'queued',
        title: 'Queued title',
        detail: '',
        at: 10,
      },
      {
        key: 'new-working',
        kind: 'task',
        state: 'working',
        title: 'Working title',
        detail: '',
        at: 10,
      },
    )
    const imported = mergeProjectedTasks(tree, feed)

    expect(imported.find(task => task.id === 'existing')).toMatchObject({
      id: 'existing',
      status: 'queued',
      title: 'Tree title',
      detail: 'Tree text',
      links: { owner: { agent: 'worker', machine: 'host' } },
    })
    expect(imported.find(task => task.id === 'new-blocked')).toMatchObject({
      id: 'new-blocked',
      status: 'waits-on-other',
      title: 'Imported title',
      detail: 'Imported text',
    })
    expect(imported.find(task => task.id === 'missing-text')).toMatchObject({
      id: 'missing-text',
      status: 'queued',
      title: 'Title missing-text',
      detail: 'Fill the missing text',
    })
    expect(imported.find(task => task.id === 'new-done')).toMatchObject({
      id: 'new-done',
      status: 'done',
      title: 'Completed title',
      detail: 'Completed text',
    })
    expect(imported.find(task => task.id === 'new-queued')?.status).toBe('queued')
    expect(imported.find(task => task.id === 'new-working')?.status).toBe('working')
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

  test('imports before the first write and holds the lock through later writes', async () => {
    let file: string | null = JSON.stringify(
      taskFeed({
        key: 'handwritten',
        kind: 'task',
        state: 'blocked',
        title: 'Hand-written title',
        detail: 'Hand-written text',
        at: 5,
        owner: { agent: 'worker', machine: 'host' },
      }),
    )
    let reads = 0
    let writes = 0
    let locked = false
    const projection = createTaskProjection({
      acquireLock: async () => {
        if (locked) return false
        locked = true
        return true
      },
      releaseLock: async () => void (locked = false),
      read: async () => {
        reads++
        return file
      },
      writeAtomic: async (_path, text) => {
        writes++
        file = text
      },
    })
    const initial = { ...emptySession(), taskTreeProjectionPath: '/feed/meta-open-items.json' }
    const first = await projection.sync('meta', initial, 20)

    expect(first.kind).toBe('written')
    if (first.kind !== 'written') return
    expect(first.taskTree).toMatchObject([{ id: 'handwritten', status: 'waits-on-other' }])
    expect(JSON.parse(file!).entries).toMatchObject([
      { key: 'handwritten', kind: 'task', state: 'blocked', title: 'Hand-written title', detail: 'Hand-written text' },
    ])
    await projection.sync(
      'meta',
      { ...initial, taskTree: first.taskTree, taskTreeProjectionVersion: first.version },
      30,
    )
    expect([reads, writes]).toEqual([1, 2])
    await projection.release('meta')
  })

  test('a second session reports a lock conflict once and never writes', async () => {
    let writes = 0
    const projection = createTaskProjection({
      acquireLock: async () => false,
      releaseLock: async () => {},
      read: async () => null,
      writeAtomic: async () => void writes++,
    })
    let session = { ...emptySession(), taskTreeProjectionPath: '/feed/meta-open-items.json' }
    const save = async (change: (current: typeof session) => typeof session) => (session = change(session))
    const first = await afterTaskTreeUpdate(projection, 'second', session, 1, save)
    const second = await afterTaskTreeUpdate(projection, 'second', first.session, 2, save)

    expect(first.message).toContain('another session already owns')
    expect(second.message).toBeNull()
    expect([session.taskTreeProjectionConflictReported, writes]).toEqual([true, 0])
  })

  test('an unset path performs no file or lock operation', async () => {
    let operations = 0
    const projection = createTaskProjection({
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
    })

    expect(await projection.sync('session', emptySession(), 1)).toEqual({ kind: 'disabled' })
    expect(operations).toBe(0)
  })
})
