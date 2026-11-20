import type { TaskNode, TaskTree } from '../types'

export const FINISHED_TASK_ROOT_LIMIT = 20
export function pruneFinishedTaskRoots(tree: TaskTree): { tree: TaskTree; deletedIds: string[] } {
  const children = new Map<string | null, TaskNode[]>()
  for (const task of tree) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task])
  const finished: { id: string; at: number; index: number }[] = []
  const visit = (task: TaskNode): { done: boolean; at: number } => {
    const descendants = (children.get(task.id) ?? []).map(visit)
    return {
      done: (task.status === 'done' || task.status === 'dropped') && descendants.every(child => child.done),
      at: Math.max(task.updatedAt, ...descendants.map(child => child.at)),
    }
  }
  for (const [index, root] of (children.get(null) ?? []).entries()) {
    const result = visit(root)
    if (result.done) finished.push({ id: root.id, at: result.at, index })
  }
  if (finished.length <= FINISHED_TASK_ROOT_LIMIT) return { tree, deletedIds: [] }
  const removedRoots = new Set(
    finished
      .sort((a, b) => b.at - a.at || b.index - a.index)
      .slice(FINISHED_TASK_ROOT_LIMIT)
      .map(root => root.id),
  )
  const deleted = new Set<string>()
  const remove = (task: TaskNode) => {
    deleted.add(task.id)
    for (const child of children.get(task.id) ?? []) remove(child)
  }
  for (const root of removedRoots) remove(tree.find(task => task.id === root)!)
  return { tree: tree.filter(task => !deleted.has(task.id)), deletedIds: [...deleted] }
}
