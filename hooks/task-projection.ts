import { parseFeed } from './feed'
import type { Feed, FeedEntry } from './feed'
import { TASK_HISTORY_LIMIT, TASK_NODE_LIMIT } from './task-tree'
import { currentTaskText } from './task-text'
import type { Session, TaskNode, TaskTree } from '../types'

const TASK_PROJECTION_VERSION = 1

export type ProjectionFiles = {
  acquireLock(path: string, sessionId: string): Promise<boolean>
  releaseLock(path: string, sessionId: string): Promise<void>
  read(path: string): Promise<string | null>
  writeAtomic(path: string, text: string): Promise<void>
}

type AtomicProjectionFiles = {
  write(path: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  nonce(): string
}

/** Writes beside the destination, then renames into place so readers see either complete snapshot. */
export async function writeProjectionAtomically(path: string, text: string, files: AtomicProjectionFiles) {
  const temporary = `${path}.${files.nonce()}.tmp`
  await files.write(temporary, text)
  try {
    await files.rename(temporary, path)
  } catch (error) {
    await files.remove(temporary).catch(() => undefined)
    throw error
  }
}

type ProjectionResult =
  | { kind: 'disabled' }
  | { kind: 'written'; taskTree: TaskTree; version: number }
  | { kind: 'conflict' }
  | { kind: 'failed'; reason: string }

const taskState = (status: TaskNode['status']): FeedEntry['state'] =>
  status === 'done' || status === 'dropped' ? 'done' : status === 'waits-on-other' ? 'blocked' : 'working'

/** One feed row for every open task, using the same current-text rule as Timeline. */
export function projectedTaskEntries(tree: TaskTree): FeedEntry[] {
  return tree.flatMap(task => {
    if (task.status === 'done' || task.status === 'dropped') return []
    const current = currentTaskText(task)
    return [
      {
        key: task.id,
        kind: 'task',
        state: taskState(task.status),
        title: task.title,
        detail: current?.text ?? '',
        at: current?.at ?? task.createdAt,
        ...(task.links?.owner ? { owner: { ...task.links.owner } } : {}),
      },
    ]
  })
}

/** The projection is a transport snapshot; the saved task tree remains authoritative. */
function taskProjectionFeed(tree: TaskTree, now: number): Feed {
  return { version: 1, source: 'meta-open-items', writtenAt: now, entries: projectedTaskEntries(tree) }
}

function importedStatus(state: FeedEntry['state']): TaskNode['status'] {
  return state === 'done' ? 'done' : state === 'blocked' ? 'waits-on-other' : state
}

/** Imports hand-written entries, preserving tree-owned title, text and status for ids already present. */
export function mergeProjectedTasks(tree: TaskTree, feed: Feed): TaskTree {
  let next = tree
  for (const entry of feed.entries) {
    const current = next.find(task => task.id === entry.key)
    if (current) {
      const fillText = currentTaskText(current) === null && entry.detail !== ''
      if ((!entry.owner || current.links?.owner) && !fillText) continue
      next = next.map(task =>
        task.id === current.id
          ? {
              ...task,
              ...(fillText
                ? {
                    detail: entry.detail,
                    updatedAt: Math.max(task.updatedAt, entry.at),
                    history: [
                      ...task.history.slice(-(TASK_HISTORY_LIMIT - 1)),
                      { at: entry.at, source: 'meta-open-items', kind: 'detail', detail: entry.detail },
                    ],
                  }
                : {}),
              links: { ...task.links, ...(entry.owner && !task.links?.owner ? { owner: { ...entry.owner } } : {}) },
            }
          : task,
      )
      continue
    }
    if (next.length >= TASK_NODE_LIMIT) throw new Error('the task tree is full; the projection import was not saved')
    const task: TaskNode = {
      id: entry.key,
      parentId: null,
      status: importedStatus(entry.state),
      weight: 1,
      title: entry.title,
      detail: entry.detail,
      notes: [],
      createdAt: entry.at,
      updatedAt: entry.at,
      history: [{ at: entry.at, source: 'meta-open-items', kind: 'imported', detail: entry.detail }],
      ...(entry.owner ? { links: { owner: { ...entry.owner } } } : {}),
    }
    next = [...next, task]
  }
  return next
}

/** Reconciles a projection result with task changes saved while its file was being written. */
export function keepCurrentTasks(projected: TaskTree, current: TaskTree): TaskTree {
  const currentById = new Map(current.map(task => [task.id, task]))
  const kept = projected.map(task => {
    const latest = currentById.get(task.id)
    if (!latest) return task
    currentById.delete(task.id)
    return {
      ...task,
      ...latest,
      links: {
        ...task.links,
        ...latest.links,
        ...(!latest.links?.owner && task.links?.owner ? { owner: task.links.owner } : {}),
      },
    }
  })
  return [...kept, ...current.filter(task => currentById.has(task.id))]
}

function importedFeed(text: string): Feed {
  const feed = parseFeed(text)
  if (!feed || feed.source !== 'meta-open-items')
    throw new Error('the projection file is not a valid meta-open-items feed')
  return feed
}

/** Serializes writes by path, holds the exclusive lock until release, and imports before its first publish. */
export function createTaskProjection(files: ProjectionFiles) {
  const held = new Map<string, string>()
  const bySession = new Map<string, string>()
  const tails = new Map<string, Promise<unknown>>()

  const ordered = <T>(path: string, run: () => Promise<T>): Promise<T> => {
    const result = (tails.get(path) ?? Promise.resolve()).then(run)
    const tail = result.catch(() => undefined)
    tails.set(path, tail)
    void tail.then(() => {
      if (tails.get(path) === tail) tails.delete(path)
    })
    return result
  }

  const releaseNow = async (sessionId: string): Promise<void> => {
    const path = bySession.get(sessionId)
    if (!path || held.get(path) !== sessionId) return
    bySession.delete(sessionId)
    held.delete(path)
    await files.releaseLock(path, sessionId).catch(() => undefined)
  }

  const release = async (sessionId: string): Promise<void> => {
    const path = bySession.get(sessionId)
    if (!path) return
    await ordered(path, () => releaseNow(sessionId))
  }

  return {
    sync(sessionId: string, session: Session, now: number): Promise<ProjectionResult> {
      const path = session.taskTreeProjectionPath
      if (!path) return Promise.resolve({ kind: 'disabled' })
      if (session.taskTreeProjectionConflictReported) return Promise.resolve({ kind: 'conflict' })
      return ordered(path, async () => {
        const previous = bySession.get(sessionId)
        try {
          if (previous && previous !== path) await releaseNow(sessionId)
          if (held.get(path) !== sessionId) {
            if (held.has(path) || !(await files.acquireLock(path, sessionId))) return { kind: 'conflict' }
            held.set(path, sessionId)
            bySession.set(sessionId, path)
          }
          let taskTree = session.taskTree
          if (session.taskTreeProjectionVersion < TASK_PROJECTION_VERSION) {
            const existing = await files.read(path)
            if (existing !== null) taskTree = mergeProjectedTasks(taskTree, importedFeed(existing))
          }
          const feed = taskProjectionFeed(taskTree, now)
          await files.writeAtomic(path, `${JSON.stringify(feed, null, 2)}\n`)
          return { kind: 'written', taskTree, version: TASK_PROJECTION_VERSION }
        } catch (error) {
          return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
        }
      })
    },
    release,
  }
}
