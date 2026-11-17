import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('the Codex Timeline guide stays on its connector stem column', () => {
  const css = readFileSync(new URL('../src/tab-css/status-page.css', import.meta.url), 'utf8')
  assert.match(css, /--timeline-guide-stem-offset:\s*0\.59em;/)
  assert.match(
    css,
    /left:\s*calc\(var\(--tree-x\)\s*\+\s*var\(--timeline-guide-stem-offset\)\s*\+\s*var\(--timeline-guide-depth,\s*0\)\s*\*\s*var\(--step\)\);/,
  )
})
