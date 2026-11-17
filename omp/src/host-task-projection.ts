import { afterTaskTreeUpdate } from '../../hooks/task-projection-host'
import { nodeTaskProjection } from '../../feed-reader'

export { afterTaskTreeUpdate }
export const ompTaskProjection = nodeTaskProjection

/** Binds the process setting to the first interactive session that starts. */
export function claimTaskProjectionSession(
  memory: { taskProjectionSessionId: string | null },
  path: string | undefined,
  sessionId: string,
  unattended: boolean,
) {
  if (!unattended && !memory.taskProjectionSessionId && path) memory.taskProjectionSessionId = sessionId
}
