import { expect, mock, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('terminal Timeline aligns status chips with title columns', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [], { HERDR_META_PATROL_STATE_DIR: '/tmp/meta-fixture' })
  w.files = ['/.next-build']
  w.written['/tmp/meta-fixture/queue.jsonl'] = JSON.stringify({
    seq: 1,
    t: 995,
    kind: 'message',
    from: 'worker-1',
    machine: 'local',
    text: 'DONE worker-1: task completed',
  })
  const prUrl = 'https://github.com/example/project/pull/13'
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  for (const [task_id, parent_id, title] of [
    ['done-parent', undefined, 'Completed parent'],
    ['done-child-a', 'done-parent', 'First completed child'],
    ['done-child-b', 'done-parent', 'Second completed child'],
    ['done-child-c', 'done-parent', 'Third completed child'],
    ['done-child-d', 'done-parent', 'Fourth completed child'],
  ] as const) {
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id,
      ...(parent_id ? { parent_id } : {}),
      title,
      status: task_id === 'done-child-d' ? 'queued' : 'done',
    })
  }
  for (const [task_id, parent_id, status] of [
    ['root', undefined, 'working'],
    ['stalled-task', 'root', 'working'],
    ['stalled-child', 'stalled-task', 'queued'],
    ['stalled-sibling', 'stalled-task', 'queued'],
    ['pr-task', 'root', 'working'],
    ['pr-child', 'pr-task', 'queued'],
    ['pr-sibling', 'pr-task', 'queued'],
    ['normal-sibling', 'root', 'queued'],
  ] as const) {
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id,
      ...(parent_id ? { parent_id } : {}),
      title:
        task_id === 'stalled-sibling'
          ? '長い日本語タイトルの切り詰めを確認する'.repeat(5)
          : task_id === 'pr-sibling'
            ? '折り返しを含む日本語タスク\n二行目も確認する'
            : task_id,
      status,
      ...(task_id === 'stalled-task' ? { owner_agent: 'worker-1', owner_machine: 'local' } : {}),
      ...(task_id === 'pr-task' ? { pr: prUrl } : {}),
    })
  }

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 200 } })
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const rows = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect((await pane.find({ key: 'timeline-chip-stalled-task' }))?.text).toBe('Completed')
  const taskIds = [
    'done-parent',
    'done-child-a',
    'done-child-b',
    'done-child-c',
    'done-child-d',
    'root',
    'stalled-task',
    'stalled-child',
    'stalled-sibling',
    'pr-task',
    'pr-child',
    'pr-sibling',
    'normal-sibling',
  ]
  for (const id of taskIds) {
    const titleLead = await pane.find({ key: `timeline-title-lead-${id}` })
    const statusLine = await pane.find({ key: `timeline-status-line-${id}` })
    const chipLead = await pane.find({ key: `timeline-chip-lead-${id}` })
    const statusChip = await pane.find({ key: `timeline-chip-${id}` })
    expect(chipLead?.props.width, `${id} chip's left edge starts at the title's first column`).toBe(
      titleLead?.props.width,
    )
    expect(cellWidth(titleLead?.text ?? ''), `${id} title begins after its measured lead`).toBe(titleLead?.props.width)
    expect(cellWidth(chipLead?.text ?? ''), `${id} guide lead fills the measured title lead`).toBe(
      titleLead?.props.width,
    )
    expect(statusLine?.props.gap, `${id} chip follows the title-column lead without a gap`).toBeUndefined()
    expect(statusChip?.props.paddingX, `${id} chip padding is included in alignment`).toBe(1)
    expect(statusChip, `${id} chip is rendered`).toBeTruthy()
    expect(chipLead?.text).not.toContain('|')
    for (const match of (chipLead?.text ?? '').matchAll(/│/g))
      expect(Number(match.index) % 3, `${id} tree guides stay in guide columns`).toBe(2)
  }

  const rootChipLead = (await pane.find({ key: 'timeline-chip-lead-root' }))?.text ?? ''
  const completedParentLead = (await pane.find({ key: 'timeline-chip-lead-done-parent' }))?.text ?? ''
  const completedChildLead = (await pane.find({ key: 'timeline-chip-lead-done-child-a' }))?.text ?? ''
  const completedChildTitleLead = (await pane.find({ key: 'timeline-title-lead-done-child-a' }))?.text ?? ''
  const stalledChipLead = (await pane.find({ key: 'timeline-chip-lead-stalled-task' }))?.text ?? ''
  const prChipLead = (await pane.find({ key: 'timeline-chip-lead-pr-task' }))?.text ?? ''
  expect(rootChipLead.indexOf('│'), 'normal root chip guide column').toBe(2)
  expect(completedParentLead.indexOf('│'), 'completed parent child guide is kept').toBe(2)
  expect(completedParentLead.slice(3), 'the child guide has a space before the chip').toMatch(/^ +$/)
  expect(completedParentLead.indexOf('│'), 'parent guide aligns with child connector').toBe(
    completedChildTitleLead.indexOf('├'),
  )
  expect(completedChildLead.indexOf('│'), "earlier child chip keeps its parent's guide").toBe(2)
  expect(completedChildLead.at(-1), 'a guide never touches the chip').toBe(' ')
  const completedChildLeads = await Promise.all(
    ['done-child-a', 'done-child-b', 'done-child-c'].map(
      async id => (await pane.find({ key: `timeline-chip-lead-${id}` }))?.text ?? '',
    ),
  )
  expect(
    [completedParentLead, ...completedChildLeads].map(line => line[2]),
    'the parent and earlier children keep one continuous guide column',
  ).toEqual(['│', '│', '│', '│'])
  const finalChildLead = (await pane.find({ key: 'timeline-chip-lead-done-child-d' }))?.text ?? ''
  const finalChildTitleLead = (await pane.find({ key: 'timeline-title-lead-done-child-d' }))?.text ?? ''
  expect(finalChildTitleLead[2], 'the final child closes the guide with its elbow').toBe('└')
  expect(finalChildLead[2], 'the guide stops after the final child connector').toBe(' ')
  expect(stalledChipLead.indexOf('│'), 'stalled chip uses the normal guide column').toBe(rootChipLead.indexOf('│'))
  expect(prChipLead.indexOf('│'), 'merged-PR chip uses the normal guide column').toBe(rootChipLead.indexOf('│'))
  expect((await pane.find({ key: 'timeline-title-stalled-sibling' }))?.text.endsWith('…')).toBe(true)
  expect((await pane.find({ key: 'timeline-title-pr-sibling' }))?.text).toBe('折り返しを含む日本語タスク')
  const continuationIndex = rows.indexOf('二行目も確認する')
  expect(continuationIndex).toBeGreaterThan(0)
  expect(rows[continuationIndex - 1]?.[2], 'wrapped title keeps its parent guide').toBe('│')
  expect((await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text.startsWith('> ')).toBe(true)
  await pane.press({ key: 'timeline-title-stalled-task' })
  await clock.settle()
  const detail = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(detail).toContain('Detail')
  expect(detail).toContain('DONE worker-1: task completed · now')
  expect(rows.some(line => line.includes('PR state unavailable · CI unavailable'))).toBe(true)
  await pane.press({ key: 'timeline-back' })
  await clock.settle()
  expect((await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text.startsWith('  ')).toBe(true)
  expect((await pane.find({ key: 'timeline-chip-lead-done-parent' }))?.props.width).toBe(
    (await pane.find({ key: 'timeline-title-lead-done-parent' }))?.props.width,
  )
})

for (const bodyColumns of [48, 49] as const) {
  test(`terminal Timeline leaves two cells after a truncated CJK title at ${bodyColumns} columns`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    world($, on, [])
    w.files = ['/.next-build']
    const longTitle = '境界確認用の長い日本語タイトル'.repeat(6)

    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
    await $.tool.call({
      tool: 'mcp__inbox__tasks',
      operation: 'add',
      task_id: 'cjk-boundary',
      title: longTitle,
      status: 'working',
    })
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns } })
    await pane.press({ key: 'tab-key-timeline' })
    await clock.settle()

    const title = (await pane.findAll({ type: 'Text' })).find(line => line.text.startsWith('境界'))
    const titleArea = await pane.find({ key: 'timeline-title-area-cjk-boundary' })
    const titleLead = await pane.find({ key: 'timeline-title-lead-cjk-boundary' })
    const chipLead = await pane.find({ key: 'timeline-chip-lead-cjk-boundary' })
    const gap = await pane.find({ key: 'timeline-row-bar-gap-cjk-boundary' })
    const bar = await pane.find({ key: 'timeline-row-bar-cjk-boundary' })
    expect(title?.text.endsWith('…'), 'the CJK title is truncated at the cell budget').toBe(true)
    expect(titleArea?.props.width).toBe(bodyColumns === 48 ? 20 : 21)
    expect((titleArea?.props.width as number) % 2).toBe(bodyColumns === 48 ? 0 : 1)
    expect(gap?.props.width).toBe(2)
    expect(bar).toBeTruthy()
    expect(chipLead?.props.width).toBe(titleLead?.props.width)
    expect(
      (titleArea?.props.width as number) - cellWidth(title?.text ?? '') + (gap?.props.width as number),
      'the rendered ellipsis and fixed gap leave at least two cells before the bar',
    ).toBeGreaterThanOrEqual(2)
  })
}
