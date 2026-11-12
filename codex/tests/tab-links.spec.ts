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
