import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TabsProps } from '../hooks/tabs-client'
import { prMarkId } from '../hooks/pr-rows'
import { applyPrPress } from '../hooks/pr-tab'
import { cellWidth } from '../hooks/text'
import { COMPLETED_FOLD_ID } from '../hooks/timeline-page'
import type { Session } from '../types'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

async function showsGheTimelineLink($: Engine, on: On, surface: 'terminal' | 'desktop') {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  if (surface === 'desktop') w.surfaces = ['desktop']
  let resultState: 'pending' | 'done' = 'pending'
  const refs = [
    ['https://git.example.org/acme/app/pull/12', 'PR #12'],
    ['https://git.example.org/acme/app/issues/34', 'issue #34'],
  ] as const
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    const session = event.value as Session & { revision: number }
    const lastActions = { ...session.lastActions }
    for (const [ref, name] of refs) {
      const applied = applyPrPress(
        session.ledger,
        session.prViews,
        lastActions,
        { action: 'pr-open', ref },
        { now: 1_000_000, turnsStarted: 0 },
      )
      if ('stale' in applied) continue
      const last = applied.lasts[prMarkId(ref)]
      if (!last) continue
      lastActions[prMarkId(ref)] =
        resultState === 'done'
          ? {
              ...last,
              result: {
                state: 'done',
                at: 1_000_000,
                parts: [{ kind: 'open', name, error: null, isCommand: false }],
              },
            }
          : last
    }
    return next({ ...event, value: { ...session, lastActions } })
  })
  await $.session.start({
    cwd: '/tmp/project',
    surface: surface === 'desktop' ? null : surface,
    isInteractive: surface === 'terminal',
  })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'ghe',
    title: 'Review enterprise PR',
    pr: 'https://git.example.org/acme/app/pull/12',
    issue: 'https://git.example.org/acme/app/issues/34',
  } as never)
  const pane = await $.ui.mount({ ...PANE, surface })
  if (surface === 'desktop') {
    const { tabs, gap } = (await pane.find({ key: 'tabs' }))?.props.props as TabsProps
    const timelineAt = tabs
      .slice(
        0,
        tabs.findIndex(tab => tab.id === 'timeline'),
      )
      .reduce((x, tab) => x + tab.width + gap, 0)
    await pane.pointer({ type: 'down', x: timelineAt, y: 1, button: 'left', in: 'tabs' })
  } else {
    await pane.press({ key: 'tab-key-timeline' })
  }
  await clock.settle()
  await pane.press({ key: 'timeline-title-ghe' })
  await clock.settle()

  const buttons = await pane.findAll({ type: 'Button' })
  expect((await pane.findAll({ type: 'Text' })).some(line => line.text.includes('Links'))).toBe(true)
  expect(buttons.filter(button => button.props.label === 'Opening…')).toHaveLength(2)
  expect((await pane.findAll({ type: 'Text' })).filter(line => line.text === '✓ Opened')).toHaveLength(0)

  resultState = 'done'
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'note',
    task_id: 'ghe',
    note: 'Opened the linked items.',
  } as never)
  await clock.settle()
  expect((await pane.findAll({ type: 'Button' })).map(button => button.props.label)).toContain('Open PR')
  expect((await pane.findAll({ type: 'Button' })).map(button => button.props.label)).toContain('Open issue')
  expect((await pane.findAll({ type: 'Text' })).filter(line => line.text === '✓ Opened')).toHaveLength(2)
}

test('the Timeline selection and folds upgrade to defaults in an older save', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let selection: unknown
  let folded: unknown
  let detailOpen: unknown
  on('state.set', { plugin: 'inbox', key: 'timelineSelection' } as const, (_$, event, next) => {
    selection = event.value
    return next(event)
  })
  on('state.set', { plugin: 'inbox', key: 'timelineFolded' } as const, (_$, event, next) => {
    folded = event.value
    return next(event)
  })
  on('state.set', { plugin: 'inbox', key: 'timelineDetailOpen' } as const, (_$, event, next) => {
    detailOpen = event.value
    return next(event)
  })
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

  expect(selection).toBe(null)
  expect(folded).toEqual([])
  expect(detailOpen).toBe(false)
})

test('the next-build pane draws Timeline with its saved selection and folded branch', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  let selectionReads = 0
  let foldedReads = 0
  on('state.get', { plugin: 'inbox', key: 'timelineSelection' } as const, () => {
    selectionReads++
    return { value: { value: 'other', version: 1 } as never }
  })
  on('state.get', { plugin: 'inbox', key: 'timelineFolded' } as const, () => {
    foldedReads++
    return { value: { value: ['plan'], version: 1 } as never }
  })

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'add', task_id: 'plan', title: 'Plan' })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'child',
    parent_id: 'plan',
    title: 'Child',
  })
  await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'add', task_id: 'other', title: 'Other' })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  expect(selectionReads).toBeGreaterThan(0)
  expect(foldedReads).toBeGreaterThan(0)
  const text = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(
    text.some(line => line.includes('Timeline')),
    'Timeline tab',
  ).toBe(true)
  expect(
    text.some(line => line.trim() === '3'),
    'three open tasks appear beside Timeline',
  ).toBe(true)
  expect(text, 'the saved selection row').toContain('Other')
  expect(text, 'the saved selection marker').toContain('> ○ ')
  expect(text, 'the saved folded branch').not.toContain('Child')
})

test('the summary button and key action preserve hidden selection and j/k navigation', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  let selection: { value: string | null; version: number } = { value: 'finished', version: 1 }
  on('state.get', { plugin: 'inbox', key: 'timelineSelection' } as const, () => {
    return { value: selection as never }
  })
  on('state.set', { plugin: 'inbox', key: 'timelineSelection' } as const, (_$, event) => {
    selection = { value: event.value as string | null, version: selection.version + 1 }
    return { value: { isSet: true as const, version: selection.version } }
  })

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  for (const [task_id, status] of [
    ['active-first', 'queued'],
    ['active-last', 'working'],
    ['finished', 'done'],
  ] as const) {
    await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'add', task_id, title: task_id, status })
  }
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  expect((await pane.find({ key: `timeline-title-${COMPLETED_FOLD_ID}` }))?.props.autoFocus).toBe(true)
  await pane.press({ key: 'toggle-branch' })
  await clock.settle()
  expect(selection.value).toBe('finished')
  expect((await pane.find({ key: 'timeline-title-finished' }))?.props.autoFocus).toBe(true)
  await pane.press({ key: `timeline-title-${COMPLETED_FOLD_ID}` })
  await clock.settle()
  expect(selection.value).toBe('finished')
  expect((await pane.find({ key: `timeline-title-${COMPLETED_FOLD_ID}` }))?.props.autoFocus).toBe(true)
  await pane.press({ key: 'previous' })
  await clock.settle()
  expect(selection.value).toBe('active-last')
  await pane.press({ key: 'next' })
  await clock.settle()
  expect(selection.value).toBe('active-first')
})

test('Timeline opens a selected task detail and returns to the selected tree row', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'plan',
    title: 'A flow 21%',
    detail: 'Build the review flow',
  })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'child',
    parent_id: 'plan',
    title: 'Child',
  })
  await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'note', task_id: 'plan', note: 'Keep the row short' })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const buttons = (await pane.findAll({ type: 'Button' })).map(button => button.props)
  expect(
    buttons.some(button => button.label === 'Close branch' && button.hotkey === 'h'),
    'branch action is available',
  ).toBe(true)
  expect(buttons.some(button => button.label === 'Select')).toBe(false)
  const text = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(text).toContain('A flow 21%')
  expect(text.some(line => line.includes('Build the review flow'))).toBe(false)
  expect(
    text.some(line => line.includes('Not started')),
    'the status is visible in the tree',
  ).toBe(true)

  expect((await pane.find({ key: 'timeline-title-plan' }))?.props.autoFocus).toBe(true)
  await pane.press({ key: 'timeline-title-plan' })
  await clock.settle()
  let detail = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(detail, 'the detail view includes the task detail').toContain('Build the review flow')
  expect(detail).toContain('Keep the row short')
  expect(detail.some(line => line.includes('Task created'))).toBe(true)
  expect(detail).toContain('Weight')
  expect(detail).toContain('Completed units')

  await pane.press({ key: 'timeline-back' })
  await clock.settle()
  detail = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(detail).toContain('A flow 21%')
  expect(detail).not.toContain('Build the review flow')
  expect((await pane.findAll({ type: 'Button' })).some(button => button.props.label === 'Close branch')).toBe(true)

  await pane.press({ key: 'next' })
  await clock.settle()
  expect((await pane.find({ key: 'timeline-title-plan' }))?.props.autoFocus).toBeUndefined()
  expect((await pane.find({ key: 'timeline-title-child' }))?.props.autoFocus).toBe(true)
  expect((await pane.find({ key: 'timeline-title-lead-child' }))?.text.startsWith('> ')).toBe(true)
})

test('terminal Timeline keeps Japanese titles, row metadata and detail guides at a narrow dock width', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  const longTitle = '長い日本語のタスクタイトルが狭い端末幅でも状態や進捗率を押し出さないことを確認する'.repeat(2)
  const longDetail = '長い日本語の詳細が折り返されても親のツリーガイドの内側から揃うことを確認する。'.repeat(3)

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'long-root',
    title: longTitle,
    status: 'queued',
  })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'child-a',
    parent_id: 'long-root',
    title: '子タスクの詳細を幅の狭い端末で確認する',
    detail: longDetail,
    status: 'working',
  })
  await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'note', task_id: 'child-a', note: 'A newer Japanese note' })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'child-b',
    parent_id: 'long-root',
    title: '二つ目の子タスク',
    status: 'queued',
  })

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 } })
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const title = await pane.find({ key: 'timeline-title-long-root' })
  expect(title?.text.endsWith('…'), 'the long title is truncated with an ellipsis').toBe(true)
  expect(title?.text).not.toContain(longTitle)
  expect(cellWidth(title?.text ?? '')).toBeGreaterThanOrEqual(20)
  expect(cellWidth(title?.text ?? '')).toBeLessThanOrEqual(30)
  expect(
    await pane.find({ key: 'timeline-row-bar-long-root' }),
    'the bar is dropped to preserve title width',
  ).not.toBeTruthy()
  const lines = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(
    lines.some(line => line.startsWith('> ○ ')),
    'the mark and tree prefix stay on the title line',
  ).toBe(true)
  expect(lines, 'the status chip keeps its label').toContain('Not started')
  expect(
    lines.some(line => line.trim() === '0.00%'),
    'the row percentage keeps every character',
  ).toBe(true)
  expect((await pane.find({ key: 'timeline-progress-bar' }))?.props.flexDirection).toBe('column')

  await pane.press({ key: 'timeline-title-child-a' })
  await clock.settle()
  const detailRow = await pane.find({ key: 'timeline-detail-row-0' })
  const lead = await pane.find({ key: 'timeline-detail-lead-0' })
  expect(lead?.text.includes('│')).toBe(false)
  expect(lead?.text.includes('|')).toBe(false)
  expect(lead?.props.flexShrink).toBe(0)
  expect(typeof lead?.props.width).toBe('number')
  expect((await pane.find({ key: 'timeline-back-gap' }))?.props.width).toBe(1)
  expect(
    detailRow?.children.some(child => typeof child === 'object' && (child as { type?: string }).type === 'Box'),
  ).toBe(true)
  const detailText = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(detailText.some(text => text.includes('子タスク'))).toBe(true)
  expect(detailText).toContain(longDetail)
  expect(detailText).toContain('Current')
  expect(detailText).toContain('Detail')
  expect(detailText).toContain('History')
  expect(detailText).toContain('A newer Japanese note')
})

test('terminal Timeline aligns percentages, strips rows, and separates only top-level trees', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__inbox__tasks', operation: 'add', task_id: 'zero', title: 'Zero', status: 'queued' })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'forty',
    title: 'Forty',
    status: 'working',
  })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'forty-done',
    parent_id: 'forty',
    title: 'Done child',
    status: 'done',
    weight: 2,
  } as never)
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'forty-open',
    parent_id: 'forty',
    title: 'Open child',
    status: 'queued',
    weight: 3,
  } as never)
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'dropped',
    parent_id: 'forty-open',
    title: 'Dropped',
    status: 'dropped',
  } as never)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const row = async (id: string) => pane.find({ key: `timeline-${id}` })
  for (const [id, paddingTop] of [
    ['zero', 0],
    ['forty', 1],
    ['forty-done', 0],
    ['forty-open', 0],
    ['dropped', 0],
  ] as const) {
    const element = await row(id)
    expect(element?.props.paddingTop, `${id} spacing`).toBe(paddingTop)
    expect(element?.props.backgroundColor, `${id} has no alternate band`).toBeUndefined()
  }

  const percentages = await Promise.all(
    ['zero', 'forty', 'forty-done'].map(async id => (await row(id))?.text.match(/ {1,3}(?:0|40|100)\.00%/)?.[0]),
  )
  expect(percentages).toEqual(['   0.00%', '  40.00%', ' 100.00%'])
  expect(percentages.map(text => cellWidth(text ?? ''))).toEqual([8, 8, 8])
  const bars = await Promise.all(
    ['zero', 'forty', 'forty-done'].map(async id => (await pane.find({ key: `timeline-row-bar-${id}` }))?.text ?? ''),
  )
  expect(bars.map(text => cellWidth(text))).toEqual([12, 12, 12])
  const text = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(
    text.some(line => line.trim() === '3'),
    'three open tasks appear beside Timeline',
  ).toBe(true)
})

test('the desktop Timeline keeps the existing inline tree while this look is pending', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  w.surfaces = ['desktop']
  on('state.get', { plugin: 'inbox', key: 'timelineSelection' } as const, () => {
    return { value: { value: 'plan', version: 1 } as never }
  })
  on('state.get', { plugin: 'inbox', key: 'timelineFolded' } as const, () => {
    return { value: { value: [], version: 1 } as never }
  })

  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  for (const [task_id, parent_id] of [
    ['plan', undefined],
    ['branch', 'plan'],
    ['leaf', 'branch'],
  ] as const) {
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id,
      ...(parent_id ? { parent_id } : {}),
      title: task_id,
    })
  }
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 120 } })
  const { tabs, gap } = (await pane.find({ key: 'tabs' }))?.props.props as TabsProps
  const timelineAt = tabs
    .slice(
      0,
      tabs.findIndex(tab => tab.id === 'timeline'),
    )
    .reduce((x, tab) => x + tab.width + gap, 0)
  await pane.pointer({ type: 'down', x: timelineAt, y: 1, button: 'left', in: 'tabs' })
  await clock.settle()

  const buttons = await pane.findAll({ type: 'Button' })
  expect(buttons.some(button => button.key === 'detail')).toBe(false)
  expect(buttons.some(button => button.key === 'toggle-branch' && button.props.label === 'Close branch')).toBe(true)
  expect(buttons.some(button => button.key === 'next' || button.key === 'previous')).toBe(false)
  expect(
    (await pane.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('timeline-title-')),
  ).toHaveLength(3)
  const text = (await pane.findAll({ type: 'Text' })).map(node => node.text)
  expect(text.some(line => line.includes('Task plan'))).toBe(true)
  expect(text).not.toContain('Progress')
})

test('the terminal Timeline shows Opening and Opened for GitHub Enterprise PR and issue links', async ($, on) => {
  await showsGheTimelineLink($, on, 'terminal')
})

test('the desktop Timeline shows Opening and Opened for GitHub Enterprise PR and issue links', async ($, on) => {
  await showsGheTimelineLink($, on, 'desktop')
})
