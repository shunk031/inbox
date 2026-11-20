import { agentsInputForPane, agentsPage } from './agents-page'
import type { PaneBase } from './pane-context'
import type { PaneRowParts } from './pane-row-parts'
import { timelineChip, timelineRowBackground, timelineRowLead, timelineToneColor } from './pane-timeline'
import { timelineStatusPresentation, type TimelineState } from './timeline-page'
import { ROW_COLUMNS } from './pane-sizes'
import { cellWidth } from './text'
import { paneState } from './mod-state'

type AgentsPaneBase = Pick<PaneBase, 'Box' | 'Text' | 'pal' | 'view' | 'e' | 'hasRail'> &
  Pick<PaneRowParts, 'groupEmpty' | 'groupTitle' | 'section' | 'sections' | 'titleGap'> & {
    now: number
    isDemo: boolean
  }

function timelineState(status: string | null): TimelineState {
  switch (status) {
    case 'done':
      return 'done'
    case 'working':
      return 'working'
    case 'stalled':
      return 'stalled'
    case 'blocked':
    case 'waiting':
      return 'waiting'
    case 'dropped':
      return 'dropped'
    default:
      return 'queued'
  }
}

function chipLabel(status: string | null, fallback: string): string | null {
  if (status === null) return null
  if (status === 'stale') return 'Stale'
  if (status === 'unknown') return 'Unknown'
  if (status === 'idle') return 'Idle'
  if (status === 'blocked') return 'Blocked'
  return fallback
}

export function paneAgents({
  Box,
  Text,
  pal,
  view,
  e,
  hasRail,
  now,
  isDemo,
  groupEmpty,
  groupTitle,
  section,
  sections,
  titleGap,
}: AgentsPaneBase) {
  const width = e.props.bodyColumns - 2 - (hasRail ? 5 : 0)
  const paneWidth = cellWidth(' '.repeat(e.props.bodyColumns - (hasRail ? 5 : 0)))
  const page = agentsPage(
    agentsInputForPane(view.agents, now, isDemo, paneState.localAgents, paneState.agentsUnavailable),
    width,
  )
  const groupViews = page.groups.map(({ row: group, rows }) => {
    const { text: title, count = rows.length } = group
    const rowViews = rows.map(row => {
      const status = timelineStatusPresentation(timelineState(row.status))
      const connector = row.hasLaterSibling ? '├─ ' : '└─ '
      const rawPrefix = `${row.guides.join('')}${connector}`
      const markColumn = ROW_COLUMNS.tree.handleAt + (row.depth - 1) * 3
      const prefix = `${rawPrefix}${' '.repeat(Math.max(0, markColumn - 2 - cellWidth(rawPrefix)))}`
      const mark = timelineRowLead({ prefix, mark: status.mark }, false)
      const label = chipLabel(row.status, status.label)
      const backgroundColor = timelineRowBackground(pal, false)
      const color = timelineToneColor(pal, status.tone)

      return (
        <Box
          key={`agents-${row.kind}-${row.key}`}
          width={paneWidth}
          flexDirection="column"
          paddingX={1}
          backgroundColor={backgroundColor}
        >
          <Box flexDirection="row" alignItems="flex-start">
            <Box width={cellWidth(mark)} flexShrink={0}>
              <Text color={color}>{mark}</Text>
            </Box>
            <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
              <Box
                width={Math.max(0, paneWidth - 2 - cellWidth(mark) - (label ? cellWidth(label) + 3 : 0))}
                flexShrink={0}
              >
                <Text color={color} wrap="truncate-end">
                  {row.text}
                </Text>
              </Box>
              {label ? <Box flexShrink={0}>{timelineChip({ Box, Text, pal }, label, status.tone)}</Box> : null}
              {label ? (
                <Box width={1}>
                  <Text> </Text>
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
      )
    })

    return section([
      groupTitle(title, count),
      ...titleGap(),
      ...(rowViews.length === 0
        ? [groupEmpty(title)]
        : [
            <Box flexDirection="column" gap={1}>
              {rowViews}
            </Box>,
          ]),
    ])
  })

  return (
    <Box flexDirection="column">
      {page.notice ? <Text color={pal.tone.issue ?? pal.muted}>{page.notice}</Text> : null}
      {sections(groupViews)}
    </Box>
  )
}
