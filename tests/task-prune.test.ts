import { expect, test } from 'claude-code/testing'
import { applyTaskOwnerFacts } from '../hooks/task-facts'
import { timelineData, timelinePage } from '../hooks/timeline-page'
import { taskTreeAnswer } from '../hooks/task-tool'
import { taskTreeExport } from '../hooks/task-projection'
import { FINISHED_TASK_ROOT_LIMIT, TASK_NODE_LIMIT, pruneFinishedTaskRoots } from '../hooks/task-tree'
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
  expect(result.tree.map(node => node.id)).toContain('open')
  expect(taskTreeExport('s', result.tree, [], [], 1).tasks.map(node => node.id)).not.toContain('r1')

  const mixed = [task('open-root'), task('old-child', { parentId: 'open-root', status: 'done', updatedAt: 0 })]
  expect(
    pruneFinishedTaskRoots([...finished(21), ...mixed])
      .tree.slice(-2)
      .map(node => node.id),
  ).toEqual(['open-root', 'old-child'])
})

test('prunes after add, complete and update-to-done, but not note or move', () => {
  const full = [...finished(21), ...Array.from({ length: TASK_NODE_LIMIT - 21 }, (_, i) => task(`w${i}`))]
  const added = taskTreeAnswer(full, { operation: 'add', task_id: 'new', title: 'New task' }, 100)
  expect(added.taskTree).toHaveLength(TASK_NODE_LIMIT)

  for (const operation of ['complete', 'update'] as const) {
    const tree = [...finished(20), task('work')]
    const answer = taskTreeAnswer(
      tree,
      operation === 'complete' ? { operation, task_id: 'work' } : { operation, task_id: 'work', status: 'done' },
      100,
    )
    expect(answer.taskTree.map(node => node.id)).not.toContain('r0')
  }

  const tree = [...finished(21), task('parent'), task('child', { parentId: 'parent' })]
  for (const input of [
    { operation: 'note', task_id: 'parent', note: 'Still working' },
    { operation: 'move', task_id: 'child', parent_id: null },
  ]) {
    expect(taskTreeAnswer(tree, input, 100).taskTree).toHaveLength(tree.length)
  }
})

test('pruned ids leave shared warnings and Timeline navigation on visible tasks', () => {
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
  const facts = applyTaskOwnerFacts(changed.taskTree, {}, 100)
  expect(Object.keys(facts.stalledSince)).not.toContain('r0')
  const page = timelinePage(timelineData(changed.taskTree, facts.segments, {}, [], 100), 'r0', ['r0'])
  expect(page.selected?.row.task.id).not.toBe('r0')
  expect(page.rows.map(row => row.task.id)).toEqual(changed.taskTree.map(node => node.id))
})
