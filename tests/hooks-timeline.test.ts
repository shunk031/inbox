import { expect, mock, test } from 'claude-code/testing'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('the Timeline selection and folds upgrade to defaults in an older save', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let selection: unknown
  let folded: unknown
  on('state.set', { plugin: 'inbox', key: 'timelineSelection' } as const, (_$, event, next) => {
    selection = event.value
    return next(event)
  })
  on('state.set', { plugin: 'inbox', key: 'timelineFolded' } as const, (_$, event, next) => {
    folded = event.value
    return next(event)
  })

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

  expect(selection).toBe(null)
  expect(folded).toEqual([])
})

test('the next-build pane draws Timeline with its saved selection and folded branch', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  on('state.get', { plugin: 'inbox', key: 'timelineSelection' } as const, () => ({ value: 'other' as never }))
  on('state.get', { plugin: 'inbox', key: 'timelineFolded' } as const, () => ({ value: ['plan'] as never }))

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

  expect(await pane.find({ key: 'tab-timeline' })).toBeDefined()
  expect((await pane.find({ key: 'timeline-other' }))?.text).toContain('>')
  expect(await pane.find({ key: 'timeline-child' })).toBeUndefined()
})
