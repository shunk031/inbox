import type { GoalRefusal, SessionStatus, StatusGoal, TaskTree } from '../types'
import { GOAL_LEFT_MS } from './status-limits'

export const goalTaskId = (goal: StatusGoal): string => `goal-${goal.setAt}`

export const tasksForGoal = (tree: TaskTree, goal: StatusGoal): TaskNode[] =>
  tree.filter(task => task.goalId === goalTaskId(goal))

export function isGoalMet(goal: StatusGoal | null, tree: TaskTree): boolean {
  const tasks = goal === null ? [] : tasksForGoal(tree, goal)
  return tasks.length > 0 && tasks.every(task => task.status === 'done' || task.status === 'dropped')
}

export const lastProgressAt = (goal: StatusGoal, tree: TaskTree): number =>
  Math.max(goal.setAt, ...tasksForGoal(tree, goal).map(task => task.updatedAt))

export function goalLeftFor(o: SessionStatus, tree: TaskTree, now: number): number | null {
  const goal = o.goal
  if (goal === null || isGoalMet(goal, tree) || goal.source !== 'inferred') return null
  const linked = tasksForGoal(tree, goal)
  if (!linked.length || linked.some(task => task.status !== 'done' && task.status !== 'dropped')) return null
  const left = now - lastProgressAt(goal, tree)
  return left >= GOAL_LEFT_MS ? left : null
}

function refusalOf(o: SessionStatus, tree: TaskTree, kind: GoalRefusal['line'], now: number): GoalRefusal['why'] | null {
  const goal = o.goal
  if (goal === null || isGoalMet(goal, tree)) return kind === 'goal' ? null : 'met'
  if (goal.source === 'typed') return 'typed'
  if (tasksForGoal(tree, goal).some(task => task.status !== 'done' && task.status !== 'dropped')) return 'work-open'

  return goalLeftFor(o, tree, now) === null ? 'moved' : null
}

export function goalRefusal(o: SessionStatus, start: SessionStatus, tree: TaskTree, kind: GoalRefusal['line'], now: number): GoalRefusal['why'] | null {
  const why = refusalOf(o, tree, kind, now)
  if (why === null || start === o || o.goal?.setAt !== start.goal?.setAt) return why
  return refusalOf(start, tree, kind, now) === null ? null : why
}
