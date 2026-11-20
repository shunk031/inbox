import type { TaskNode, TaskTree } from '../types'

export const FINISHED_TASK_ROOT_LIMIT = 20
export function pruneFinishedTaskRoots(tree: TaskTree): { tree: TaskTree; deletedIds: string[] } {
  const children = new Map<string | null, TaskNode[]>()
  for (const task of tree) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task])
  const visit = (task: TaskNode): { done: boolean; at: number } => {
    const descendants = (children.get(task.id) ?? []).map(visit)
    return {
      done: (task.status === 'done' || task.status === 'dropped') && descendants.every(child => child.done),
      at: Math.max(task.updatedAt, ...descendants.map(child => child.at)),
    }
  }
  const finished = (children.get(null) ?? []).flatMap((root, index) => {
    const result = visit(root)
    return result.done ? [{ id: root.id, at: result.at, index }] : []
  })
  if (finished.length <= FINISHED_TASK_ROOT_LIMIT) return { tree, deletedIds: [] }
  const deleted = new Set<string>()
  const remove = (task: TaskNode): void => {
    deleted.add(task.id)
    ;(children.get(task.id) ?? []).forEach(remove)
  }
  for (const { id } of finished.sort((a, b) => b.at - a.at || b.index - a.index).slice(FINISHED_TASK_ROOT_LIMIT))
    remove(tree.find(task => task.id === id)!)
  return { tree: tree.filter(task => !deleted.has(task.id)), deletedIds: [...deleted] }
}
