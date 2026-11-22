import type { PaneBase, PaneHandlers } from './pane-context'
import type { taskReportPage } from './task-report'
import type { timelineChip } from './pane-timeline-style'
import { TREE_LINE_AT } from './pane-sizes'

type TimelinePaneDetailProps = Pick<PaneBase, 'Box' | 'Button' | 'Text' | 'pal'> &
  Pick<PaneHandlers, 'closeTimelineDetail' | 'runPress'> & {
    selected: ReturnType<typeof taskReportPage>['selected']
    detailTitle: string
    paneWidth: number
    chip: (label: string, tone: string, key?: string) => ReturnType<typeof timelineChip>
  }

export function paneTimelineDetail({
  Box,
  Button,
  Text,
  pal,
  selected,
  detailTitle,
  paneWidth,
  closeTimelineDetail,
  runPress,
  chip,
}: TimelinePaneDetailProps) {
  return selected ? (
    <Box key="timeline-detail" width={paneWidth} flexDirection="column" gap={1}>
      <Box key="timeline-detail-header" flexDirection="row" alignItems="flex-start" paddingLeft={TREE_LINE_AT}>
        <Box key="timeline-back-control" flexShrink={0}>
          <Button plain key="timeline-back" hotkey="b" label="‹ Back" onPress={() => void closeTimelineDetail()} />
        </Box>
        <Box key="timeline-back-gap" width={1} flexShrink={0}>
          <Text> </Text>
        </Box>
        <Box key="timeline-detail-title-area" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text key="timeline-detail-title" bold wrap="truncate-end">
            {detailTitle}
          </Text>
        </Box>
        <Box flexShrink={0}>{chip(selected.row.statusLabel, selected.row.tone)}</Box>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {(
          [
            ['Progress', selected.stats.progress],
            ['Weight', selected.stats.weight],
            ['Completed units', selected.stats.completedUnits],
          ] as const
        ).map(([label, value]) => (
          <Box key={label} flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
            <Text color={pal.muted}>{label}</Text>
            <Text bold>{value}</Text>
          </Box>
        ))}
      </Box>
      {selected.details.map((line, index) => (
        <Box
          key={`timeline-detail-row-${index}`}
          flexDirection="row"
          alignItems="flex-start"
          paddingLeft={TREE_LINE_AT}
        >
          {line.label === 'Links' ? (
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text color={pal.muted}>Links</Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {line.actions.map(link => (
                  <Box key={`${link.label}-${selected.row.task.id}`} flexDirection="row">
                    <Button
                      label={link.result?.state === 'pending' ? 'Opening…' : link.label}
                      dimColor={link.isOut}
                      onPress={press => void runPress(link.press, press.surface)}
                    />
                    {link.result?.state === 'done' ? <Text color={pal.tone.done}>✓ Opened</Text> : null}
                    {link.result?.state === 'failed' ? (
                      <Text color={pal.tone.error ?? pal.muted}>
                        {link.result.parts.find(part => part.error)?.error}
                      </Text>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text color={pal.muted}>{line.label}</Text>
              <Text>{line.text}</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  ) : null
}
