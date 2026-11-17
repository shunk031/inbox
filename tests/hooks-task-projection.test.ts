import { describe, expect, test } from 'claude-code/testing'

import { createTaskProjection, projectedTaskEntries, writeProjectionAtomically } from '../hooks/task-projection'
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

  test('a second session reports a lock conflict once and never writes', async () => {
    let writes = 0
    const projection = createTaskProjection(
      {
        acquireLock: async () => false,
        releaseLock: async () => {},
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
        writeAtomic: async () => void operations++,
      },
      null,
    )

    expect(await projection.sync('session', emptySession(), 1)).toEqual({ kind: 'disabled' })
    expect(operations).toBe(0)
  })
})
