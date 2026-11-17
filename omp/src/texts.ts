import type { Host } from '../../hooks/model-text'
import type { AgentTool } from '../../hooks/tools'

export const OMP: Host = {
  agent: 'omp',
  surface: 'the /inbox panel',
  band: 'a band above their prompt',
  prsIn: 'the PRs tab of the /inbox panel',
  recordTool: 'record',
  closeTool: 'close',
  taskTool: 'tasks',
  splitsPlanIntoSubjects: false,
  intro:
    'The inbox extension shows the user what waits on them: your open questions, the tasks only they can do, and legacy findings in Asks, in the /inbox panel. A band above their prompt shows only counts: one for your questions and their tasks together, and one for their PRs that wait on them.',
}

/** The names omp shows for the inbox's tools. */
export const TOOL_LABELS: Record<AgentTool, string> = {
  record: 'Inbox record',
  close: 'Inbox close',
  order_prs: 'Inbox PR order',
  tasks: 'Inbox tasks',
}
