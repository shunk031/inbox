import assert from 'node:assert/strict'
import { test } from 'node:test'
import { h, render } from 'preact'
import { Window } from 'happy-dom'

test('Codex Markdown links render as anchors with labels, open through the host, and fall back to the URL on denial', async () => {
  const browser = new Window()
  Object.assign(globalThis, { window: browser, document: browser.document, parent: browser.parent })
  const messages: { id: number; method: string; params: unknown }[] = []
  let isDenied = false
  browser.parent.postMessage = message => {
    const sent = message as (typeof messages)[number]
    messages.push(sent)
    browser.dispatchEvent(
      new browser.MessageEvent('message', {
        data: isDenied
          ? { jsonrpc: '2.0', id: sent.id, error: { code: -1, message: 'Blocked' } }
          : { jsonrpc: '2.0', id: sent.id, result: {} },
      }),
    )
  }
  const { inlineHtml } = await import('../src/tab-parts')
  const root = document.createElement('div')
  render(h('p', null, inlineHtml('See [PR 7171](https://github.com/example/repo/pull/7171).')), root)
  const link = root.querySelector<HTMLAnchorElement>('a')
  assert.equal(link?.textContent, 'PR 7171')
  assert.equal(link?.getAttribute('href'), 'https://github.com/example/repo/pull/7171')
  assert.equal(root.textContent, 'See PR 7171.')
  link?.click()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(messages[0]?.method, 'ui/open-link')
  assert.deepEqual(messages[0]?.params, { url: 'https://github.com/example/repo/pull/7171' })
  isDenied = true
  root.querySelector<HTMLAnchorElement>('a')?.click()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(root.textContent, 'See PR 7171 (https://github.com/example/repo/pull/7171).')
  assert.equal(root.querySelector('a'), null)
})

test('a Codex linked title stays outside the row selector and its accessible label omits the URL', async () => {
  const browser = new Window()
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    parent: browser.parent,
    matchMedia: () => ({ matches: false }),
  })
  browser.parent.postMessage = message => {
    const sent = message as { id: number }
    browser.dispatchEvent(new browser.MessageEvent('message', { data: { jsonrpc: '2.0', id: sent.id, result: {} } }))
  }
  const { ListRow } = await import('../src/tab-list')
  const { inlineHtml } = await import('../src/tab-parts')
  const root = document.createElement('div')
  let selected = 0
  const title = '[PR 7171](https://github.com/example/repo/pull/7171)'
  render(
    h(ListRow, {
      row: {
        id: 'i1',
        handle: '',
        title: inlineHtml(title),
        titleLabel: 'PR 7171',
        keys: [],
        more: [],
        feedback: null,
      } as never,
      track: { state: 'closed', since: 0, hasPanel: false },
      onSelect: () => selected++,
      now: 0,
    }),
    root,
  )
  const link = root.querySelector<HTMLAnchorElement>('.line a')
  assert.equal(link?.textContent, 'PR 7171')
  assert.equal(root.querySelector('.line')?.getAttribute('role'), 'group')
  assert.equal(root.querySelector('.line')?.getAttribute('aria-label'), 'Show details for PR 7171')
  link?.click()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(selected, 0)
})

test('Codex shows a question explanation with paragraph breaks and linked labels', async () => {
  const browser = new Window()
  Object.assign(globalThis, { window: browser, document: browser.document, parent: browser.parent })
  const { demoState } = await import('../src/demo')
  const { viewOf } = await import('../src/core')
  const { listsOf } = await import('../src/tab-rows')
  const state = demoState(1000)
  const item = state.ledger.items[0]!
  const detail = 'This choice blocks the release.\n\nRead [release notes](https://example.com/release).'
  state.ledger.items = state.ledger.items.map(row => (row.id === item.id ? { ...row, detail } : row))
  const view = { ...viewOf(state, 1000), thread: 'test', devPage: '', isFetchingPrs: false, isGhMissing: false }
  const row = listsOf(view, new Set()).byTab.needsYou.find(candidate => candidate.id === item.id)!
  const root = document.createElement('div')
  render(h('div', null, row.body), root)

  assert.equal(root.querySelector('p')?.style.whiteSpace, 'pre-line')
  assert.equal(root.querySelector('p')?.textContent, 'This choice blocks the release.\n\nRead release notes.')
  assert.equal(root.querySelector('a')?.getAttribute('href'), 'https://example.com/release')
})

test('Codex renders finding titles and details as links', async () => {
  const browser = new Window()
  Object.assign(globalThis, { window: browser, document: browser.document, parent: browser.parent })
  const { demoState } = await import('../src/demo')
  const { viewOf } = await import('../src/core')
  const { listsOf } = await import('../src/tab-rows')
  const state = demoState(1000)
  const finding = state.ledger.findings[0]!
  state.ledger.findings = state.ledger.findings.map(row =>
    row.id === finding.id
      ? {
          ...row,
          title: 'Read [PR 7171](https://github.com/anthropics/claude-code/pull/7171)',
          detail: 'See [release notes](https://example.com/release).',
        }
      : row,
  )
  const view = { ...viewOf(state, 1000), thread: 'test', devPage: '', isFetchingPrs: false, isGhMissing: false }
  const row = listsOf(view, new Set()).byTab.findings.find(candidate => candidate.id === finding.id)!
  const root = document.createElement('div')
  render(h('div', null, row.title, row.body), root)

  assert.deepEqual(
    Array.from(root.querySelectorAll('a')).map(anchor => anchor.getAttribute('href')),
    ['https://github.com/anthropics/claude-code/pull/7171', 'https://example.com/release'],
  )
})

test('Codex shows option feedback with a label and links its settled outcome', async () => {
  const browser = new Window()
  Object.assign(globalThis, { window: browser, document: browser.document, parent: browser.parent })
  const { ListRow } = await import('../src/tab-list')
  const { NeedsYou } = await import('../src/tab-groups')
  const { demoState } = await import('../src/demo')
  const { viewOf } = await import('../src/core')
  const { sending, unfolded } = await import('../src/tab-state')
  const { closeItem } = await import('../../hooks/ledger-close')
  const option = '[PR 7171](https://github.com/anthropics/claude-code/pull/7171)'
  const root = document.createElement('div')
  sending.delete('i1')
  const row = {
    id: 'i1',
    handle: '',
    title: 'Merge this PR?',
    keys: [],
    more: [],
    feedback: { is: 'queued', label: `✓ ${option}`, at: 1000 },
  }
  render(
    h(ListRow, {
      row: row as never,
      track: { state: 'open', since: 0, hasPanel: false },
      onSelect: () => {},
      now: 1000,
    }),
    root,
  )
  assert.match(root.querySelector('.line')?.textContent ?? '', /PR 7171/)
  assert.doesNotMatch(root.querySelector('.line')?.textContent ?? '', /\[PR 7171\]/)
  assert.equal(root.querySelector('.line a'), null)
  render(null, root)
  render(
    h(ListRow, {
      row: row as never,
      track: { state: 'open', since: 0, hasPanel: true },
      onSelect: () => {},
      now: 1000,
    }),
    root,
  )
  assert.equal(root.querySelector('.panel .muted a')?.textContent, 'PR 7171')
  assert.equal(root.querySelector('.panel .muted a')?.getAttribute('href'), 'https://github.com/anthropics/claude-code/pull/7171')

  const state = demoState(1000)
  const item = state.ledger.items[0]!
  state.ledger = closeItem(state.ledger, item.id, { how: 'answered', outcome: option }, 2000)
  const view = {
    ...viewOf(state, 2000),
    thread: 'test',
    devPage: '',
    isFetchingPrs: false,
    isGhMissing: false,
  }
  unfolded.clear()
  unfolded.add('question')
  render(null, root)
  render(
    h(
      NeedsYou,
      {
        v: view,
        lists: { questions: [], tasks: [], findings: [], findingGroups: [], byTab: { needsYou: [], findings: [] } } as never,
        now: 2000,
      },
      null,
    ),
    root,
  )
  assert.equal(root.querySelector('.closed-list .outcome a')?.textContent, 'PR 7171')
  assert.equal(
    root.querySelector('.closed-list .outcome a')?.getAttribute('href'),
    'https://github.com/anthropics/claude-code/pull/7171',
  )
  assert.doesNotMatch(root.querySelector('.closed-list .outcome')?.textContent ?? '', /\[PR 7171\]/)
})
