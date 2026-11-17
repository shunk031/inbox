import { parseFeed } from './feed'
import type { Feed, FeedEntry } from './feed'
import { currentTaskText } from './task-text'
import { TASK_HISTORY_LIMIT, TASK_NODE_LIMIT } from './task-tree'
import type { Session, TaskFactWarning, TaskNode, TaskOwner, TaskStatusMismatch, TaskTree } from '../types'

const TASK_PROJECTION_VERSION = 1

export type ProjectionFiles = {
  acquireLock(path: string, sessionId: string): Promise<boolean>
  releaseLock(path: string, sessionId: string): Promise<void>
  read(path: string): Promise<string | null>
  writeAtomic(path: string, text: string): Promise<void>
}

type TaskTreeExportWarning = 'owner-idle-15m' | 'owner-finished-task-open' | 'pr-merged-task-open' | 'status-conflict'

type TaskTreeExport = {
  schema: 1
  session_id: string
  saved_at: string
  tasks: {
    id: string
    parent_id: string | null
    title: string
    status: TaskNode['status']
    updated_at: string
    owner: TaskOwner | null
    pr: string | null
    warnings: TaskTreeExportWarning[]
  }[]
}

type AtomicProjectionFiles = {
  mkdir?: (path: string) => Promise<void>
  write(path: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  nonce(): string
}

/** Writes beside the destination, then renames into place so readers see either complete snapshot. */
export async function writeProjectionAtomically(path: string, text: string, files: AtomicProjectionFiles) {
  const temporary = `${path}.${files.nonce()}.tmp`
  try {
    await files.mkdir?.(path.slice(0, path.lastIndexOf('/')) || '/')
    await files.write(temporary, text)
    await files.rename(temporary, path)
  } catch (error) {
    await files.remove(temporary).catch(() => undefined)
    throw error
  }
}

const exportWarning = (warning: TaskFactWarning): TaskTreeExportWarning | null => {
  switch (warning.message) {
    case 'Owner idle 15m+':
      return 'owner-idle-15m'
    case 'Owner finished, task open':
      return 'owner-finished-task-open'
    case 'PR merged, task still open':
      return 'pr-merged-task-open'
    case 'PR closed without merge':
      return null
  }
}

export function taskTreeExport(
  sessionId: string,
  tree: TaskTree,
  warnings: readonly TaskFactWarning[],
  mismatches: readonly TaskStatusMismatch[],
  savedAt: number,
): TaskTreeExport {
  const warningKeys = new Map<string, Set<TaskTreeExportWarning>>()
  for (const warning of warnings) {
    const key = exportWarning(warning)
    if (key) {
      const keys = warningKeys.get(warning.taskId) ?? new Set<TaskTreeExportWarning>()
      keys.add(key)
      warningKeys.set(warning.taskId, keys)
    }
  }
  for (const mismatch of mismatches) {
    const keys = warningKeys.get(mismatch.taskId) ?? new Set<TaskTreeExportWarning>()
    keys.add('status-conflict')
    warningKeys.set(mismatch.taskId, keys)
  }

  return {
    schema: 1,
    session_id: sessionId,
    saved_at: new Date(savedAt).toISOString(),
    tasks: tree.map(task => ({
      id: task.id,
      parent_id: task.parentId,
      title: task.title,
      status: task.status,
      updated_at: new Date(task.updatedAt).toISOString(),
      owner: task.links?.owner ? { ...task.links.owner } : null,
      pr: task.links?.pr ?? null,
      warnings: [...(warningKeys.get(task.id) ?? [])],
    })),
  }
}

type ProjectionResult<S extends Session> =
  | { kind: 'disabled' }
  | { kind: 'written'; session: S; invalidReportPath: string | null }
  | { kind: 'conflict' }
  | { kind: 'failed'; reason: string; session: S; invalidReportPath: string | null }

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

const taskProjectionFeed = (tree: TaskTree, now: number): Feed => ({
  version: 1,
  source: 'meta-open-items',
  writtenAt: now,
  entries: projectedTaskEntries(tree),
  projected: true,
})

function importedStatus(state: FeedEntry['state']): TaskNode['status'] {
  return state === 'blocked' ? 'waits-on-other' : state
}

/** Merges hand-written entries without replacing saved status or non-empty current text. */
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
    next = [
      ...next,
      {
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
      },
    ]
  }
  return next
}

function importedFeed(text: string): Feed {
  const parsed = parseFeed(text)
  if (!parsed || parsed.source !== 'meta-open-items')
    throw new Error('the projection file is not a valid meta-open-items feed')
  return parsed
}

/** Serializes writes by path and holds the exclusive lock until release. */
export function createTaskProjection(files: ProjectionFiles, path: string | null) {
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
          let imported: FeedEntry[] = []
          if (session.taskTreeProjectionVersion < TASK_PROJECTION_VERSION) {
            const existing = await files.read(path)
            if (existing !== null) {
              const feed = importedFeed(existing)
              imported = feed.entries
              taskTree = mergeProjectedTasks(taskTree, feed)
            }
          }
          const feed = taskProjectionFeed(taskTree, now)
          await files.writeAtomic(path, `${JSON.stringify(feed, null, 2)}\n`)
          return { kind: 'written', imported, version: TASK_PROJECTION_VERSION }
        } catch (error) {
          return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
        }
      })
    },
    release,
  }
}
