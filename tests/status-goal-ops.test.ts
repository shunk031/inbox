import { expect, test } from 'claude-code/testing'

import { EMPTY_SESSION_STATUS } from '../hooks/status-limits'
import { goalPage } from '../hooks/status-goal-page'
import { isGoalMet, goalTaskId } from '../hooks/status-goal-gate'
import { removeGoal, restoreGoal, setTypedGoal, settleGoal } from '../hooks/status-goal-ops'
import type { TaskNode, TaskTree } from '../types'

const task = (id: string, goalId: string, status: TaskNode['status'], weight = 1): TaskNode => ({
  id,
  parentId: null,
  status,
  weight,
  title: id,
  detail: '',
  notes: [],
  createdAt: 1,
  updatedAt: 1,
  history: [],
  goalId,
})

test('goal settlement waits for linked tasks and is met when every linked task is done or dropped', () => {
  const typed = setTypedGoal(EMPTY_SESSION_STATUS, 'Ship the search release', 10)
  const goal = typed.goal!
  const tree: TaskTree = [
    task('done', goalTaskId(goal), 'done'),
    task('open', goalTaskId(goal), 'working'),
    task('dropped', goalTaskId(goal), 'dropped'),
  ]

  expect(settleGoal(typed, [], 20).goal).toMatchObject({ isAwaitingMilestones: true, metAt: null })
  expect(isGoalMet(goal, tree)).toBe(false)
  expect(settleGoal(typed, tree, 20).goal).toMatchObject({ isAwaitingMilestones: false, metAt: null })

  const completed = tree.map(node => ({ ...node, status: node.id === 'open' ? ('done' as const) : node.status }))
  const met = settleGoal(typed, completed, 30)
  expect(isGoalMet(goal, completed)).toBe(true)
  expect(met.goal).toMatchObject({ isAwaitingMilestones: false, metAt: 30 })
})

test('the goal page counts linked work and shows the Now line without milestone rows', () => {
  const saved = {
    ...setTypedGoal(EMPTY_SESSION_STATUS, 'Ship the search release', 10),
    head: { title: 'Search', description: 'Finish search' },
  }
  const goalId = goalTaskId(saved.goal!)
  const tree = [
    task('done', goalId, 'done'),
    task('open', goalId, 'waits-on-other'),
    task('dropped', goalId, 'dropped'),
  ]
  const page = goalPage(saved, [], tree).goal!

  expect(page).toMatchObject({
    label: 'Goal',
    text: 'Ship the search release',
    count: '1 of 2 tasks done',
    now: 'Now: Finish search',
    milestones: [],
  })
  expect(goalPage(saved, [], []).goal?.awaiting).toBe('No tasks linked yet')
})

test('removing and restoring a goal preserves the saved goal and its legacy undo snapshot', () => {
  const saved = setTypedGoal(EMPTY_SESSION_STATUS, 'Ship the search release', 10)
  const removed = removeGoal(saved)

  expect(removed.goal).toBeNull()
  expect(removed.goalRemoved?.goal).toEqual(saved.goal)
  expect(restoreGoal(removed)).toMatchObject({ goal: saved.goal, goalRemoved: null })
})
