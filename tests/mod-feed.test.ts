import { describe, expect, test } from 'claude-code/testing'

import { modFeedPoller } from '../hooks/mod-feed'
import { EMPTY } from '../hooks/ledger'

describe('the mod feed poller', () => {
  test('reads a single file only when changed and closes its findings when it disappears', async () => {
    let mtime = 1
    let text = '{'
    let reads = 0
    let present = true
    let ledger = EMPTY
    const fs = {
      stat: async (path: string) => {
        if (!present) throw new Error(`missing ${path}`)
        return { kind: 'file', mtimeMs: mtime }
      },
      list: async () => [],
      exists: async () => present,
      read: async () => {
        reads++
        return text
      },
    }
    const poll = modFeedPoller(
      '/feed.json',
      fs.stat,
      fs.list,
      fs.exists,
      fs.read,
      async () => 100,
      async change => void (ledger = change(ledger)),
    )
    await poll()
    await poll()
    expect([reads, ledger.findings]).toEqual([1, []])
    mtime++
    text = JSON.stringify({
      version: 1,
      source: 'herdr-meta-patrol',
      writtenAt: 2,
      entries: [{ key: 'm/a', state: 'working', title: 'Ship feed', detail: 'Update state.', at: 2 }],
    })
    await poll()
    expect([reads, ledger.findings.map(f => f.feedKey)]).toEqual([2, ['m/a']])
    present = false
    await poll()
    expect(ledger.closedFindings).toMatchObject([{ feedKey: 'm/a', outcome: 'done: no longer reported' }])
  })

  test('merges directory writers and keeps unchanged snapshots available for reconciliation', async () => {
    const root = '/feeds'
    const text = (key: string, title: string) =>
      JSON.stringify({
        version: 1,
        source: 'herdr-meta-patrol',
        writtenAt: 2,
        entries: [{ key, state: 'working', title, detail: 'Update state.', at: 2 }],
      })
    const contents = new Map([
      [`${root}/patrol.json`, text('herdr/local/worker', 'Patrol work')],
      [`${root}/subagent-s1-a1.json`, text('subagent/s1/a1', 'Subagent work')],
    ])
    let ledger = EMPTY
    const fs = {
      stat: async (path: string) => ({ kind: path === root ? 'directory' : 'file', mtimeMs: 2 }),
      list: async () => [...contents.keys()].map(name => ({ name: name.slice(root.length + 1) })),
      exists: async () => true,
      read: async (path: string) => contents.get(path)!,
    }
    const poll = modFeedPoller(
      root,
      fs.stat,
      fs.list,
      fs.exists,
      fs.read,
      async () => 100,
      async change => void (ledger = change(ledger)),
    )
    await poll()
    expect(ledger.findings.map(f => f.feedKey).sort()).toEqual(['herdr/local/worker', 'subagent/s1/a1'])
    contents.delete(`${root}/patrol.json`)
    await poll()
    expect(ledger.findings.map(f => f.feedKey)).toEqual(['subagent/s1/a1'])
    expect(ledger.closedFindings.map(f => f.feedKey)).toEqual(['herdr/local/worker'])
  })
})
