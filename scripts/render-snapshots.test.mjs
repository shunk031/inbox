import assert from 'node:assert/strict'
import test from 'node:test'
import { checkFrame } from './render-snapshots-checks.mjs'
import { cropInboxPane, ready, stripAnsi } from './render-snapshots-live.mjs'
import { fixtureState, registry } from './render-snapshots-fixtures.mjs'

test('registry covers every terminal view, scenario, and width once', () => {
  assert.equal(registry.length, 28)
  assert.equal(new Set(registry.map(entry => entry.file)).size, registry.length)
  assert.deepEqual(new Set(registry.map(entry => entry.width)), new Set([110, 200]))
})

test('Help snapshots open through the existing footer control', () => {
  for (const scenario of ['empty', 'busy']) {
    const entry = registry.find(candidate => candidate.view === 'help' && candidate.scenario === scenario)
    assert.equal(entry.fixture, `help-${scenario}`)
    assert.equal(fixtureState(entry.fixture).isHelpShown, false)
  }
})

test('Help readiness waits for the fixed running-mark frame', () => {
  const entry = registry.find(candidate => candidate.view === 'help')
  assert.equal(ready(entry, 'Keys\nTabs\n◉  Working.'), false)
  assert.equal(ready(entry, 'Keys\nTabs\n●  Working.'), true)
})

test('PR readiness waits until remote refresh status settles', () => {
  const entry = registry.find(candidate => candidate.view === 'prs' && candidate.scenario === 'busy')
  assert.equal(ready(entry, 'Snapshot pull request\nRefreshing PRs…'), false)
  assert.equal(ready(entry, 'Snapshot pull request\nPR status unavailable'), true)
})

test('Agents and report readiness wait for settled fixture content', () => {
  const agents = registry.find(candidate => candidate.view === 'agents' && candidate.scenario === 'empty')
  assert.equal(ready(agents, 'Orchestrators'), false)
  assert.equal(ready(agents, 'Orchestrators\nHerdr agent list unavailable; local agent status is not current.'), true)
  const report = registry.find(candidate => candidate.view === 'asks-detail' && candidate.scenario === 'busy')
  assert.equal(ready(report, 'Snapshot report\nBack to inbox\nOpening report…'), false)
  assert.equal(
    ready(report, 'Snapshot report\nBack to inbox\nThis invented report checks that a paragraph wraps.'),
    true,
  )
})

test('pane crop preserves leading and interior spaces while removing the dock divider', () => {
  const capture = Array.from(
    { length: 30 },
    (_, index) => `${' '.repeat(40)}│${index === 12 ? '  x  y' : index === 29 ? '' : `row-${index}`}`,
  ).join('\n')
  const cropped = cropInboxPane(capture, 80)
  assert.equal(cropped.dividerColumn, 40)
  assert.equal(cropped.paneWidth, 39)
  assert.equal(cropped.text.split('\n')[12], '  x  y')
  assert.equal(cropped.text.endsWith('\n'), false)
})

test('ANSI stripping removes CSI and OSC control sequences', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m\x1b]8;;https://example.invalid\x07link\x1b]8;;\x07'), 'redlink')
})

test('cell checks report a shifted Timeline chip with its fixture column', () => {
  const entry = registry.find(candidate => candidate.file === 'timeline-busy-200.txt')
  const lines = Array.from({ length: 30 }, () => '')
  lines[0] = 'Progress'
  lines[1] = '      Snapshot root invented title'
  lines[2] = '    │   In progress'
  lines[3] = 'Snapshot long invented title…  ──────────'
  const frame = lines.join('\n')
  const failures = checkFrame(entry, frame, 70)
  assert.ok(failures.some(line => line.includes('chip does not start on its title column')))
  assert.ok(failures.some(line => line.includes('bar and percentage must share the title line')))
})
