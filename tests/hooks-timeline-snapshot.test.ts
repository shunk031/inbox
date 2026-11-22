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
    const ids = ['scene-root', 'scene-wrap', 'scene-long', 'scene-deep']
    const snapshot = []
    const rowEnds = []
    for (const id of ids) {
      const title = await pane.find({ key: `timeline-title-${id}` })
      const status = await pane.find({ key: `timeline-chip-${id}` })
      const titleLead = await pane.find({ key: `timeline-title-lead-${id}` })
      const chipLead = await pane.find({ key: `timeline-chip-lead-${id}` })
      const titleArea = await pane.find({ key: `timeline-title-area-${id}` })
      const bar = await pane.find({ key: `timeline-row-bar-${id}` })
      const gap = await pane.find({ key: `timeline-row-bar-gap-${id}` })
      const percent = await pane.find({ key: `timeline-row-percent-${id}` })
      expect(chipLead?.props.width, `${id} chip begins in the title's first cell`).toBe(titleLead?.props.width)
      expect(cellWidth(titleLead?.text ?? ''), `${id} title lead uses its measured cells`).toBe(titleLead?.props.width)
      expect(cellWidth(chipLead?.text ?? ''), `${id} chip lead fills the title column`).toBe(titleLead?.props.width)
      expect(titleArea?.props.flexGrow, `${id} keeps its measured title budget fixed`).toBeUndefined()
      const rowEnd =
        cellWidth(titleLead?.text ?? '') +
        Number(titleArea?.props.width) +
        Number(gap?.props.width ?? 0) +
        (bar ? 10 : 0) +
        cellWidth(percent?.text ?? '')
      expect(rowEnd, `${id} title, bar and percent fit in the row budget`).toBeLessThanOrEqual(bodyColumns - 4)
      rowEnds.push(rowEnd)
      for (const line of [titleLead?.text ?? '', chipLead?.text ?? '']) {
        expect(line).not.toContain('|')
        expect(line).not.toContain('│ │')
        expect(line.at(-1), `${id} leaves a cell before the chip`).toBe(' ')
        for (const match of line.matchAll(/│/g)) {
          expect(Number(match.index) % 3).toBe(2)
          expect(Number(match.index), `${id} guide does not touch the chip`).toBeLessThan(line.length - 1)
        }
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
    const longTitle =
      bodyColumns === 110 ? `${cutToCells(longTask.title, (titleArea?.props.width as number) - 1)}…` : longTask.title
    expect(snapshot).toEqual([
      ['heading', 'Progress'],
      ['scene-root', 'Review task tree', 'No report yet'],
      ['scene-wrap', '折り返し用の日本語タイトル\n次の行も表示する', 'No report yet'],
      ['scene-long', longTitle, 'No report yet'],
      ['scene-deep', 'ログと結果を見て仕上がりを確かめる', 'No report yet'],
    ])
  })
}

for (const bodyColumns of [87, 110, 200] as const) {
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
    await emptyPane.press({ key: 'toggle-branch' })
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
    expect(detailText).toContain('Latest report')
    expect(detailText).toContain('No report yet')
    const headings = detailText.filter(text => /^(Note|History)$/u.test(text))
    expect(headings).toEqual(['Note', 'History'])
    expect(detailText).not.toContain('登録した説明はCurrentとは別に残る。')
    expect(detailText).toContain('最新の作業メモはここに表示する。')
    for (let index = 0; index < 4; index++) {
      const lead = await emptyPane.find({ key: `timeline-detail-lead-${index}` })
      expect(lead, `detail block ${index} starts at the page edge`).toBeFalsy()
    }
  })
}

test('desktop Timeline details start at the page edge', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  await $.session.start({ cwd: '/tmp/project', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'desktop-root',
    title: 'Desktop root',
    detail: 'A neutral desktop detail.',
    status: 'working',
  })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'desktop-child',
    parent_id: 'desktop-root',
    title: 'Desktop child',
    detail: 'A neutral child detail.',
    status: 'queued',
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 110 } })
  const { tabs, gap } = (await pane.find({ key: 'tabs' }))?.props.props as {
    tabs: { id: string; width: number }[]
    gap: number
  }
  const timelineX = tabs
    .slice(
      0,
      tabs.findIndex(tab => tab.id === 'timeline'),
    )
    .reduce((x, tab) => x + tab.width + gap, 0)
  await pane.pointer({ type: 'down', x: timelineX, y: 1, button: 'left', in: 'tabs' })
  await clock.settle()

  const lines = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(lines).toContain('Latest report · No report yet')
  expect(lines).not.toContain('Latest report · A neutral desktop detail.')
})
