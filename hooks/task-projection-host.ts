import type { createTaskProjection } from './task-projection'
import type { Session } from '../types'

type Projection = ReturnType<typeof createTaskProjection>

/** Reports projection conflicts and failures through the mod. */
export async function afterTaskTreeUpdate<S extends Session>(
  projection: Projection,
  sessionId: string,
  session: S,
  now: number,
  save: (change: (current: S) => S) => Promise<S>,
): Promise<{ session: S; message: string | null }> {
  const result = await projection.sync(sessionId, session, now)
  const conflict = result.kind === 'conflict' && !session.taskTreeProjectionConflictReported
  return {
    session: conflict ? await save(current => ({ ...current, taskTreeProjectionConflictReported: true })) : session,
    message: conflict
      ? 'The task tree was saved, but another session already owns its projection path. This session will not write there.'
      : result.kind === 'failed'
        ? `The task tree was saved, but its projection failed: ${result.reason}`
        : null,
  }
}
