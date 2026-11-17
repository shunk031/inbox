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
      title: task_id,
      status,
    })
  }

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()

  const rows = (await pane.findAll({ type: 'Text' })).map(line => line.text)
  expect(rows).toContain('Stalled')
  expect(
    rows.some(line => line.includes('✕')),
    'the stalled mark stays on the title line',
  ).toBe(true)
  const taskIds = [
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
    expect(
      (chipLead?.props.width as number) + (statusChip?.props.paddingX as number),
      `${id} chip label starts at the title's first column`,
    ).toBe(titleLead?.props.width)
    expect(
      cellWidth(chipLead?.text ?? '') + (statusChip?.props.paddingX as number),
      `${id} guide and chip padding fill the measured title lead`,
    ).toBe(titleLead?.props.width)
    expect(statusLine?.props.gap, `${id} chip follows the title-column lead without a gap`).toBeUndefined()
    expect(statusChip?.props.paddingX, `${id} chip padding is included in alignment`).toBe(1)
    expect(statusChip, `${id} chip is rendered`).toBeTruthy()
  }

  const rootChipLead = (await pane.find({ key: 'timeline-chip-lead-root' }))?.text ?? ''
  const stalledChipLead = (await pane.find({ key: 'timeline-chip-lead-stalled-task' }))?.text ?? ''
  const prChipLead = (await pane.find({ key: 'timeline-chip-lead-pr-task' }))?.text ?? ''
  expect(rootChipLead.indexOf('│'), 'normal root chip guide column').toBe(2)
  expect(stalledChipLead.indexOf('│'), 'stalled chip uses the normal guide column').toBe(rootChipLead.indexOf('│'))
  expect(prChipLead.indexOf('│'), 'merged-PR chip uses the normal guide column').toBe(rootChipLead.indexOf('│'))
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
    expect([...warning.matchAll(/│/g)], 'warning keeps only its ancestor guide').toHaveLength(1)
  }
})
