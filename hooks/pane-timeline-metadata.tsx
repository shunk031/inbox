import type { PaneBase } from './pane-context'
import { DESKTOP_CELL_PT } from './pane-sizes'
import { desktopSpanLines } from './terminal-text'

export function timelineDesktopMetadata({
  Box,
  Text,
  pal,
  bodyColumns,
  leadCells,
  taskId,
  metadata,
}: Pick<PaneBase, 'Box' | 'Text' | 'pal'> & {
  bodyColumns: number
  leadCells: number
  taskId: string
  metadata: string
}) {
  if (!metadata) return null

  const metadataText = desktopSpanLines([{ text: metadata }], Math.max(1, bodyColumns - leadCells) * DESKTOP_CELL_PT, 1)
    .map(span => span.text)
    .join('')

  return (
    <Box key={`timeline-metadata-${taskId}`} width={bodyColumns} flexDirection="row">
      <Box width={leadCells} flexShrink={0}>
        <Text>{' '.repeat(leadCells)}</Text>
      </Box>
      <Box width={Math.max(1, bodyColumns - leadCells)} flexShrink={1} minWidth={0}>
        <Text color={pal.muted} wrap="truncate-end">
          {metadataText}
        </Text>
      </Box>
    </Box>
  )
}
