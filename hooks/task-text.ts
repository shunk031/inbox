import type { TaskNode } from '../types'

export type CurrentTaskText = { text: string; at: number }

/** The newest task detail or note, with the time that text became current. */
export function currentTaskText(
  task: Pick<TaskNode, 'detail' | 'createdAt' | 'updatedAt' | 'notes' | 'history'>,
): CurrentTaskText | null {
  const detailIndex = task.history.findLastIndex(event => event.kind === 'detail')
  const detailAt = task.history[detailIndex]?.at ?? task.createdAt
  const noteEvent = task.history
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === 'note' && event.detail !== undefined && task.notes.includes(event.detail))
    .toSorted((a, b) => b.event.at - a.event.at || b.index - a.index)[0]
  const latestNote = noteEvent
    ? { text: noteEvent.event.detail!, at: noteEvent.event.at, index: noteEvent.index }
    : task.notes.length > 0
      ? { text: task.notes.at(-1)!, at: task.createdAt, index: -1 }
      : null

  if (latestNote && (latestNote.at > detailAt || (latestNote.at === detailAt && latestNote.index > detailIndex)))
    return { text: latestNote.text, at: latestNote.at }
  return task.detail ? { text: task.detail, at: detailAt } : latestNote
}
