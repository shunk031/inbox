import { expect, test } from 'bun:test'
import { hyperlinkTools, panelLink } from '../src/host'
import { cutTitle, fit, linkedText, spread, visibleLength } from '../src/panel-text'

test('fits real omp OSC 8 links at narrow and wide panel widths', async () => {
  const { applyHyperlinkSetting, urlHyperlink } = await hyperlinkTools()
  applyHyperlinkSetting('always')
  const url = 'https://github.com/anthropics/claude-code/pull/7171'
  const link = linkedText('Read [PR 7171](' + url + ')', urlHyperlink)
  expect(link).toContain('\x1b]8;id=')
  expect(visibleLength(link)).toBe('Read PR 7171'.length)

  const narrow = cutTitle(linkedText('[Very long PR 7171](' + url + ')', urlHyperlink), 12)
  expect(visibleLength(narrow)).toBeLessThanOrEqual(12)
  expect(narrow).toMatch(/\x1b\]8;;\x1b\\…$/)
  const fitted = fit(link, 8)
  expect(visibleLength(fitted)).toBeLessThanOrEqual(8)
  expect(fitted).toContain('\x1b]8;;\x1b\\')
  expect(visibleLength(spread(link, '12m ago ', 80))).toBe(80)
  applyHyperlinkSetting('auto')
})

test('opening the panel survives an omp build without the hyperlink subpath', async () => {
  expect(await panelLink(async () => Promise.reject(new Error('missing render subpath')))).toBeUndefined()
})
