import { expect, mock, test } from 'claude-code/testing'
import type { Session } from '../types'
import { taskOwnerKey } from '../hooks/task-facts'
import { cellWidth } from '../hooks/text'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('terminal Timeline aligns every status chip with its title and keeps warning guides', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  const owner = { machine: 'local', agent: 'worker-1' }
  const ownerKey = taskOwnerKey(owner)
  const mergedPr = 'https://github.com/example/project/pull/13'
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    const session = event.value as Session & { revision: number }
    const taskTree = session.taskTree.map(task =>
      task.id === 'stalled-task' ? { ...task, links: { ...task.links, owner } } : task,
    )
    return next({
      ...event,
      value: {
        ...session,
        taskTree,
        taskOwnerFacts: { ...session.taskOwnerFacts, [ownerKey]: { state: 'idle', since: 0 } },
        taskFactWarnings: [
          ...session.taskFactWarnings.filter(warning => warning.taskId !== 'pr-task'),
          { taskId: 'pr-task', pr: mergedPr, message: 'PR merged, task still open' as const },
        ],
      },
    })
  })

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
      status: 'done',
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
    })
  }

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 200 } })
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const rows = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(rows).toContain('Stalled')
  expect(
    rows.some(line => line.includes('✕')),
    'the stalled mark stays on the title line',
  ).toBe(true)
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
    const titleArea = await pane.find({ key: `timeline-title-area-${id}` })
    const titleText = await pane.find({ key: `timeline-title-${id}` })
    const titleTextArea = await pane.find({ key: `timeline-title-text-${id}` })
    const chipGap = await pane.find({ key: `timeline-chip-gap-${id}` })
    const statusChip = await pane.find({ key: `timeline-chip-${id}` })
    expect(cellWidth(titleLead?.text ?? ''), `${id} title begins after its measured lead`).toBe(titleLead?.props.width)
    expect(titleArea?.props.flexDirection, `${id} title and chip share a line`).toBe('row')
    expect(chipGap?.props.width, `${id} leaves one cell between title and chip`).toBe(1)
    expect(Number(titleTextArea?.props.width), `${id} title box ends at the displayed title`).toBe(
      cellWidth(titleText?.text ?? ''),
    )
    const chipWidth = cellWidth(statusChip?.text ?? '') + 2 * Number(statusChip?.props.paddingX)
    expect(Number(titleTextArea?.props.width) + Number(chipGap?.props.width) + chipWidth).toBeLessThanOrEqual(
      Number(titleArea?.props.width),
    )
    expect(
      cellWidth(titleText?.text ?? '') + Number(chipGap?.props.width) + chipWidth,
      `${id} title, gap and full chip fit before the row's bar and percent`,
    ).toBeLessThanOrEqual(Number(titleArea?.props.width))
    const titleAreaChildren = (titleArea?.children ?? []).filter(
      (child): child is { props?: Record<string, unknown> } => typeof child === 'object' && child !== null,
    )
    expect(titleAreaChildren).toHaveLength(3)
    expect(titleAreaChildren[0]?.props?.width).toBe(titleTextArea?.props.width)
    expect(titleAreaChildren[1]?.props?.width).toBe(1)
    expect(titleAreaChildren[2]?.props?.paddingX).toBe(1)
    expect(await pane.find({ key: `timeline-status-line-${id}` }), `${id} has no chip row`).toBeFalsy()
    expect(statusChip, `${id} chip is rendered`).toBeTruthy()
    expect(titleLead?.text).not.toContain('|')
    for (const match of (titleLead?.text ?? '').matchAll(/│/g))
      expect(Number(match.index) % 3, `${id} tree guides stay in guide columns`).toBe(2)
  }

  const completedParentTitleLead = (await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text ?? ''
  expect(completedParentTitleLead.startsWith('> '), 'selection stays before the parent title').toBe(true)
  const completedChildTitleLeads = await Promise.all(
    ['done-child-a', 'done-child-b', 'done-child-c', 'done-child-d'].map(
      async id => (await pane.find({ key: `timeline-title-lead-${id}` }))?.text ?? '',
    ),
  )
  expect(
    completedChildTitleLeads.map(line => (line.includes('├─') ? '├─' : line.includes('└─') ? '└─' : '')),
    'every child title line keeps its tree connector through the final child',
  ).toEqual(['├─', '├─', '├─', '└─'])
  const finalChildTitleLead = completedChildTitleLeads.at(-1) ?? ''
  expect(finalChildTitleLead).toContain('└─')
  expect(
    finalChildTitleLead.slice(finalChildTitleLead.indexOf('└─') + 2),
    'no vertical guide follows the last child connector',
  ).not.toContain('│')
  expect((await pane.find({ key: 'timeline-title-stalled-sibling' }))?.text.endsWith('…')).toBe(true)
  expect((await pane.find({ key: 'timeline-title-pr-sibling' }))?.text).toBe('折り返しを含む日本語タスク')
  const continuationIndex = rows.indexOf('二行目も確認する')
  expect(continuationIndex).toBeGreaterThan(0)
  expect(rows[continuationIndex - 1]?.[2], 'wrapped title keeps its parent guide').toBe('│')
  const warnings = rows.filter(line => line.includes('⚠'))
  expect(warnings.some(line => line.includes('Owner idle 15m+'))).toBe(true)
  expect(warnings.some(line => line.includes('Owner finished, task open'))).toBe(true)
  expect(warnings.filter(line => line.includes('PR merged, task still open'))).toHaveLength(1)
  const stalledTitleLead = await pane.find({ key: 'timeline-title-lead-stalled-task' })
  const prTitleLead = await pane.find({ key: 'timeline-title-lead-pr-task' })
  for (const warning of warnings) {
    const warningColumn = cellWidth(warning.slice(0, warning.indexOf('⚠')))
    const titleLead = warning.includes('PR merged') ? prTitleLead : stalledTitleLead
    expect(warningColumn, 'warning text starts in its title column').toBe(titleLead?.props.width)
    expect(
      [...warning.matchAll(/│/g)].map(match => Number(match.index)),
      'warning keeps the ancestor and child guides in their separate columns',
    ).toEqual([2, 5])
    expect(warning[2], 'the warning keeps the guide in its tree column').toBe('│')
  }

  expect((await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text.startsWith('> ')).toBe(true)
  await pane.press({ key: 'timeline-title-root' })
  await clock.settle()
  await pane.press({ key: 'timeline-back' })
  await clock.settle()
  expect((await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text.startsWith('  ')).toBe(true)
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
    const titleTextArea = await pane.find({ key: 'timeline-title-text-cjk-boundary' })
    const chipGap = await pane.find({ key: 'timeline-chip-gap-cjk-boundary' })
    const statusChip = await pane.find({ key: 'timeline-chip-cjk-boundary' })
    const gap = await pane.find({ key: 'timeline-row-bar-gap-cjk-boundary' })
    const bar = await pane.find({ key: 'timeline-row-bar-cjk-boundary' })
    expect(title?.text.endsWith('…'), 'the CJK title is truncated at the cell budget').toBe(true)
    expect(titleArea?.props.width).toBe(bodyColumns === 48 ? 20 : 21)
    expect((titleArea?.props.width as number) % 2).toBe(bodyColumns === 48 ? 0 : 1)
    expect(gap?.props.width).toBe(2)
    expect(bar).toBeTruthy()
    expect(chipGap?.props.width).toBe(1)
    expect(
      Number(titleTextArea?.props.width) + Number(chipGap?.props.width) + cellWidth(statusChip?.text ?? '') + 2,
    ).toBeLessThanOrEqual(titleArea?.props.width as number)
    expect(
      cellWidth(title?.text ?? '') + Number(chipGap?.props.width) + cellWidth(statusChip?.text ?? '') + 2,
      'the truncated CJK title and full chip stay inside the title column',
    ).toBeLessThanOrEqual(titleArea?.props.width as number)
    expect(gap?.props.width, 'the full chip leaves two cells before the bar').toBe(2)
  })
}
