import type { TaskStatusMismatch, TaskStatus, TaskTree, Session } from '../types'
import type { Op } from './status'

const STATUSES: readonly TaskStatus[] = ['working', 'queued', 'waits-on-other', 'done', 'dropped']

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && STATUSES.includes(value as TaskStatus)
}

/** Applies Status mismatch lines only to tasks that still exist with the status the model read. */
export function applyTaskMismatchOps(
  current: readonly TaskStatusMismatch[],
  ops: readonly Op[],
  tree: TaskTree,
  now: number,
): TaskStatusMismatch[] {
  let mismatches = [...current]
  for (const op of ops) {
    if (op.kind === 'task-mismatch') {
      const task = tree.find(node => node.id === op.taskId)
      if (!task || task.status !== op.savedStatus || task.status === op.claim) continue
      const next = { taskId: task.id, claim: op.claim, savedStatus: task.status, at: now }
      const index = mismatches.findIndex(mismatch => mismatch.taskId === task.id)
      if (index === -1) mismatches.push(next)
      else mismatches[index] = next
    } else if (op.kind === 'task-clear' && tree.some(task => task.id === op.taskId)) {
      mismatches = mismatches.filter(mismatch => mismatch.taskId !== op.taskId)
    }
  }
  return mismatches
}

/** A successful task update clears claims it agrees with and refreshes the saved status on the rest. */
function afterTaskTreeUpdate(current: readonly TaskStatusMismatch[], tree: TaskTree): TaskStatusMismatch[] {
  return current.flatMap(mismatch => {
    const task = tree.find(node => node.id === mismatch.taskId)
    return !task || task.status === mismatch.claim ? [] : [{ ...mismatch, savedStatus: task.status }]
  })
}

export function taskFactsAfterTreeUpdate(tree: TaskTree, facts: Session) {
  const ids = new Set(tree.map(task => task.id))
  return {
    taskStatusMismatches: afterTaskTreeUpdate(facts.taskStatusMismatches, tree),
    taskFactWarnings: facts.taskFactWarnings.filter(({ taskId }) => ids.has(taskId)),
  }
}

/** Converts old saved sessions and drops malformed or no-longer-conflicting entries. */
export function upgradeTaskStatusMismatches(value: unknown, tree: TaskTree): TaskStatusMismatch[] {
  if (!Array.isArray(value)) return []
  const byId = new Map(tree.map(task => [task.id, task]))
  const mismatches: TaskStatusMismatch[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const saved = entry as Record<string, unknown>
    const task = typeof saved.taskId === 'string' ? byId.get(saved.taskId) : undefined
    if (
      !task ||
      !isStatus(saved.claim) ||
      !isStatus(saved.savedStatus) ||
      saved.claim === task.status ||
      !Number.isFinite(saved.at) ||
      (saved.at as number) < 0
    )
      continue
    const mismatch = { taskId: task.id, claim: saved.claim, savedStatus: task.status, at: saved.at as number }
    const index = mismatches.findIndex(item => item.taskId === task.id)
    if (index === -1) mismatches.push(mismatch)
    else mismatches[index] = mismatch
  }
  return mismatches
}
