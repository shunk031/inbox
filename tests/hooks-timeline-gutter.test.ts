import { expect, mock, test } from 'claude-code/testing'
import type { Session } from '../types'
import { taskOwnerKey } from '../hooks/task-facts'
import { cellWidth } from '../hooks/text'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('terminal Timeline puts fixed status chips before titles and keeps tree and warning guides', async ($, on) => {
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
  expect(
    rows.some(line => line.trimEnd() === 'Stalled'),
    'the stalled chip label stays readable',
  ).toBe(true)
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
  const labels: Record<string, string> = {
    'done-parent': 'Completed',
    'done-child-a': 'Completed',
    'done-child-b': 'Completed',
    'done-child-c': 'Completed',
    'done-child-d': 'Completed',
    root: 'In progress',
    'stalled-task': 'Stalled',
    'stalled-child': 'Not started',
    'stalled-sibling': 'Not started',
    'pr-task': 'In progress',
    'pr-child': 'Not started',
    'pr-sibling': 'Not started',
    'normal-sibling': 'Not started',
  }
  const titleColumns = new Map<string, number>()
  for (const id of taskIds) {
    const titleLead = await pane.find({ key: `timeline-title-lead-${id}` })
    const chipGap = await pane.find({ key: `timeline-chip-title-gap-${id}` })
    const statusChip = await pane.find({ key: `timeline-chip-${id}` })
    expect(cellWidth(titleLead?.text ?? ''), `${id} title begins after its measured lead`).toBe(titleLead?.props.width)
    expect(statusChip?.props.paddingX, `${id} chip padding is included in alignment`).toBe(1)
    expect(cellWidth(statusChip?.text ?? '') + 2, `${id} chip has the fixed width of the longest label`).toBe(13)
    expect(statusChip?.text?.trimEnd(), `${id} chip keeps its full label`).toBe(labels[id])
    expect(chipGap?.props.width, `${id} chip has one cell before the title`).toBe(1)
    titleColumns.set(id, Number(titleLead?.props.width) + 13 + Number(chipGap?.props.width))
    expect(statusChip, `${id} chip is rendered`).toBeTruthy()
    expect(await pane.find({ key: `timeline-status-line-${id}` }), `${id} has no separate chip row`).toBeFalsy()
    expect(await pane.find({ key: `timeline-chip-lead-${id}` }), `${id} has no chip guide row`).toBeFalsy()
    const rowText = (await pane.find({ key: `timeline-${id}` }))?.text ?? ''
    expect(rowText.indexOf(labels[id]!), `${id} chip is before its title`).toBeLessThan(
      rowText.indexOf((await pane.find({ key: `timeline-title-${id}` }))?.text ?? ''),
    )
    expect(titleLead?.text).not.toContain('|')
    for (const match of (titleLead?.text ?? '').matchAll(/│/g))
      expect(Number(match.index) % 3, `${id} tree guides stay in guide columns`).toBe(2)
  }
  expect(titleColumns.get('done-parent'), 'all root titles start in one column').toBe(titleColumns.get('root'))
  for (const id of ['done-child-a', 'done-child-b', 'stalled-task', 'pr-task'])
    expect(titleColumns.get(id), `${id} starts in the shared depth-one title column`).toBe(
      titleColumns.get('done-child-a'),
    )
  for (const id of ['stalled-child', 'stalled-sibling', 'pr-child', 'pr-sibling'])
    expect(titleColumns.get(id), `${id} starts in the shared depth-two title column`).toBe(
      titleColumns.get('stalled-child'),
    )

  const completedParentLead = (await pane.find({ key: 'timeline-title-lead-done-parent' }))?.text ?? ''
  const completedChildTitleLead = (await pane.find({ key: 'timeline-title-lead-done-child-a' }))?.text ?? ''
  const finalChildTitleLead = (await pane.find({ key: 'timeline-title-lead-done-child-d' }))?.text ?? ''
  expect(completedParentLead).not.toContain('│')
  expect(completedChildTitleLead.slice(2, 5), 'the first child draws its parent connector').toBe('├─ ')
  expect(finalChildTitleLead.slice(2, 5), 'the last child closes its parent connector').toBe('└─ ')
  const stalledTaskLead = (await pane.find({ key: 'timeline-title-lead-stalled-task' }))?.text ?? ''
  const stalledChildLead = (await pane.find({ key: 'timeline-title-lead-stalled-child' }))?.text ?? ''
  const stalledFinalChildLead = (await pane.find({ key: 'timeline-title-lead-stalled-sibling' }))?.text ?? ''
  expect(stalledTaskLead[2], 'the ancestor guide reaches its parent row').toBe('├')
  expect(stalledChildLead[2], 'the ancestor guide continues through the first child').toBe('│')
  expect(stalledFinalChildLead.slice(2, 7), 'the ancestor guide reaches the final child elbow').toBe('│  └─')
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
  expect((await pane.find({ key: 'timeline-chip-done-parent' }))?.text?.trimEnd()).toBe('Completed')
})

for (const bodyColumns of [48, 49] as const) {
  test(`terminal Timeline keeps the fixed chip and full percent after a truncated CJK title at ${bodyColumns} columns`, async ($, on) => {
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
    const chip = await pane.find({ key: 'timeline-chip-cjk-boundary' })
    const chipGap = await pane.find({ key: 'timeline-chip-title-gap-cjk-boundary' })
    const bar = await pane.find({ key: 'timeline-row-bar-cjk-boundary' })
    const rowText = (await pane.find({ key: 'timeline-cjk-boundary' }))?.text ?? ''
    const percentLabel = rowText.match(/\d+\.\d{2}%/u)?.[0]
    expect(title?.text.endsWith('…'), 'the CJK title is truncated at the cell budget').toBe(true)
    expect(titleArea?.props.width).toBe(bodyColumns === 48 ? 18 : 19)
    expect((titleArea?.props.width as number) % 2).toBe(bodyColumns === 48 ? 0 : 1)
    expect(bar, 'the per-row bar is omitted at this narrow width').toBeFalsy()
    expect(percentLabel, 'the full percent remains visible').toBeTruthy()
    expect(cellWidth(chip?.text ?? '') + 2).toBe(13)
    expect(chipGap?.props.width).toBe(1)
    expect(cellWidth(title?.text ?? '')).toBeLessThanOrEqual(titleArea?.props.width as number)
  })
}
