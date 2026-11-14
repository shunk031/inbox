import { describe, expect, test } from 'claude-code/testing'

import { applyFeed, applyFeedFiles, FEED_TTL_MS, parseFeed } from '../hooks/feed'
import type { Feed, FeedEntry } from '../hooks/feed'
import { inboxText, carryText } from '../hooks/inbox-text'
import { EMPTY } from '../hooks/ledger'
import { closeFinding } from '../hooks/ledger-close'
import { addFinding, applyUpdate } from '../hooks/ledger-update'
import { buildPrompt } from '../hooks/ledger-prompt'
import { CLAUDE_CODE } from '../hooks/model-text'
import { parseReply } from '../hooks/reply-parse'
import type { Finding } from '../types'

const entry = (change: Partial<FeedEntry> = {}): FeedEntry => ({
  key: 'machine/worker',
  state: 'working',
  title: 'Add progress feed',
  detail: 'Update the shared ledger.',
  at: 100,
  ...change,
})
const feed = (...entries: FeedEntry[]): Feed => ({ version: 1, source: 'herdr-meta-patrol', writtenAt: 100, entries })
const finding = (change: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  kind: 'issue' as const,
  title: 'Add progress feed',
  detail: 'Manual note.',
  path: null,
  at: 10,
  ...change,
})

describe('progress feed', () => {
  test('parses writer snapshots and truncates overlong text at UTF-16 limits', () => {
    const valid = { version: 1, source: 'herdr-meta-patrol', writtenAt: 1, entries: [entry()] }
    expect(parseFeed(JSON.stringify(valid))?.entries).toEqual(valid.entries)
    const subagent = parseFeed(
      JSON.stringify({ ...valid, source: 'claude-subagent-hook', entries: [entry({ key: 'subagent/s1/a1' })] }),
    )
    expect(subagent?.source).toBe('claude-subagent-hook')
    expect(
      applyFeedFiles(EMPTY, '/feed', [{ path: '/feed/subagent-s1-a1.json', feed: subagent }], 2).findings,
    ).toMatchObject([{ feedKey: 'subagent/s1/a1' }])
    const long = parseFeed(
      JSON.stringify({
        ...valid,
        entries: [entry({ title: '😀'.repeat(130), detail: 'd'.repeat(601) })],
      }),
    )?.entries[0]
    expect(long?.title).toBe('😀'.repeat(60))
    expect(long?.title.length).toBe(120)
    expect(long?.detail).toBe('d'.repeat(600))
    expect(parseFeed(JSON.stringify({ ...valid, source: '' }))).toBeNull()
    expect(parseFeed('{')).toBeNull()
    expect(parseFeed(JSON.stringify({ ...valid, version: 2 }))).toBeNull()
    expect(
      parseFeed(JSON.stringify({ ...valid, entries: [entry(), entry({ key: 'machine/other' }), entry()] })),
    ).toBeNull()
    expect(
      parseFeed(JSON.stringify({ ...valid, entries: Array.from({ length: 41 }, (_, i) => entry({ key: `m/${i}` })) })),
    ).toBeNull()
  })

  test('adds and updates feed-owned findings without adopting hand findings', () => {
    const first = applyFeed(EMPTY, feed(entry({ state: 'blocked' })), 110)
    expect(first.findings).toMatchObject([
      { id: 'f1', kind: 'progress', detail: 'Blocked: Update the shared ledger.', feedKey: 'machine/worker' },
    ])
    const changed = applyFeed(first, feed(entry({ title: 'Feed work', detail: 'Update the tab.', at: 120 })), 130)
    expect(changed.findings).toMatchObject([{ id: 'f1', title: 'Feed work', detail: 'Update the tab.', at: 120 }])
    expect(applyFeed(changed, feed(entry({ title: 'Feed work', detail: 'Update the tab.', at: 120 })), 140)).toBe(
      changed,
    )

    const manual = { ...EMPTY, findings: [finding()], nextId: 2 }
    const independent = applyFeed(manual, feed(entry()), 110, '/feed/herdr-meta-patrol.json')
    expect(independent.findings).toMatchObject([
      { id: 'f1', kind: 'issue', detail: 'Manual note.' },
      { id: 'f2', kind: 'progress', feedKey: 'machine/worker', feedSource: '/feed/herdr-meta-patrol.json' },
    ])
    expect(independent.nextId).toBe(3)

    const completed = applyFeed(independent, feed(entry({ state: 'done' })), 120, '/feed/herdr-meta-patrol.json')
    expect(completed.findings.map(f => f.id)).toEqual(['f1'])
    expect(completed.closedFindings.map(f => f.id)).toEqual(['f2'])

    const missing = applyFeedFiles(independent, '/feed', [{ path: '/feed/herdr-meta-patrol.json', feed: feed() }], 130)
    expect(missing.findings.map(f => f.id)).toEqual(['f1'])
    expect(missing.closedFindings.map(f => f.id)).toEqual(['f2'])
  })

  test('preserves legacy unmarked findings that were previously adopted by title', () => {
    const legacy = {
      ...EMPTY,
      findings: [
        finding({
          kind: 'progress',
          detail: 'Update the shared ledger.',
          feedKey: 'machine/worker',
          feedSource: '/feed/herdr-meta-patrol.json',
        }),
      ],
      nextId: 2,
    }
    const active = applyFeed(legacy, feed(entry()), 120, '/feed/herdr-meta-patrol.json')
    expect(active.findings.map(f => f.id)).toEqual(['f1', 'f2'])
    expect(active.findings[0]).toMatchObject({ id: 'f1', feedKey: 'machine/worker' })
    expect(active.findings[0]).not.toHaveProperty('feedOwned')
    const completed = applyFeed(active, feed(entry({ state: 'done' })), 130, '/feed/herdr-meta-patrol.json')
    expect(completed.findings.map(f => f.id)).toEqual(['f1'])
    expect(completed.closedFindings).toMatchObject([
      { id: 'f2', feedOwned: true, outcome: 'done: Update the shared ledger.' },
    ])

    const expired = applyFeedFiles(
      active,
      '/feed',
      [{ path: '/feed/herdr-meta-patrol.json', feed: feed(entry()) }],
      100 + FEED_TTL_MS,
    )
    expect(expired.findings.map(f => f.id)).toEqual(['f1'])
    expect(expired.closedFindings).toMatchObject([{ id: 'f2', feedOwned: true, outcome: 'done: feed entry expired' }])
  })

  test('closes completed and missing entries, preserves dismissed keys, and ignores untracked completion', () => {
    const path = '/feed/patrol.json'
    const open = applyFeedFiles(EMPTY, '/feed', [{ path, feed: feed(entry()) }], 110)
    const done = applyFeedFiles(
      open,
      '/feed',
      [{ path, feed: feed(entry({ state: 'done', detail: 'Merged the change.' })) }],
      120,
    )
    expect(done.findings).toEqual([])
    expect(done.closedFindings).toMatchObject([{ id: 'f1', how: 'update', outcome: 'done: Merged the change.' }])
    expect(done.closedFindings.map(f => f.id)).toContain('f1')
    const retainedHistory = applyFeedFiles(done, '/feed', [{ path, feed: feed() }], 130)
    expect(retainedHistory.closedFindings).toHaveLength(1)
    expect(retainedHistory.closedFindings[0]).toMatchObject({ id: 'f1', feedKey: undefined, feedSource: undefined })
    expect(applyFeed(EMPTY, feed(entry({ state: 'done' })), 120)).toBe(EMPTY)

    const missing = applyFeedFiles(open, '/feed', [{ path, feed: feed() }], 130)
    expect(missing.findings).toEqual([])
    expect(missing.closedFindings).toMatchObject([{ id: 'f1', outcome: 'done: no longer reported' }])
    const dismissed = closeFinding(open, 'f1', { how: 'dismissed', outcome: 'dismissed' }, 120)
    const stillDismissed = applyFeedFiles(
      dismissed,
      '/feed',
      [{ path, feed: feed(entry({ detail: 'Still running.' })) }],
      130,
    )
    expect(stillDismissed.findings).toEqual([])
    expect(stillDismissed.closedFindings).toMatchObject([{ how: 'dismissed', feedKey: 'machine/worker' }])
    expect(applyFeed(EMPTY, feed(entry({ state: 'done' })), 120)).toBe(EMPTY)
  })

  test('reconciles each snapshot separately and expires old entries', () => {
    const a = { path: '/feed/patrol.json', feed: feed(entry({ key: 'herdr/a' })) }
    const b = { path: '/feed/subagents-s1.json', feed: feed(entry({ key: 'subagent/s1/1', title: 'Subagent work' })) }
    const both = applyFeedFiles(EMPTY, '/feed', [a, b], 110)
    const onlyB = applyFeedFiles(both, '/feed', [b], 120)
    expect(onlyB.findings.map(f => f.feedKey)).toEqual(['subagent/s1/1'])
    expect(onlyB.closedFindings).toMatchObject([{ feedKey: 'herdr/a', outcome: 'done: no longer reported' }])

    const active = applyFeedFiles(EMPTY, '/feed', [{ ...a, feed: feed(entry({ at: 100 })) }], 110)
    const stale = applyFeedFiles(active, '/feed', [{ ...a, feed: feed(entry({ at: 100 })) }], 100 + FEED_TTL_MS)
    expect(stale.findings).toEqual([])
    expect(stale.closedFindings).toMatchObject([{ feedKey: 'machine/worker', outcome: 'done: feed entry expired' }])
    expect(applyFeedFiles(EMPTY, '/feed', [{ ...a, feed: feed(entry({ at: 100 })) }], 100 + FEED_TTL_MS)).toBe(EMPTY)
  })

  test('hides feed findings from model text and ignores model closes for their ids', () => {
    const ordinary = { ...EMPTY, findings: [finding()] }
    const withFeed = {
      ...ordinary,
      findings: [
        ...ordinary.findings,
        { ...finding(), id: 'f2', kind: 'progress' as const, feedKey: 'machine/worker' },
      ],
    }
    const exchange = { person: '', trigger: null, activity: [], reply: '', turn: 0, press: null, screen: '', tasks: [] }
    expect(inboxText(CLAUDE_CODE, withFeed, false)).toBe(inboxText(CLAUDE_CODE, ordinary, false))
    expect(carryText(withFeed, 'carry')).toBe(carryText(ordinary, 'carry'))
    expect(buildPrompt(withFeed, exchange)).toBe(buildPrompt(ordinary, exchange))
    expect(applyUpdate(withFeed, parseReply('CLOSED: f2 | done: shipped')!, 200, 1).findings.map(f => f.id)).toContain(
      'f2',
    )
  })

  test('does not count feed findings against the regular finding cap', () => {
    const ledger = {
      ...EMPTY,
      findings: [
        ...Array.from({ length: 30 }, (_, i) => ({ ...finding(), id: `f${i + 1}`, feedKey: `m/${i}` })),
        ...Array.from({ length: 29 }, (_, i) => ({ ...finding(), id: `f${i + 31}`, title: `Manual ${i}` })),
      ],
      nextId: 60,
    }
    const added = addFinding(ledger, {
      kind: 'issue',
      title: 'Another manual finding',
      detail: 'A regular finding.',
      path: null,
      at: 100,
    })
    expect(added.expired?.feedKey).toBeUndefined()
    expect(added.ledger.findings.filter(f => f.feedKey).length).toBe(30)
  })
})
