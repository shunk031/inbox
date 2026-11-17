import { keepCurrentTasks } from './task-projection'
import type { createTaskProjection } from './task-projection'
import type { Session } from '../types'

type Projection = ReturnType<typeof createTaskProjection>

/** Saves the projection's imported task tree and one-time marker back through the active host. */
export async function afterTaskTreeUpdate<S extends Session>(
  projection: Projection,
  sessionId: string,
  session: S,
  now: number,
  save: (change: (current: S) => S) => Promise<S>,
): Promise<{ session: S; message: string | null }> {
  const result = await projection.sync(sessionId, session, now)
  if (result.kind === 'written')
    return {
      session: await save(current => ({
        ...current,
        taskTree: keepCurrentTasks(result.taskTree, current.taskTree),
        taskTreeProjectionVersion: result.version,
      })),
      message: null,
    }
  if (result.kind === 'conflict' && !session.taskTreeProjectionConflictReported)
    return {
      session: await save(current => ({ ...current, taskTreeProjectionConflictReported: true })),
      message:
        'The task tree was saved, but another session already owns its projection path. This session will not write there.',
    }
  if (result.kind === 'failed')
    return { session, message: `The task tree was saved, but its projection failed: ${result.reason}` }
  return { session, message: null }
}
