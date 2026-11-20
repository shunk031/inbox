import type { PaneBase, PaneHandlers } from './pane-context'
import { cellWidth, cutToCells } from './text'
import { moveTimelineSelection, timelinePage, toggleTimelineBranch } from './timeline-page'
import type { TimelinePage } from './timeline-page'

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

function timelineRowLead(row: { prefix: string; mark: string }, selected: boolean) {
  return `${selected ? '> ' : '  '}${row.prefix}${row.mark} `
}

function padToCells(text: string, cells: number) {
  const fitted = cutToCells(text, cells)
  return fitted + ' '.repeat(Math.max(0, cells - cellWidth(fitted)))
}

function terminalTreeLead(row: TimelinePage['rows'][number], cells: number) {
  const siblingGuide = row.depth > 0 ? (row.hasLaterSibling ? '│  ' : '   ') : ''
  const childGuide = row.hasVisibleChildren ? '│  ' : '   '
  return padToCells(`  ${row.guides.join('')}${siblingGuide}${childGuide}`, cells)
}

export function timelineRowBackground(pal: PaneBase['pal'], alternate: boolean) {
  return alternate ? (pal.card ?? pal.line) : undefined
}

type TimelinePaneBase = Pick<
  PaneBase,
  'Box' | 'Button' | 'Text' | 'pal' | 'look' | 'view' | 'timelineSelection' | 'timelineFolded' | 'timelineDetailOpen'
> & { bodyColumns: number }
type TimelinePaneHandlers = Pick<
  PaneHandlers,
  'runPress' | 'selectTimelineRow' | 'updateTimelineFolded' | 'openTimelineDetail' | 'closeTimelineDetail'
>

export function paneTimeline(context: TimelinePaneBase, handlers: TimelinePaneHandlers) {
  const { Box, Button, Text, pal, look, view, timelineSelection, timelineFolded, timelineDetailOpen } = context
  const { selectTimelineRow, updateTimelineFolded, openTimelineDetail, closeTimelineDetail, runPress } = handlers
  const page = timelinePage(
    view.timeline,
    timelineSelection,
    timelineFolded,
    view.lastActions,
    look === 'terminal' && timelineDetailOpen,
    true,
  )
  const toggleCompletedFold = async (id: string) => {
    if (timelineDetailOpen) await closeTimelineDetail()
    await updateTimelineFolded(folded => toggleTimelineBranch(folded, id))
  }
  const selectOrToggleDone = (id: string, isCompletedFold: boolean) => {
    if (isCompletedFold) void toggleCompletedFold(id)
    else void selectTimelineRow(id)
  }
  if (look === 'desktop') {
    const color = (tone: string) =>
      tone === 'done'
        ? (pal.tone.done ?? pal.muted)
        : tone === 'error'
          ? (pal.tone.issue ?? pal.muted)
          : tone === 'key'
            ? (pal.tone.needsYou ?? pal.muted)
            : pal.muted
    const bar = (parts: typeof page.progressCard.bar) =>
      parts.map(part => <Text color={color(part.tone)}>{part.mark.repeat(part.count)}</Text>)
    const timelineView = (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={pal.muted}>
            {`Task plan · ${page.progressCard.percentLabel} complete · ${page.progressCard.leavesDone}/${page.progressCard.leavesTotal} leaf tasks`}
          </Text>
          {page.progressCard.bar.length ? <Text color={pal.muted}> · </Text> : null}
          {bar(page.progressCard.bar)}
        </Box>
        {page.isEmpty ? (
          <Box flexDirection="column">
            <Text bold>{page.empty.title}</Text>
            <Text color={pal.muted}>{page.empty.hint}</Text>
          </Box>
        ) : null}
        {page.rows.map(row => {
          const selected = row.task.id === page.selected?.row.task.id
          const selection = selected ? page.selected : null
          return (
            <Box key={`timeline-${row.task.id}`} flexDirection="column">
              <Box flexDirection="row">
                <Text color={color(row.tone)}>
                  {selected ? '> ' : '  '}
                  {row.prefix}
                  {row.mark}{' '}
                </Text>
                <Button
                  plain
                  key={`timeline-title-${row.task.id}`}
                  label={row.task.title}
                  onPress={() => selectOrToggleDone(row.task.id, row.isCompletedFold === true)}
                />
                {!row.isCompletedFold ? (
                  <Text color={pal.muted}>{` · ${row.statusLabel} · ${row.percent}`}</Text>
                ) : null}
              </Box>
              {row.warnings.map(warning => (
                <Text color={pal.tone.issue ?? pal.muted}>{`${row.treeLead}⚠ ${warning}`}</Text>
              ))}
              {selection?.details.map(line =>
                line.label === 'Links' ? (
                  <Box flexDirection="row">
                    <Text color={pal.muted}>{`${row.detailLead}Links · `}</Text>
                    {line.actions.map(link => (
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
                ) : (
                  <Text color={pal.muted}>{`${row.detailLead}${line.label} · ${line.text}`}</Text>
                ),
              )}
            </Box>
          )
        })}
      </Box>
    )
    const action = page.selected?.row.actions.find(item => item.action === 'toggle-branch')
    const footer = action ? (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          key={action.action}
          label={action.label}
          hotkey={action.hotkey === 'enter' ? undefined : action.hotkey}
          plain
          onPress={() => void toggleCompletedFold(action.id)}
        />
      </Box>
    ) : null
    return {
      view: timelineView,
      footer,
      move(step: number) {
        const id = moveTimelineSelection(page.rows, page.selected?.row.task.id ?? null, step)
        if (id) void selectTimelineRow(id)
      },
    }
  }
  const widthForCells = (text: string) => cellWidth(text)
  const bodyColumns = context.bodyColumns
  const paneWidth = widthForCells(' '.repeat(bodyColumns))
  const color = (tone: string) => timelineToneColor(pal, tone)
  const chip = (label: string, tone: string, key?: string) => timelineChip({ Box, Text, pal }, label, tone, key)
  const bar = (parts: typeof page.progressCard.bar, emptyWidth = 10) =>
    parts.length ? (
      parts.map(part => <Text color={color(part.tone)}>{part.mark.repeat(part.count)}</Text>)
    ) : (
      <Text color={pal.muted}>{'─'.repeat(emptyWidth)}</Text>
    )

  const progressCard = (
    <Box width={paneWidth} flexDirection="column" borderStyle="single" paddingX={1}>
      <Box flexDirection={bodyColumns < 28 ? 'column' : 'row'} justifyContent="space-between">
        <Box flexShrink={0}>
          <Text bold>Progress</Text>
        </Box>
        <Box flexShrink={0}>{chip(page.progressCard.statusLabel, page.progressCard.tone)}</Box>
      </Box>
      <Box
        key="timeline-progress-bar"
        flexDirection={bodyColumns < 44 ? 'column' : 'row'}
        justifyContent="space-between"
      >
        <Box flexDirection="row" flexShrink={0}>
          {bar(page.progressCard.bar, 28)}
        </Box>
        <Box flexShrink={0}>
          <Text bold>{page.progressCard.percentLabel}</Text>
        </Box>
      </Box>
      <Box flexDirection={bodyColumns < 44 ? 'column' : 'row'} justifyContent="space-between">
        <Text
          color={pal.muted}
        >{`${page.progressCard.leavesDone}/${page.progressCard.leavesTotal} leaf tasks completed`}</Text>
        <Text color={pal.muted}>{`Elapsed: ${page.progressCard.elapsed}`}</Text>
      </Box>
    </Box>
  )

  const selected = page.selected
  const detailLead = selected ? ' '.repeat(cellWidth(selected.row.detailLead)) : ''
  const detailTitle = selected
    ? cellWidth(selected.row.task.title) > Math.max(1, bodyColumns - 27)
      ? `${cutToCells(selected.row.task.title, Math.max(0, bodyColumns - 28))}…`
      : selected.row.task.title
    : ''
  const detailView = selected ? (
    <Box key="timeline-detail" width={paneWidth} flexDirection="column" gap={1}>
      <Box key="timeline-detail-header" flexDirection="row" alignItems="flex-start">
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
        <Box key={`timeline-detail-row-${index}`} flexDirection="row" alignItems="flex-start">
          <Box key={`timeline-detail-lead-${index}`} width={widthForCells(detailLead)} flexShrink={0}>
            <Text>{detailLead}</Text>
          </Box>
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

  const timelineView =
    page.mode === 'detail' ? (
      detailView
    ) : (
      <Box width={paneWidth} flexDirection="column" gap={1}>
        {progressCard}
        {page.isEmpty ? (
          <Box flexDirection="column">
            <Text bold>{page.empty.title}</Text>
            <Text color={pal.muted}>{page.empty.hint}</Text>
          </Box>
        ) : null}
        <Box flexDirection="column">
          {page.rows.map((row, rowIndex) => {
            const selected = row.task.id === page.selected?.row.task.id
            const rowLead = timelineRowLead(row, selected)
            const titleLeadWidth = cellWidth(rowLead)
            const chipLeadWidth = titleLeadWidth
            const chipLead = terminalTreeLead(row, chipLeadWidth)
            const warningLead = terminalTreeLead(row, titleLeadWidth)
            const percent = row.isCompletedFold ? '' : row.percent.padStart(7)
            const percentCells = row.isCompletedFold ? 0 : cellWidth(` ${percent}`)
            const availableWithBar = bodyColumns - 2 - cellWidth(rowLead) - 12 - percentCells
            const showTaskBar = availableWithBar >= 20
            const titleCells = Math.max(1, bodyColumns - 2 - cellWidth(rowLead) - percentCells - (showTaskBar ? 12 : 0))
            const title =
              cellWidth(row.task.title) > titleCells
                ? `${cutToCells(row.task.title, Math.max(0, titleCells - 1))}…`
                : row.task.title
            const [firstTitleLine = '', ...continuationTitleLines] = title.split('\n')
            return (
              <Box
                key={`timeline-${row.task.id}`}
                width={paneWidth}
                flexDirection="column"
                paddingX={1}
                paddingTop={row.depth === 0 && rowIndex > 0 ? 1 : 0}
              >
                <Box flexDirection="row" alignItems="flex-start">
                  <Box key={`timeline-title-lead-${row.task.id}`} width={widthForCells(rowLead)} flexShrink={0}>
                    <Text color={color(row.tone)}>
                      {selected ? '> ' : '  '}
                      {row.prefix}
                      {row.mark}{' '}
                    </Text>
                  </Box>
                  <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
                    <Box key={`timeline-title-area-${row.task.id}`} width={titleCells} flexShrink={1} minWidth={0}>
                      <Button
                        plain
                        key={`timeline-title-${row.task.id}`}
                        autoFocus={look === 'terminal' && selected ? true : undefined}
                        onPress={() =>
                          row.isCompletedFold
                            ? selectOrToggleDone(row.task.id, true)
                            : void openTimelineDetail(row.task.id)
                        }
                      >
                        {look === 'terminal' ? (
                          <Text color={color(row.tone)} wrap="truncate-end">
                            {firstTitleLine}
                          </Text>
                        ) : (
                          firstTitleLine
                        )}
                      </Button>
                    </Box>
                    <Box flexDirection="row" flexShrink={0}>
                      {showTaskBar && !row.isCompletedFold ? (
                        <Box key={`timeline-row-bar-${row.task.id}`} flexDirection="row" flexShrink={0}>
                          <Box key={`timeline-row-bar-gap-${row.task.id}`} width={2} flexShrink={0}>
                            <Text>{'  '}</Text>
                          </Box>
                          {bar(row.progressBar)}
                        </Box>
                      ) : null}
                      {!row.isCompletedFold ? (
                        <Box flexShrink={0}>
                          <Text
                            key={`timeline-row-percent-${row.task.id}`}
                            color={color(row.tone)}
                          >{` ${percent}`}</Text>
                        </Box>
                      ) : null}
                    </Box>
                  </Box>
                </Box>
                {continuationTitleLines.map((line, index) => (
                  <Box key={`timeline-title-continuation-row-${row.task.id}-${index}`} flexDirection="row">
                    <Box width={titleLeadWidth} flexShrink={0}>
                      <Text key={`timeline-title-continuation-lead-${row.task.id}-${index}`} color={color(row.tone)}>
                        {terminalTreeLead(row, titleLeadWidth)}
                      </Text>
                    </Box>
                    <Box width={titleCells} flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text
                        key={`timeline-title-continuation-${row.task.id}-${index}`}
                        color={color(row.tone)}
                        wrap="truncate-end"
                      >
                        {line}
                      </Text>
                    </Box>
                  </Box>
                ))}
                {!row.isCompletedFold ? (
                  <Box key={`timeline-status-line-${row.task.id}`} flexDirection="row">
                    <Box key={`timeline-chip-lead-${row.task.id}`} width={chipLeadWidth} flexShrink={0}>
                      <Text>{chipLead}</Text>
                    </Box>
                    {chip(row.statusLabel, row.tone, `timeline-chip-${row.task.id}`)}
                  </Box>
                ) : null}
                {row.warnings.map(warning => (
                  <Text color={pal.tone.error ?? pal.muted}>{`${warningLead}⚠ ${warning}`}</Text>
                ))}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  const footer =
    page.mode === 'detail' ? null : page.selected?.row.actions.length ? (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {page.selected.row.actions.map(action => (
          <Button
            key={action.action}
            label={action.label}
            hotkey={action.hotkey === 'enter' ? undefined : action.hotkey}
            plain
            onPress={() =>
              action.action === 'detail'
                ? void openTimelineDetail(action.id)
                : action.action === 'select'
                  ? void selectTimelineRow(action.id)
                  : action.action === 'back'
                    ? void closeTimelineDetail()
                    : void toggleCompletedFold(action.id)
            }
          />
        ))}
      </Box>
    ) : null

  return {
    view: timelineView,
    footer,
    async move(step: number) {
      if (page.mode !== 'tree') return
      const id = moveTimelineSelection(page.rows, page.selected?.row.task.id ?? null, step)
      if (id) await selectTimelineRow(id, `timeline-title-${id}`)
    },
  }
}
