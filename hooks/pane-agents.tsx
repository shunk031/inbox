import { agentsInputForPane, agentsPage } from './agents-page'
import type { PaneBase } from './pane-context'
import type { PaneRowParts } from './pane-row-parts'
import { timelineChip, timelineRowBackground, timelineToneColor } from './pane-timeline'
import { timelineStatusPresentation, type TimelineState } from './timeline-page'
import { TREE_LINE_AT } from './pane-sizes'
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
  const treeBridge = (group: string, guides: readonly string[], index = 0) => {
    const prefix = `${' '.repeat(TREE_LINE_AT)}${guides.join('')}│`
    return (
      <Box key={`bridge-${group}-${index}`} flexDirection="row">
        <Box width={cellWidth(prefix)} flexShrink={0}>
          <Text color={pal.line}>{prefix}</Text>
        </Box>
      </Box>
    )
  }
  const page = agentsPage(
    agentsInputForPane(view.agents, now, isDemo, paneState.localAgents, paneState.agentsUnavailable),
    width,
  )
  const groupViews = page.groups.map(({ row: group, rows }) => {
    const { text: title, count = rows.length } = group
    const siblingParents = new Set<string>()
    const parentAtDepth: string[] = []
    const connectedRows = rows.flatMap((row, index) => {
      const parent = row.depth === 1 ? group.key : (parentAtDepth[row.depth - 2] ?? group.key)
      const isFirstSibling = !siblingParents.has(parent)
      siblingParents.add(parent)
      parentAtDepth[row.depth - 1] = row.key
      parentAtDepth.length = row.depth
      const status = timelineStatusPresentation(timelineState(row.status))
      const connector = row.hasLaterSibling ? '├─ ' : '└─ '
      const rawPrefix = `${row.guides.join('')}${connector}`
      const mark = ` ${rawPrefix}${status.mark} `
      const label = chipLabel(row.status, status.label)
      const backgroundColor = timelineRowBackground(pal, false)
      const color = timelineToneColor(pal, status.tone)

      return [
        ...(!isFirstSibling ? [treeBridge(group.key, row.guides, index)] : []),
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
                width={Math.max(0, paneWidth - 2 - cellWidth(mark) - (label ? cellWidth(label) + 4 : 0))}
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
        </Box>,
      ]
    })

    return section([
      groupTitle(title, count),
      ...(rows.length ? [treeBridge(group.key, [], -1), ...connectedRows] : [...titleGap(), groupEmpty(title)]),
    ])
  })

  return (
    <Box flexDirection="column">
      {page.notice ? <Text color={pal.tone.issue ?? pal.muted}>{page.notice}</Text> : null}
      {sections(groupViews)}
    </Box>
  )
}
