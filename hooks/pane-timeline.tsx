import type { PaneBase, PaneHandlers } from './pane-context'
import { moveTimelineSelection, timelinePage, toggleTimelineBranch } from './timeline-page'

type TimelinePaneBase = Pick<
  PaneBase,
  'Box' | 'Button' | 'Text' | 'look' | 'pal' | 'view' | 'now' | 'timelineSelection' | 'timelineFolded'
>
type TimelinePaneHandlers = Pick<PaneHandlers, 'runPress' | 'selectTimelineRow' | 'updateTimelineFolded'>

export function paneTimeline(context: TimelinePaneBase, handlers: TimelinePaneHandlers) {
  const { Box, Button, Text, look, pal, view, timelineSelection, timelineFolded } = context
  const { selectTimelineRow, updateTimelineFolded, runPress } = handlers
  const page = timelinePage(view.timeline, timelineSelection, timelineFolded, view.lastActions)
  const tones = {
    done: pal.tone.done ?? pal.muted,
    stalled: pal.tone.issue ?? pal.muted,
    working: pal.tone.needsYou ?? pal.muted,
  }
  const tone = (status: string) => tones[status as keyof typeof tones] ?? pal.muted
  const marks: Record<string, string> = { done: '✓', stalled: '!', working: '●', 'waits-on-other': '◌' }
  const bar = (parts: (typeof page.bars)[number]['parts']) =>
    parts.map(part => <Text color={tone(part.state)}>{part.mark.repeat(part.count)}</Text>)

  const timelineView = (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={pal.muted}>Task plan · {page.summary}</Text>
        {page.bars[0]?.parts.length ? <Text color={pal.muted}> · </Text> : null}
        {page.bars[0]?.parts.length ? bar(page.bars[0].parts) : null}
      </Box>
      {page.isEmpty ? (
        <Box flexDirection="column">
          <Text bold>{page.empty.title}</Text>
          <Text color={pal.muted}>{page.empty.hint}</Text>
        </Box>
      ) : null}
      {page.bars.slice(1).map(item => (
        <Box key={`bar-${item.id}`} flexDirection="row">
          <Text color={pal.muted}>{item.label}: </Text>
          {bar(item.parts)}
        </Box>
      ))}
      {page.rows.map(row => {
        const selected = row.task.id === page.selected?.row.task.id
        const selection = selected ? page.selected : null
        const branch = row.branch === 'mid' ? '├─ ' : row.branch === 'last' ? '└─ ' : ''
        const detail = `${'  '.repeat(row.depth + 1)}└─ `
        const details = selection
          ? [
              ...(selection.row.task.detail ? [`Note · ${selection.row.task.detail}`] : []),
              ...selection.row.task.notes.map(note => `Note · ${note}`),
              ...selection.row.task.history.map(
                event => `History · ${event.time} · ${event.source}${event.detail ? ` · ${event.detail}` : ''}`,
              ),
            ]
          : []
        return (
          <Box key={`timeline-${row.task.id}`} flexDirection="column">
            <Box flexDirection="row">
              <Text color={tone(row.status)}>
                {'  '.repeat(row.depth)}
                {selected ? '>' : ' '} {branch}
                {marks[row.status] ?? '·'}{' '}
              </Text>
              <Text>{row.task.title}</Text>
              <Text color={pal.muted}>
                {' · '}
                {row.statusLabel} · {row.measure}
              </Text>
              {selected ? <Text color={pal.muted}> </Text> : null}
              {selected
                ? row.actions.map(action => (
                    <Button
                      key={action.action}
                      label={look === 'desktop' ? action.label : `${action.hotkey}: ${action.label}`}
                      hotkey={action.hotkey}
                      plain
                      onPress={() =>
                        action.action === 'select'
                          ? void selectTimelineRow(action.id)
                          : void updateTimelineFolded(folded => toggleTimelineBranch(folded, action.id))
                      }
                    />
                  ))
                : null}
            </Box>
            {row.warnings.map(warning => (
              <Text color={pal.tone.issue ?? pal.muted}>
                {detail}⚠ {warning}
              </Text>
            ))}
            {details.map(line => (
              <Text color={pal.muted}>
                {detail}
                {line}
              </Text>
            ))}
            {selection?.links.length ? (
              <Box flexDirection="row">
                <Text color={pal.muted}>{detail}Links · </Text>
                {selection.links.map(link => (
                  <Box key={`${link.label}-${row.task.id}`} flexDirection="row">
                    <Button
                      label={link.result?.state === 'pending' ? 'Opening…' : link.label}
                      dimColor={link.isOut}
                      onPress={press => void runPress(link.press, press.surface)}
                    />
                    {link.result?.state === 'done' ? <Text color={pal.tone.done}>✓ Opened</Text> : null}
                    {link.result?.state === 'failed' ? (
                      <Text color={pal.tone.issue ?? pal.muted}>
                        {link.result.parts.find(part => part.error)?.error}
                      </Text>
                    ) : null}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )

  return {
    view: timelineView,
    move(step: number) {
      const id = moveTimelineSelection(page.rows, timelineSelection, step)
      if (id) void selectTimelineRow(id)
    },
  }
}
