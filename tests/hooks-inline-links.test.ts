import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { w, world } from './hooks-world'
import { PANE, selectRow } from './hooks-helpers'

async function showsQuestionLink($: Engine, on: On, surface: 'terminal' | 'desktop') {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: true }
  await $.session.start({ cwd: '/tmp/project', surface, isInteractive: true })
  await $.command.run({ command: 'inbox', args: '' } as never)
  const pane = await $.ui.mount({ ...PANE, surface })
  await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'question',
    ask: 'Should I merge [PR 7171](https://github.com/anthropics/claude-code/pull/7171)?',
    options: ['Yes', 'No'],
    detail: 'This blocks the release.\nRead [release notes](https://example.com/release).',
  } as never)
  await clock.settle()
  await selectRow(pane, 'i1')
  const links = await pane.findAll({ type: 'Link' })
  expect(links.map(link => link.props)).toContainEqual(
    expect.objectContaining({
      href: 'https://github.com/anthropics/claude-code/pull/7171',
      label: 'PR 7171',
    }),
  )
  expect(links.map(link => link.props)).toContainEqual(
    expect.objectContaining({
      href: 'https://example.com/release',
      label: 'release notes',
    }),
  )
}

test('the terminal pane draws a Markdown ask destination as a Link', async ($, on) => {
  await showsQuestionLink($, on, 'terminal')
})

test('the desktop pane draws a Markdown ask destination as a Link', async ($, on) => {
  await showsQuestionLink($, on, 'desktop')
})
