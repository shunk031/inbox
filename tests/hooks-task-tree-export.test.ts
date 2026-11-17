import { describe, expect, test } from 'claude-code/testing'

import { modTaskTreeExport } from '../hooks/mod-task-tree-export'
import { taskOwnerKey } from '../hooks/task-facts'
import { taskTimelineWarnings } from '../hooks/session-view'
import { taskTreeExport, writeProjectionAtomically } from '../hooks/task-projection'
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

const exportTreeWith = (changes: Partial<Parameters<typeof modTaskTreeExport>[0]> = {}) =>
  modTaskTreeExport({
    home: async () => '/home/test',
    now: async () => 10,
    write: async () => {},
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
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
