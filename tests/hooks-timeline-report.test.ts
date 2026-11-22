import { expect, mock, test } from 'claude-code/testing'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

test('Timeline rows show an owner report and its time in terminal and desktop', async ($, on) => {
  const home = '/tmp/inbox-report-fixture',
    line = 'STATUS waiting for review'
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [], { HOME: home })
  w.files = ['/.next-build']
  w.written[`${home}/.local/state/herdr-meta-patrol/queue.jsonl`] =
    '{"seq":1,"t":1000,"from":"worker","machine":"local","text":"STATUS waiting for review"}'

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 'reported',
    title: 'Reported task',
    status: 'working',
    owner_agent: 'worker',
    owner_machine: 'local',
  })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-timeline' })
  await clock.settle()
  expect((await pane.findAll({ type: 'Text' })).some(text => text.text.includes(`${line} · now`))).toBe(true)

  w.surfaces = ['desktop']
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.settle()
  expect((await desktop.findAll({ type: 'Text' })).some(text => text.text.includes(`${line} · now`))).toBe(true)
})
