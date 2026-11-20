import { describe, expect, test } from 'claude-code/testing'

import { modTaskTreeExport } from '../hooks/mod-task-tree-export'
import { taskOwnerKey } from '../hooks/task-facts'
import { taskTimelineWarnings } from '../hooks/session-view'
import { taskTreeExport, writeProjectionAtomically } from '../hooks/task-projection'
import { emptySession } from '../hooks/session-files'
import type { TaskNode, TaskOwnerFacts, TaskTree } from '../types'

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

const exportTreeWith = (changes: Partial<Parameters<typeof modTaskTreeExport>[0]> = {}) =>
  modTaskTreeExport({
    home: async () => '/home/test',
    now: async () => 10,
    write: async () => {},
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    updateSession: async change => change(emptySession()),
    nonce: () => 'unique',
    log: () => {},
    ...changes,
  })

describe('task-tree export', () => {
  test('exports every task with the Timeline warning keys and fixed schema fields', () => {
    const owner = { agent: 'worker', machine: 'host' }
    const tree: TaskTree = [
      node('parent', 'working', { links: { owner, pr: 'https://github.com/org/repo/pull/1' } }),
      node('child', 'done', { parentId: 'parent' }),
      node('dropped', 'dropped'),
    ]
    const session = {
      ...emptySession(),
      taskTree: tree,
      taskOwnerFacts: { [taskOwnerKey(owner)]: { state: 'idle' as const, since: 1 } },
      taskFactWarnings: [
        { taskId: 'parent', pr: 'https://github.com/org/repo/pull/1', message: 'PR merged, task still open' as const },
      ],
      taskStatusMismatches: [{ taskId: 'parent', claim: 'done' as const, savedStatus: 'working' as const, at: 2 }],
    }
    const warnings = taskTimelineWarnings(session, tree, 1_000_000)
    const exported = taskTreeExport('session-1', tree, warnings, session.taskStatusMismatches, 2_000_000)

    expect([exported.schema, exported.session_id, exported.saved_at]).toEqual([
      1,
      'session-1',
      '1970-01-01T00:33:20.000Z',
    ])
    expect(exported.tasks.map(task => [task.id, task.parent_id, task.status, task.warnings])).toEqual([
      [
        'parent',
        null,
        'working',
        ['pr-merged-task-open', 'owner-idle-15m', 'owner-finished-task-open', 'status-conflict'],
      ],
      ['child', 'parent', 'done', []],
      ['dropped', null, 'dropped', []],
    ])
    expect(exported.tasks[0]).toMatchObject({
      title: 'Title parent',
      updated_at: '1970-01-01T00:00:00.001Z',
      owner,
      pr: 'https://github.com/org/repo/pull/1',
    })
    expect(Object.keys(exported).sort()).toEqual(['saved_at', 'schema', 'session_id', 'tasks'])
    expect(exported.tasks.every(task => Object.keys(task).length === 8)).toBe(true)
  })

  test('creates the parent directory, writes a temporary file, then renames it', async () => {
    const calls: string[] = []
    await writeProjectionAtomically('/state/task-tree/session.json', '{snapshot}', {
      mkdir: async path => void calls.push(`mkdir:${path}`),
      nonce: () => 'unique',
      write: async path => void calls.push(`write:${path}`),
      rename: async (from, to) => void calls.push(`rename:${from}:${to}`),
      remove: async path => void calls.push(`remove:${path}`),
    })

    expect(calls).toEqual([
      'mkdir:/state/task-tree',
      'write:/state/task-tree/session.json.unique.tmp',
      'rename:/state/task-tree/session.json.unique.tmp:/state/task-tree/session.json',
    ])
  })

  test('writes a separate export file for each session', async () => {
    const commands: string[][] = []
    const exportTree = exportTreeWith({
      run: async args => {
        commands.push(args)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    const empty = emptySession()

    await exportTree('session-a', empty, { ...empty, taskTree: [node('one')] })
    await exportTree('session-b', empty, { ...empty, taskTree: [node('two')] })

    expect(commands.map(([command]) => command)).toEqual(['mkdir', 'mv', 'mkdir', 'mv'])
    expect(commands.map(args => args.at(-1))).toEqual([
      '/home/test/.local/state/inbox/task-tree',
      '/home/test/.local/state/inbox/task-tree/session-a.json',
      '/home/test/.local/state/inbox/task-tree',
      '/home/test/.local/state/inbox/task-tree/session-b.json',
    ])
  })

  test('rechecks every warning owner before exporting and saves a live working fact', async () => {
    const owners = Array.from({ length: 6 }, (_, i) => ({ machine: 'local', agent: `worker-${i}` }))
    const quietOwner = { machine: 'local', agent: 'already-working' }
    const facts = Object.fromEntries([
      ...owners.map(owner => [taskOwnerKey(owner), { state: 'done' as const, since: 1 }] as const),
      [taskOwnerKey(quietOwner), { state: 'working' as const, since: 120_500 }],
    ])
    let savedFacts: TaskOwnerFacts = facts
    const writes: string[] = []
    const calls: string[][] = []
    const order: string[] = []
    const session = {
      ...emptySession(),
      taskTree: [...owners, quietOwner].map((owner, i) => node(`task-${i}`, 'working', { links: { owner } })),
      taskOwnerFacts: facts,
      taskOwnerFactCheckedAt: 120_500,
    }
    const exportTree = exportTreeWith({
      now: async () => 121_000,
      run: async args => {
        calls.push(args)
        if (args[0] === 'herdr') order.push('lookup')
        return {
          code: 0,
          stdout: JSON.stringify({ result: { agent: { agent_status: 'working' } } }),
          stderr: '',
        }
      },
      updateSession: async change => {
        const next = change({ ...session, taskOwnerFacts: savedFacts })
        savedFacts = next.taskOwnerFacts
        return next
      },
      write: async (_path, text) => {
        order.push('write')
        writes.push(text)
      },
    })

    const projection = await exportTree('session-many', emptySession(), session)

    const herdrCalls = calls.filter(args => args[0] === 'herdr')
    expect(herdrCalls).toHaveLength(6)
    expect(herdrCalls.every(args => args[1] === 'agent' && args[2] === 'get')).toBe(true)
    expect(projection?.tasks.every(task => !task.warnings.includes('owner-finished-task-open'))).toBe(true)
    expect(Object.values(savedFacts).every(fact => fact.state === 'working')).toBe(true)
    expect(writes).toHaveLength(1)
    expect(order.at(-1)).toBe('write')
  })

  test('keeps the cached warning when a live owner lookup fails', async () => {
    const owner = { machine: 'local', agent: 'worker' }
    const fact = { state: 'done' as const, since: 1 }
    let savedFacts: TaskOwnerFacts = { [taskOwnerKey(owner)]: fact }
    const writes: string[] = []
    const session = {
      ...emptySession(),
      taskTree: [node('task', 'working', { links: { owner } })],
      taskOwnerFacts: savedFacts,
    }
    const exportTree = exportTreeWith({
      now: async () => 121_000,
      run: async args =>
        args[0] === 'herdr' ? { code: 1, stdout: '', stderr: 'unavailable' } : { code: 0, stdout: '', stderr: '' },
      updateSession: async change => {
        const next = change({ ...session, taskOwnerFacts: savedFacts })
        savedFacts = next.taskOwnerFacts
        return next
      },
      write: async (_path, text) => void writes.push(text),
    })

    const projection = await exportTree('session-failed', emptySession(), session)

    expect(savedFacts[taskOwnerKey(owner)]).toEqual(fact)
    expect(projection?.tasks[0]?.warnings).toContain('owner-finished-task-open')
    expect(writes).toHaveLength(1)
  })

  test('the first export for an unchanged restored tree writes, then unchanged saves are skipped', async () => {
    const writes: string[] = []
    const exportTree = exportTreeWith({
      write: async (path, text) => void writes.push(`${path}:${text}`),
    })
    const restored = { ...emptySession(), taskTree: [node('restored')] }

    await exportTree('session-restored', restored, restored)
    await exportTree('session-restored', restored, restored)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('/home/test/.local/state/inbox/task-tree/session-restored.json.unique.tmp:')
    expect(JSON.parse(writes[0]!.slice(writes[0]!.indexOf('{'))).tasks[0].id).toBe('restored')
  })

  test('ignores write failures and logs once per session', async () => {
    const logs: string[] = []
    let writes = 0
    const exportTree = exportTreeWith({
      write: async () => {
        writes++
        throw new Error('disk full')
      },
      nonce: () => String(writes),
      log: text => logs.push(text),
    })
    const empty = emptySession()

    expect(await exportTree('session-a', empty, { ...empty, taskTree: [node('one')] })).toBeNull()
    expect(await exportTree('session-a', empty, { ...empty, taskTree: [node('two')] })).toBeNull()
    expect([writes, logs]).toEqual([
      2,
      ['inbox: task-tree export failed; the saved task tree is available in the inbox.'],
    ])
  })
})
