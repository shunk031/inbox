import { expect, test } from 'claude-code/testing'

import { inboxText, promptNotes, TOLD_NOTHING } from '../hooks/inbox-text'
import { statusPage } from '../hooks/status-page'
import { parseStatus } from '../hooks/status'
import { appliedStatus, failedStatus } from '../hooks/session-status'
import { emptySession, upgradeSession } from '../hooks/session-files'
import { recorded } from '../hooks/session-presses'
import { CLAUDE_CODE } from '../hooks/model-text'
import { timelineData } from '../hooks/timeline-page'
import type { TaskNode } from '../types'
import { TOOL_FIELDS } from '../hooks/tool-schemas'

const task = (id: string, status: TaskNode['status'] = 'working'): TaskNode => ({
  id,
  parentId: null,
  status,
  weight: 1,
  title: 'Build parser',
  detail: '',
  notes: [],
  createdAt: 0,
  updatedAt: 0,
  history: [],
})

test('a reply mismatch is saved without changing task status and appears in prompt and Status views', () => {
  const initial = { ...emptySession(), taskTree: [task('t1')] }
  const saved = appliedStatus(initial, parseStatus('TASK-MISMATCH: t1 | done | working')!, 0, 100)

  expect(saved.taskTree[0]?.status).toBe('working')
  expect(saved.taskStatusMismatches).toEqual([{ taskId: 't1', claim: 'done', savedStatus: 'working', at: 100 }])
  expect(inboxText(CLAUDE_CODE, saved.ledger, true, saved.taskTree, saved.taskStatusMismatches)).toContain(
    'Task status mismatches:\n- Build parser: agent says done; saved status is working',
  )
  expect(
    promptNotes(
      CLAUDE_CODE,
      saved.ledger,
      { text: 'Continue', isPress: false, isOpen: true },
      TOLD_NOTHING,
      saved.taskTree,
      saved.taskStatusMismatches,
    ).notes.join('\n'),
  ).toContain('Task status mismatches:')
  expect(statusPage(saved, 100).rows[0]).toMatchObject({
    kind: 'subject',
    text: expect.stringContaining('Build parser: agent says done; saved status is working'),
  })
  const timeline = timelineData(
    saved.taskTree,
    { total: 1, done: 0, working: 1, stalled: 0, waiting: 0, queued: 0 },
    {},
    [],
    100,
    saved.taskStatusMismatches,
  )
  expect(timeline.rows[0]?.warnings).toEqual(['Task status mismatch: agent says done; saved status is working'])
})

test('a mismatch keeps a completed task visible and prompt text is capped at three single-line entries', () => {
  const completed = task('done-task', 'done')
  const closedStatus = {
    ...emptySession(),
    taskTree: [completed],
    taskStatusMismatches: [{ taskId: completed.id, claim: 'working' as const, savedStatus: 'done' as const, at: 100 }],
  }
  expect(statusPage(closedStatus, 100).rows[0]).toMatchObject({
    kind: 'subject',
    text: expect.stringContaining('agent says working'),
  })

  const tree = ['t1', 't2', 't3', 't4'].map((id, index) => ({
    ...task(id),
    title: index === 1 ? '設計\n確認' : `Task ${index + 1}`,
  }))
  const mismatches = tree.map(node => ({
    taskId: node.id,
    claim: 'done' as const,
    savedStatus: 'working' as const,
    at: 100,
  }))
  const text = inboxText(CLAUDE_CODE, emptySession().ledger, true, tree, mismatches)
  const lines = text.split('\n')
  const start = lines.indexOf('Task status mismatches:')
  expect(lines.slice(start + 1, start + 4)).toEqual([
    '- Task 1: agent says done; saved status is working',
    '- 設計 確認: agent says done; saved status is working',
    '- Task 3: agent says done; saved status is working',
  ])
  expect(text).not.toContain('Task 4: agent says')
})

test('a task update that agrees with the claim and a later retraction clear the mismatch', () => {
  const saved = appliedStatus(
    { ...emptySession(), taskTree: [task('t1')] },
    parseStatus('TASK-MISMATCH: t1 | done | working')!,
    0,
    100,
  )
  const update = recorded(
    CLAUDE_CODE,
    saved,
    'tasks',
    { operation: 'update', task_id: 't1', status: 'done' },
    200,
    TOOL_FIELDS,
  )
  expect(update.state.taskTree[0]?.status).toBe('done')
  expect(update.state.taskStatusMismatches).toEqual([])

  const retracted = appliedStatus(
    saved,
    parseStatus('TASK-CLEAR: t1 | The reply corrected its completion claim')!,
    0,
    300,
  )
  expect(retracted.taskStatusMismatches).toEqual([])
})

test('unknown task ids and malformed mismatch lines are ignored', () => {
  const initial = { ...emptySession(), taskTree: [task('t1')] }
  const unknown = appliedStatus(initial, parseStatus('TASK-MISMATCH: missing | done | working')!, 0, 100)

  expect(unknown.taskStatusMismatches).toEqual([])
  const unknownClear = appliedStatus(
    {
      ...initial,
      taskStatusMismatches: [{ taskId: 't1', claim: 'done', savedStatus: 'working', at: 50 }],
    },
    parseStatus('TASK-CLEAR: missing | retracted')!,
    0,
    100,
  )
  expect(unknownClear.taskStatusMismatches).toEqual([{ taskId: 't1', claim: 'done', savedStatus: 'working', at: 50 }])
  expect(parseStatus('TASK-MISMATCH: t1 | done')).toEqual({ kind: 'unchanged' })
  expect(parseStatus('TASK-MISMATCH: t1 | working | working')).toEqual({ kind: 'unchanged' })
})

test('failed and out-of-order Status calls leave mismatch state alone', () => {
  const initial = { ...emptySession(), taskTree: [task('t1')] }
  const saved = appliedStatus(initial, parseStatus('TASK-MISMATCH: t1 | done | working')!, 0, 100)
  expect(failedStatus(saved, null, 0, 200).taskStatusMismatches).toEqual(saved.taskStatusMismatches)
  const newer = { ...saved, overviewTurn: 2, presence: { ...saved.presence, turnsApplied: 2 } }
  expect(appliedStatus(newer, parseStatus('TASK-CLEAR: t1 | retracted')!, 1, 300)).toBe(newer)
})

test('saved sessions from before mismatch state upgrade with no mismatches', () => {
  expect(upgradeSession({}).taskStatusMismatches).toEqual([])
})
