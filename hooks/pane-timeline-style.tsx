import type { PaneBase } from './pane-context'

type TimelineStyle = Pick<PaneBase, 'Box' | 'Text' | 'pal'>

export function timelineToneColor(pal: PaneBase['pal'], tone: string) {
  return tone === 'key' ? pal.key : tone === 'muted' ? pal.muted : (pal.tone[tone as 'done' | 'error'] ?? pal.muted)
}

export function timelineChip({ Box, Text, pal }: TimelineStyle, label: string, tone: string, key?: string) {
  return (
    <Box key={key} backgroundColor={timelineToneColor(pal, tone)} paddingX={1}>
      <Text color="inverseText">{label}</Text>
    </Box>
  )
}
