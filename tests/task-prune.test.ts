import { expect, test } from 'claude-code/testing'
import { taskTreeAnswer } from '../hooks/task-tool'
import { TASK_NODE_LIMIT } from '../hooks/task-tree'
import { FINISHED_TASK_ROOT_LIMIT, pruneFinishedTaskRoots } from '../hooks/task-prune'
import { emptySession } from '../hooks/session-files'
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
  expect(result.tree.some(node => node.id === 'open')).toBe(true)
  const mixed = [task('open-root'), task('old-child', { parentId: 'open-root', status: 'done', updatedAt: 0 })]
  expect(pruneFinishedTaskRoots([...finished(21), ...mixed]).tree.slice(-2)).toEqual(mixed)
})

test('prunes after task changes and clears warnings', () => {
  const full = [...finished(21), ...Array.from({ length: TASK_NODE_LIMIT - 21 }, (_, i) => task(`w${i}`))]
  const added = recorded(
    CLAUDE_CODE,
    {
      ...emptySession(),
      taskTree: full,
      taskStatusMismatches: [{ taskId: 'r1', claim: 'working' as const, savedStatus: 'done' as const, at: 1 }],
    },
    'tasks',
    { operation: 'add', task_id: 'child', title: 'Child', parent_id: 'r0' },
    100,
    V0_3_TOOL_FIELDS,
  ).state
  expect(added.taskTree).toHaveLength(TASK_NODE_LIMIT)
  expect(added.taskTree.map(task => task.id)).toEqual(expect.arrayContaining(['child', 'r0']))
  expect(added.taskTree.map(task => task.id)).not.toContain('r1')
  expect([added.taskStatusMismatches, added.taskFactWarnings]).toEqual([[], []])

  for (const operation of ['complete', 'update'] as const) {
    const input = { operation, task_id: 'work', ...(operation === 'update' ? { status: 'done' } : {}) }
    expect(taskTreeAnswer([...finished(20), task('work')], input, 100).taskTree.map(node => node.id)).not.toContain(
      'r0',
    )
  }
})

test('notes and moves do not prune when there are more than 20 finished roots', () => {
  const tree = [...finished(21), task('parent'), task('work')]
  for (const input of [
    { operation: 'note', task_id: 'parent', note: 'Still working' },
    { operation: 'move', task_id: 'work', parent_id: 'parent' },
  ]) {
    expect(
      taskTreeAnswer(tree, input, 100).taskTree.filter(task => task.parentId === null && task.status === 'done'),
    ).toHaveLength(21)
  }
})
