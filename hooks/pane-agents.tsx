import { agentsPage } from './agents-page'
import type { PaneBase } from './pane-context'
import { paneState } from './mod-state'

type AgentsPaneBase = Pick<PaneBase, 'Box' | 'Text' | 'pal' | 'view' | 'e' | 'hasRail'> & {
  now: number
  isDemo: boolean
}

export function paneAgents({ Box, Text, pal, view, e, hasRail, now, isDemo }: AgentsPaneBase) {
  const width = e.props.bodyColumns - 2 - (hasRail ? 5 : 0)
  const page = agentsPage(
    {
      ...view.agents,
      now,
      localAgents: isDemo ? view.agents.localAgents : paneState.localAgents,
      localAgentsUnavailable: isDemo ? view.agents.localAgentsUnavailable : paneState.agentsUnavailable,
    },
    width,
  )
  const tone = (status: string | null) => {
    if (status === 'working') return pal.tone.needsYou ?? pal.muted
    if (status === 'blocked' || status === 'stalled') return pal.tone.issue ?? pal.muted
    if (status === 'done') return pal.tone.done ?? pal.muted
    return pal.muted
  }

  return (
    <Box flexDirection="column">
      {page.notice ? <Text color={pal.tone.issue ?? pal.muted}>{page.notice}</Text> : null}
      {page.empty ? (
        <Box flexDirection="column">
          <Text bold>Agents</Text>
          <Text color={pal.muted}>{page.empty}</Text>
        </Box>
      ) : (
        page.rows.map(row => (
          <Box key={`agents-${row.kind}-${row.key}`} flexDirection="row">
            <Text color={tone(row.status)}>
              {row.kind === 'root' ? '◆ ' : row.kind === 'task' ? '  ' : row.kind === 'agent' ? '♟ ' : '↻ '}
            </Text>
            <Text wrap="truncate-end">{row.text}</Text>
          </Box>
        ))
      )}
    </Box>
  )
}
