import { NOT_SAVED, type AgentTool } from './tools'
import { answerToolCallWithReminder, type Owner } from './mod-sessions'
import { afterTaskTreeUpdate } from './task-projection-host'
import type { createTaskProjection } from './task-projection'
import type { Session } from '../types'

type Projection = ReturnType<typeof createTaskProjection>

/** Runs the mod's tool answer and publishes a changed task tree through injected host effects. */
export async function runModTool(
  deps: {
    now: () => Promise<number>
    owner: () => Owner
    preview: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    commit: (owner: Owner, change: (session: Session) => Session) => Promise<Session>
    refused: (sessionId: string) => boolean
    projection: Projection | null
    savePersonLine: (id: string, line: string) => Promise<unknown>
  },
  tool: AgentTool,
  input: Record<string, unknown>,
  toolUseId: string | undefined,
  isMainAgent: boolean,
  isTasksCall: boolean,
): Promise<string> {
  const now = await deps.now()
  const owner = deps.owner()
  const toolInput = tool === 'record' ? await deps.preview(input) : input
  let answer!: ReturnType<typeof answerToolCallWithReminder>
  let didChangeTaskTree = false
  const saved = await deps.commit(owner, s => {
    answer = answerToolCallWithReminder(s, tool, toolInput, now, isMainAgent, isTasksCall)
    didChangeTaskTree = tool === 'tasks' && answer.state.taskTree !== s.taskTree
    return answer.state
  })
  let projectionMessage: string | null = null
  if (didChangeTaskTree && saved.taskTreeProjectionPath && !deps.refused(owner.id) && deps.projection) {
    const result = await afterTaskTreeUpdate(deps.projection, owner.id, saved, now, change =>
      deps.commit(owner, change),
    )
    projectionMessage = result.message
  }
  if (answer.personLine !== null && toolUseId) await deps.savePersonLine(toolUseId, answer.personLine)
  const unsaved = answer.changedSavedState && deps.refused(owner.id)
  const result = [unsaved ? `${answer.result} ${NOT_SAVED}` : answer.result, projectionMessage]
    .filter((line): line is string => line !== null)
    .join('\n')

  return answer.reminder ? `${result}\n\n${answer.reminder}` : result
}
