import { expect, mock, test } from 'claude-code/testing'

import { w, world } from './hooks-world'
import { PANE, SAVED_SESSION } from './hooks-helpers'

for (const look of ['terminal', 'desktop'] as const)
  test(`the ${look} look retains feed Progress outside Asks while preserving its untracked-work banner`, async ($, on) => {
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
          untrackedWork: [
            {
              key: 'herdr/local/meta-worker/untracked-work',
              title: 'meta-worker',
              detail: 'working agent has no open item',
              at: 1_000_000,
              feedSource: '/tmp/feed/herdr-local.json',
            },
          ],
          nextId: 3,
        },
      }),
    )
    await $.session.start({ cwd: '/tmp/project', surface: look, isInteractive: true })
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE, surface: look, props: { ...PANE.props, bodyColumns: 120 } })
    await clock.settle()
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    expect(text).not.toContain('Progress')
    expect(text).not.toContain('Implement the progress feed')
    expect(text).toContain('Untracked work')
    expect(JSON.parse(w.stored.get('s:session-1') ?? '{}').ledger.findings).toMatchObject([
      { id: 'f2', kind: 'progress', title: 'Implement the progress feed', feedKey: 'machine/worker' },
    ])
  })

for (const look of ['terminal', 'desktop'] as const)
  test(`the ${look} look draws an untracked-work warning by itself`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    world($, on, [])
    w.stored.set(
      's:session-1',
      JSON.stringify({
        ...SAVED_SESSION,
        ledger: {
          ...SAVED_SESSION.ledger,
          untrackedWork: [
            {
              key: 'herdr/local/meta-worker/untracked-work',
              title: 'meta-worker',
              detail: 'working agent has no open item',
              at: 1_000_000,
              feedSource: '/tmp/feed/herdr-local.json',
            },
          ],
        },
      }),
    )
    await $.session.start({ cwd: '/tmp/project', surface: look, isInteractive: true })
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE, surface: look, props: { ...PANE.props, bodyColumns: 120 } })
    await clock.settle()
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    expect(text).toContain('Untracked work')
    expect(text).toContain('meta-worker')
  })

for (const look of ['terminal', 'desktop'] as const)
  test(`the ${look} look draws a source-managed task without local actions`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    world($, on, [])
    w.stored.set(
      's:session-1',
      JSON.stringify({
        ...SAVED_SESSION,
        ledger: {
          ...SAVED_SESSION.ledger,
          items: [
            {
              id: 'i9',
              kind: 'task',
              label: null,
              ask: 'Check the milestone',
              detail: 'Verify the exit criteria',
              options: [],
              rec: null,
              helps: [],
              turn: 0,
              at: 1_000_000,
              from: 'record',
              sourceManaged: true,
              feedKey: 'task/milestone',
              feedSource: '/tmp/feed/meta-open-items.json',
            },
          ],
          nextId: 10,
        },
      }),
    )
    await $.session.start({ cwd: '/tmp/project', surface: look, isInteractive: true })
    await clock.settle()
    const pane = await $.ui.mount({ ...PANE, surface: look, props: { ...PANE.props, bodyColumns: 120 } })
    await clock.settle()
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    expect(text).toContain('Check the milestone')
    expect(text).not.toContain('Done')
  })
