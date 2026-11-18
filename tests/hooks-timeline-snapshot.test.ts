import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { cellWidth, cutToCells } from '../hooks/text'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

const nestedTasks: { id: string; parent_id?: string; title: string; status: 'working' | 'waits-on-other' | 'done' }[] =
  [
    { id: 'scene-root', title: 'Review task tree', status: 'working' },
    {
      id: 'scene-wrap',
      parent_id: 'scene-root',
      title: '折り返し用の日本語タイトル\n次の行も表示する',
      status: 'done',
    },
    {
      id: 'scene-long',
      parent_id: 'scene-root',
      title: '長い日本語の作業内容を確認するためのタイトル'.repeat(3),
      status: 'working',
    },
    {
      id: 'scene-deep',
      parent_id: 'scene-long',
      title: 'ログと結果を見て仕上がりを確かめる',
      status: 'waits-on-other',
    },
    {
      id: 'scene-warning',
      title: '表示を今朝の行に戻す（⚠️ だけ足す）。個人の上限は今のまま',
      status: 'done',
    },
  ]

async function openTree($: Engine, on: On, bodyColumns: number) {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  for (const task of nestedTasks) {
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id: task.id,
      ...(task.parent_id ? { parent_id: task.parent_id } : {}),
      title: task.title,
      status: task.status,
    })
  }
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns } })
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()
  return { clock, pane }
}

for (const bodyColumns of [110, 200] as const) {
  test(`terminal Timeline tree text snapshot at ${bodyColumns} columns`, async ($, on) => {
    const { pane } = await openTree($, on, bodyColumns)
    const ids = ['scene-root', 'scene-wrap', 'scene-long', 'scene-deep', 'scene-warning']
    const snapshot = []
    const rowEnds = []
    for (const id of ids) {
      const title = await pane.find({ key: `timeline-title-${id}` })
      const status = await pane.find({ key: `timeline-chip-${id}` })
      const titleLead = await pane.find({ key: `timeline-title-lead-${id}` })
      const titleTextArea = await pane.find({ key: `timeline-title-text-${id}` })
      const chipGap = await pane.find({ key: `timeline-chip-gap-${id}` })
      const titleArea = await pane.find({ key: `timeline-title-area-${id}` })
      const bar = await pane.find({ key: `timeline-row-bar-${id}` })
      const gap = await pane.find({ key: `timeline-row-bar-gap-${id}` })
      const percent = await pane.find({ key: `timeline-row-percent-${id}` })
      expect(cellWidth(titleLead?.text ?? ''), `${id} title lead uses its measured cells`).toBe(titleLead?.props.width)
      expect(titleArea?.props.flexDirection, `${id} puts title and chip in one horizontal row`).toBe('row')
      expect(titleArea?.props.flexGrow, `${id} keeps its measured title budget fixed`).toBeUndefined()
      expect(chipGap?.props.width, `${id} leaves one cell between title and chip`).toBe(1)
      expect(cellWidth(chipGap?.text ?? ''), `${id} renders the title-to-chip gap`).toBe(1)
      const chipWidth = cellWidth(status?.text ?? '') + 2 * Number(status?.props.paddingX)
      expect(Number(titleTextArea?.props.width), `${id} title box ends at the displayed title`).toBe(
        cellWidth(title?.text ?? ''),
      )
      expect(
        cellWidth(title?.text ?? '') + Number(chipGap?.props.width) + chipWidth,
        `${id} keeps the title, gap and whole chip inside its row budget`,
      ).toBeLessThanOrEqual(Number(titleArea?.props.width))
      expect(
        Number(titleTextArea?.props.width) + Number(chipGap?.props.width) + chipWidth,
        `${id} leaves free space after the chip for the fixed bar column`,
      ).toBeLessThanOrEqual(Number(titleArea?.props.width))
      const titleAreaChildren = (titleArea?.children ?? []).filter(
        (child): child is { props?: Record<string, unknown>; text?: string } =>
          typeof child === 'object' && child !== null,
      )
      expect(titleAreaChildren, `${id} draws title, gap, then chip on one line`).toHaveLength(3)
      expect(titleAreaChildren[0]?.props?.width, `${id} puts the title first`).toBe(titleTextArea?.props.width)
      expect(titleAreaChildren[1]?.props?.width, `${id} puts the one-cell gap second`).toBe(1)
      expect(titleAreaChildren[2]?.props?.paddingX, `${id} puts the whole chip last`).toBe(1)
      expect(status?.text, `${id} keeps its status label visible`).toBeTruthy()
      expect(await pane.find({ key: `timeline-status-line-${id}` }), `${id} has no separate chip row`).toBeFalsy()
      const rowEnd =
        cellWidth(titleLead?.text ?? '') +
        Number(titleArea?.props.width) +
        Number(gap?.props.width ?? 0) +
        (bar ? 10 : 0) +
        cellWidth(percent?.text ?? '')
      expect(rowEnd, `${id} title, bar and percent fit in the row budget`).toBeLessThanOrEqual(bodyColumns - 4)
      rowEnds.push(rowEnd)
      if (bar) {
        expect(gap?.props.width, `${id} keeps two cells between its chip and bar`).toBe(2)
      }
      const line = titleLead?.text ?? ''
      expect(line).not.toContain('|')
      expect(line).not.toContain('│ │')
      expect(line.at(-1), `${id} leaves a cell between its guide and title`).toBe(' ')
      for (const match of line.matchAll(/│/g)) {
        expect(Number(match.index) % 3).toBe(2)
        expect(Number(match.index), `${id} guide does not touch the title`).toBeLessThan(line.length - 1)
      }
      if (title?.text.endsWith('…') && bar) {
        expect(gap?.props.width, `${id} has a two-cell gap after its truncated title`).toBeGreaterThanOrEqual(2)
        expect(
          (titleArea?.props.width as number) - cellWidth(title.text) + (gap?.props.width as number),
          `${id} bar starts at least two cells after the displayed ellipsis`,
        ).toBeGreaterThanOrEqual(2)
      }
      const continuation = (await pane.findAll({ type: 'Text' })).find(line => line.text === '次の行も表示する')
      const displayedTitle =
        id === 'scene-wrap' ? `${title?.text ?? ''}\n${continuation?.text ?? ''}` : (title?.text ?? '')
      snapshot.push([id, displayedTitle, status?.text ?? null])
    }
    expect(new Set(rowEnds).size, 'every percent shares the same ending column').toBe(1)
    const labels = (await pane.findAll({ type: 'Text' })).map(line => line.text)
    const renderedText = await pane.findAll({ type: 'Text' })
    const continuationIndex = renderedText.findIndex(line => line.text === '次の行も表示する')
    const continuationLead = renderedText[continuationIndex - 1]?.text ?? ''
    expect(continuationLead[2], 'wrapped title keeps the child-group guide').toBe('│')
    expect(continuationLead.at(-1), 'wrapped title guide leaves a cell before the text').toBe(' ')
    snapshot.unshift(['heading', labels.includes('Progress') ? 'Progress' : null])
    const titleArea = await pane.find({ key: 'timeline-title-area-scene-long' })
    const longTask = nestedTasks.find(task => task.id === 'scene-long')!
    const longTitleCells = Number(titleArea?.props.width) - cellWidth('In progress') - 2 - 1
    const longTitle =
      cellWidth(longTask.title) > longTitleCells ? `${cutToCells(longTask.title, longTitleCells - 1)}…` : longTask.title
    const warningTask = nestedTasks.find(task => task.id === 'scene-warning')!
    const warningArea = await pane.find({ key: 'timeline-title-area-scene-warning' })
    const warningTitleCells = Number(warningArea?.props.width) - cellWidth('Completed') - 2 - 1
    const warningTitle =
      cellWidth(warningTask.title) > warningTitleCells
        ? `${cutToCells(warningTask.title, warningTitleCells - 1)}…`
        : warningTask.title
    expect(cellWidth('⚠️'), 'the warning emoji presentation sequence uses two cells').toBe(2)
    expect(snapshot).toEqual([
      ['heading', 'Progress'],
      ['scene-root', 'Review task tree', 'In progress'],
      ['scene-wrap', '折り返し用の日本語タイトル\n次の行も表示する', 'Completed'],
      ['scene-long', longTitle, 'In progress'],
      ['scene-deep', 'ログと結果を見て仕上がりを確かめる', 'Waiting'],
      ['scene-warning', warningTitle, 'Completed'],
    ])
  })
}

for (const bodyColumns of [110, 200] as const) {
  test(`terminal Timeline empty and detail text snapshot at ${bodyColumns} columns`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    world($, on, [])
    w.files = ['/.next-build']
    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
    const emptyPane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns } })
    await emptyPane.press({ key: 'tab-key-timeline' })
    await clock.settle()
    const emptyText = (await emptyPane.findAll({ type: 'Text' })).map(line => line.text)
    expect(emptyText).toContain('Progress')
    expect(emptyText).toContain('No tasks have been recorded for this session.')

    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id: 'detail-scene',
      title: '日本語の詳細を確認する',
      detail: '登録した説明はCurrentとは別に残る。',
      status: 'done',
    })
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'note',
      task_id: 'detail-scene',
      note: '最新の作業メモはここに表示する。',
    })
    await clock.settle()
    await emptyPane.press({ key: 'timeline-title-detail-scene' })
    await clock.settle()

    const header = await emptyPane.find({ key: 'timeline-back' })
    const gap = await emptyPane.find({ key: 'timeline-back-gap' })
    const headerRow = await emptyPane.find({ key: 'timeline-detail-header' })
    expect(header?.props.label).toBe('‹ Back')
    expect(gap?.props.width).toBe(1)
    expect(cellWidth(String(header?.props.label)) + Number(gap?.props.width)).toBe(7)
    expect(cellWidth(String(header?.props.label)) + Number(gap?.props.width) + 1).toBe(8)
    const headerChildren = (headerRow?.children ?? []).filter(
      (child): child is { props?: Record<string, unknown> } => typeof child === 'object' && child !== null,
    )
    expect(headerChildren[0]?.props?.flexShrink).toBe(0)
    expect(headerChildren[1]?.props?.width).toBe(1)
    expect(headerChildren[2]?.props?.flexGrow).toBe(1)
    expect(await emptyPane.find({ key: 'timeline-detail-title-area' })).toBeTruthy()
    const detailText = (await emptyPane.findAll({ type: 'Text' })).map(line => line.text)
    expect(detailText).toContain('日本語の詳細を確認する')
    expect(detailText).toContain('Completed')
    expect(detailText).toContain('最新の作業メモはここに表示する。 · now')
    expect(detailText).toContain('登録した説明はCurrentとは別に残る。')
    const detailSnapshot = detailText.flatMap(text => {
      if (['Current', 'Detail', 'History'].includes(text)) return [text]
      if (text === '最新の作業メモはここに表示する。 · now') return ['Current: 最新の作業メモはここに表示する。 · now']
      if (text === '登録した説明はCurrentとは別に残る。') return ['Detail: 登録した説明はCurrentとは別に残る。']
      if (text.includes('Task created')) return ['History: Task created']
      return []
    })
    expect(detailSnapshot).toEqual([
      'Current',
      'Current: 最新の作業メモはここに表示する。 · now',
      'Detail',
      'Detail: 登録した説明はCurrentとは別に残る。',
      'History',
      'History: Task created',
      'History',
    ])
    for (let index = 0; index < 4; index++) {
      const lead = await emptyPane.find({ key: `timeline-detail-lead-${index}` })
      expect(lead?.text).not.toContain('|')
      expect(lead?.text).not.toContain('│')
      expect(cellWidth(lead?.text ?? '')).toBe(lead?.props.width)
    }
  })
}
