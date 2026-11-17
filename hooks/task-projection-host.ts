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
  const result = await projection.sync(sessionId, session, now, change => save(change))
  const conflict = result.kind === 'conflict' && !session.taskTreeProjectionConflictReported
  const updated =
    result.kind === 'written' || result.kind === 'failed'
      ? result.session
      : conflict
        ? await save(current => ({ ...current, taskTreeProjectionConflictReported: true }))
        : session
  const message = [
    conflict
      ? 'The task tree was saved, but another session already owns its projection path. This session will not write there.'
      : result.kind === 'failed'
        ? `The task projection failed: ${result.reason}`
        : null,
    result.kind !== 'written' && result.kind !== 'failed'
      ? null
      : result.invalidReportPath
        ? `The existing meta-open-items file was invalid, was not imported, and was copied to ${result.invalidReportPath}.`
        : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  return {
    session: updated,
    message: message || null,
  }
}
