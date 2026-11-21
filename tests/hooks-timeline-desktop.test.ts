import { expect, mock, test } from 'claude-code/testing'
import type { TabsProps } from '../hooks/tabs-client'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('the desktop Timeline cuts a long owner to one ellipsized metadata line', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.files = ['/.next-build']
  w.surfaces = ['desktop']

  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'long-owner',
    title: 'Task with a long owner',
    owner_machine: 'm'.repeat(100),
    owner_agent: 'a'.repeat(32),
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30 } })
  const { tabs, gap } = (await pane.find({ key: 'tabs' }))?.props.props as TabsProps
  const timelineAt = tabs
    .slice(
      0,
      tabs.findIndex(tab => tab.id === 'timeline'),
    )
    .reduce((x, tab) => x + tab.width + gap, 0)
  await pane.pointer({ type: 'down', x: timelineAt, y: 1, button: 'left', in: 'tabs' })
  await clock.settle()

  const metadata = await pane.find({ key: 'timeline-metadata-long-owner' })
  expect(metadata?.text.split('\n')).toHaveLength(1)
  expect(metadata?.text.endsWith('…')).toBe(true)
})
