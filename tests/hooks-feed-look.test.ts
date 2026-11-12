import { expect, mock, test } from 'claude-code/testing'

import type { TabsProps } from '../hooks/tabs-client'
import { w, world } from './hooks-world'
import { PANE, SAVED_SESSION } from './hooks-helpers'

for (const look of ['terminal', 'desktop'] as const)
  test(`the ${look} look draws a feed finding in the Progress group`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    world($, on, [])
    w.stored.set(
      's:session-1',
      JSON.stringify({
        ...SAVED_SESSION,
        ledger: {
          ...SAVED_SESSION.ledger,
          findings: [
            {
              id: 'f2',
              kind: 'progress',
              title: 'Implement the progress feed',
              detail: 'Wire the shared ledger.',
              path: null,
              at: 1_000_000,
              feedKey: 'machine/worker',
            },
          ],
          nextId: 3,
        },
      }),
    )
    await $.session.start({ cwd: '/tmp/project', surface: look, isInteractive: true })
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE, surface: look, props: { ...PANE.props, bodyColumns: 120 } })
    if (look === 'terminal') await pane.press({ key: 'tab-findings' })
    else {
      const { tabs, gap } = (await pane.find({ key: 'tabs' }))?.props.props as TabsProps
      const x = tabs
        .slice(
          0,
          tabs.findIndex(t => t.id === 'findings'),
        )
        .reduce((sum, t) => sum + t.width + gap, 0)
      await pane.pointer({ type: 'down', x, y: 1, button: 'left', in: 'tabs' })
    }
    await clock.settle()
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    expect(text).toContain('Progress')
    expect(text).toContain('Implement the progress feed')
  })
