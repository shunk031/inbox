import { expect, test } from 'claude-code/testing'

import { GOAL_PARTS, goalRules } from '../hooks/status-prompt-goal'
import { EMPTY_SESSION_STATUS } from '../hooks/status-limits'
import { goalRefusal, goalTaskId, isGoalMet } from '../hooks/status-goal-gate'
import { applyOps } from '../hooks/status-ops'
import { setTypedGoal } from '../hooks/status-goal-ops'
import type { TaskNode } from '../types'

const task = (id: string, status: TaskNode['status'], goalId?: string): TaskNode => ({
  id,
  parentId: null,
  status,
  weight: 1,
  title: id,
  detail: '',
  notes: [],
  createdAt: 1,
  updatedAt: 1,
  history: [],
  ...(goalId ? { goalId } : {}),
})

test('a goal is not met until it has linked tasks and each linked task is done or dropped', () => {
  const goal = setTypedGoal(EMPTY_SESSION_STATUS, 'Ship search', 10).goal!

  expect(isGoalMet(goal, [])).toBe(false)
  expect(isGoalMet(goal, [task('done', 'done', goalTaskId(goal)), task('dropped', 'dropped', goalTaskId(goal))])).toBe(
    true,
  )
  expect(isGoalMet(goal, [task('open', 'queued', goalTaskId(goal))])).toBe(false)
})

test('Status cannot invent a goal without open work or replace a goal while its linked task is open', () => {
  const goal = { ...setTypedGoal(EMPTY_SESSION_STATUS, 'Ship search', 10).goal!, source: 'inferred' as const }
  const open = task('search', 'working', goalTaskId(goal))

  expect(goalRefusal(EMPTY_SESSION_STATUS, EMPTY_SESSION_STATUS, [], 'goal', 20)).toBeNull()
  expect(
    applyOps(EMPTY_SESSION_STATUS, [{ kind: 'goal', text: 'Ship search' }], 20, new Set(), []).goalRefused,
  ).toMatchObject({
    why: 'no-work',
  })
  const current = { ...EMPTY_SESSION_STATUS, goal }
  expect(goalRefusal(current, current, [open], 'goal', 20)).toBe('work-open')
})

test('typed goals stay user-owned until their linked work is met', () => {
  const saved = setTypedGoal(EMPTY_SESSION_STATUS, 'Ship search', 10)
  const linked = task('search', 'working', goalTaskId(saved.goal!))

  expect(goalRefusal(saved, saved, [linked], 'retire', 20)).toBe('typed')
  expect(goalRefusal(saved, saved, [{ ...linked, status: 'done' }], 'retire', 20)).toBe('met')
})

test('the Status goal guidance names only task-tree links and can omit an individual rule', () => {
  const text = goalRules()
  const withoutLinks = goalRules(['task-links'])

  expect(text).toContain('task tree')
  expect(text).not.toMatch(/MILESTONE:|SERVES:/)
  expect(withoutLinks).not.toContain(GOAL_PARTS['task-links'])
})
