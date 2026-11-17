import type { Feed, FeedEntry } from './feed'
import { currentTaskText } from './task-text'
import type { Session, TaskNode, TaskTree } from '../types'

export type ProjectionFiles = {
  acquireLock(path: string, sessionId: string): Promise<boolean>
  releaseLock(path: string, sessionId: string): Promise<void>
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

type ProjectionResult = { kind: 'disabled' | 'written' | 'conflict' } | { kind: 'failed'; reason: string }

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
})

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
          const feed = taskProjectionFeed(session.taskTree, now)
          await files.writeAtomic(path, `${JSON.stringify(feed, null, 2)}\n`)
          return { kind: 'written' }
        } catch (error) {
          return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
        }
      })
    },
    release,
  }
}
