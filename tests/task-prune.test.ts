import { expect, test } from 'claude-code/testing'
import { taskTreeAnswer } from '../hooks/task-tool'
import { TASK_NODE_LIMIT } from '../hooks/task-tree'
import { boundedTaskPrunedIds, FINISHED_TASK_ROOT_LIMIT, pruneFinishedTaskRoots } from '../hooks/task-prune'
import { emptySession, upgradeSession } from '../hooks/session-files'
import { recorded } from '../hooks/session-presses'
import { CLAUDE_CODE } from '../hooks/model-text'
import { V0_3_TOOL_FIELDS } from '../hooks/tool-schemas'
import type { TaskNode, TaskTree } from '../types'

const task = (id: string, changes: Partial<TaskNode> = {}): TaskNode => ({
  id,
  parentId: null,
  status: 'working',
  weight: 1,
  title: id,
  detail: '',
  notes: [],
  createdAt: 1,
  updatedAt: 1,
  history: [],
  ...changes,
})
const finished = (count: number): TaskTree =>
  Array.from({ length: count }, (_, i) => task(`r${i}`, { status: 'done', updatedAt: i }))

test('prunes older finished roots with their subtrees and keeps open roots', () => {
  const roots = finished(21)
  roots.push(task('latest-child', { parentId: 'r0', status: 'done', updatedAt: 100 }), task('open'))
  const result = pruneFinishedTaskRoots(roots)
  expect(result.tree.filter(node => node.parentId === null && node.status === 'done')).toHaveLength(
    FINISHED_TASK_ROOT_LIMIT,
  )
  expect(result.tree.map(node => node.id)).toContain('open')
  const mixed = [task('open-root'), task('old-child', { parentId: 'open-root', status: 'done', updatedAt: 0 })]
  expect(
    pruneFinishedTaskRoots([...finished(21), ...mixed])
      .tree.slice(-2)
      .map(node => node.id),
  ).toEqual(['open-root', 'old-child'])
})

test('prunes after add, complete and update-to-done, but not note', () => {
  const full = [...finished(21), ...Array.from({ length: TASK_NODE_LIMIT - 21 }, (_, i) => task(`w${i}`))]
  const added = taskTreeAnswer(full, { operation: 'add', task_id: 'new', title: 'New task' }, 100)
  expect(added.taskTree).toHaveLength(TASK_NODE_LIMIT)

  for (const operation of ['complete', 'update'] as const) {
    const input = { operation, task_id: 'work', ...(operation === 'update' ? { status: 'done' } : {}) }
    expect(taskTreeAnswer([...finished(20), task('work')], input, 100).taskTree.map(node => node.id)).not.toContain(
      'r0',
    )
  }

  const tree = [...finished(21), task('parent'), task('child', { parentId: 'parent' })]
  expect(
    taskTreeAnswer(tree, { operation: 'note', task_id: 'parent', note: 'Still working' }, 100).taskTree,
  ).toHaveLength(tree.length)
})

test('pruned ids leave no shared warnings', () => {
  const state = {
    ...emptySession(),
    taskTree: finished(21),
    taskStatusMismatches: [{ taskId: 'r0', claim: 'working' as const, savedStatus: 'done' as const, at: 1 }],
    taskFactWarnings: [
      { taskId: 'r0', pr: 'https://github.com/a/b/pull/1', message: 'PR merged, task still open' as const },
    ],
  }
  const changed = recorded(
    CLAUDE_CODE,
    state,
    'tasks',
    { operation: 'add', task_id: 'next', title: 'Next task' },
    100,
    V0_3_TOOL_FIELDS,
  ).state
  expect([changed.taskStatusMismatches, changed.taskFactWarnings]).toEqual([[], []])
})

test('keeps only the newest task tombstones when saving and upgrading a session', () => {
  const ids = Array.from({ length: TASK_NODE_LIMIT + 1 }, (_, i) => `id${i}`)
  expect(boundedTaskPrunedIds(ids)).toEqual(ids.slice(-TASK_NODE_LIMIT))
  expect(upgradeSession({ ...emptySession(), taskTreePrunedIds: ids }).taskTreePrunedIds).toEqual(
    ids.slice(-TASK_NODE_LIMIT),
  )
})
