import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTreeText } from './check-tree.mjs'
import { checkChipBoxes, checkFrame, checkLeftEdges, stripChipRightPadding } from './render-snapshots-checks.mjs'
import {
  cropInboxPane,
  isolate,
  ready,
  saveRawTimeoutFrame,
  storeKeys,
  stripAnsi,
  wait,
} from './render-snapshots-live.mjs'
import { fixtureState, PLUGIN_STORE, registry } from './render-snapshots-fixtures.mjs'

const paneOnly = (text, options = {}) => checkTreeText(text, { ...options, inputMode: 'pane-only' })

test('isolation accepts a missing real config path and still refuses unsafe paths', t => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'render-snapshot-isolation-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const root = path.join(scratch, 'runner-temp')
  const home = path.join(root, 'home')
  const config = path.join(root, 'config')
  const realHome = path.join(scratch, 'real-home')
  mkdirSync(home, { recursive: true })
  mkdirSync(config, { recursive: true })
  mkdirSync(realHome)

  assert.equal(existsSync(path.join(realHome, '.claude')), false)
  assert.doesNotThrow(() => isolate(root, home, config, { HOME: realHome }))
  assert.throws(() => isolate(root, home, config, { HOME: home }), /refusing to run/u)
  assert.throws(() => isolate(root, home, config, { HOME: realHome, CLAUDE_CONFIG_DIR: config }), /refusing to run/u)

  const outside = path.join(scratch, 'outside')
  mkdirSync(outside)
  assert.throws(() => isolate(root, outside, config, { HOME: realHome }), /outside the runner temp/u)
})

test('store key inventory follows CLAUDE_CONFIG_DIR and treats missing store as empty', t => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'render-snapshot-store-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const home = path.join(scratch, 'home')
  const config = path.join(scratch, 'config')
  const defaultStore = path.join(home, '.claude', 'plugins', 'store')
  const configuredStore = path.join(config, 'plugins', 'store')
  mkdirSync(defaultStore, { recursive: true })
  mkdirSync(configuredStore, { recursive: true })
  writeFileSync(path.join(defaultStore, PLUGIN_STORE), JSON.stringify({ fallback: {} }))
  writeFileSync(path.join(configuredStore, PLUGIN_STORE), JSON.stringify({ configured: {} }))

  assert.deepEqual(storeKeys({ HOME: home, CLAUDE_CONFIG_DIR: config }), new Set(['configured']))
  assert.deepEqual(storeKeys({ HOME: home }), new Set(['fallback']))
  assert.deepEqual(storeKeys({ HOME: home, CLAUDE_CONFIG_DIR: path.join(scratch, 'missing') }), new Set())
})

test('registry covers every terminal view, scenario, and width once', () => {
  assert.equal(registry.length, 36)
  assert.equal(new Set(registry.map(entry => entry.file)).size, registry.length)
  assert.deepEqual(new Set(registry.map(entry => entry.width)), new Set([87, 110, 200]))
  assert.deepEqual(
    registry.filter(entry => entry.fixture === 'agents-tree').map(entry => entry.width),
    [87, 110, 200],
  )
  assert.deepEqual(
    registry.filter(entry => entry.fixture === 'fold-done').map(entry => entry.width),
    [200, 110],
  )
})

test('tree reconstruction enforces continuity, parent columns and recognized headings', () => {
  const frame = 'Local agents\n   │\n   ├─ A\n   │  ├─ C1\n   │  │  wrap\n   │  └─ C2\n   │\n   └─ B'
  const check = text => paneOnly(text, { view: 'agents' })
  assert.deepEqual(check(frame), [])
  for (const [from, to] of [
    ['   │  ├─ C1', '      ├─ C1'],
    ['   │  │  wrap', '      │  wrap'],
    ['   │\n   └─ B', '   \n   └─ B'],
  ])
    assert.ok(check(frame.replace(from, to)).some(error => error.includes('missing-continuity-column=3')))
  assert.ok(check('Local agents\n   │\n   └─ A\n      │').some(error => error.includes('orphan-trunk-column=6')))
  const rejects = (text, detail, view = 'agents') =>
    assert.ok(paneOnly(text, { view }).some(error => error.includes(detail)))
  const oneChild = 'Local agents\n   │\n   └─ A'
  const empty = oneChild.replace('\n   └─ A', '')
  const siblings = 'Local agents\n   │\n   ├─ A\n   │\n   └─ B'
  for (const [text, detail, view] of [
    ['   ├─ stray\nLocal agents\n   │\n   └─ A', 'connector-without-recognized-heading'],
    [empty, 'orphan-trunk-column=3'],
    [oneChild.replace('   └─ A', '   └─ A\n   │'), 'orphan-trunk-column=3'],
    [oneChild.replace('   └─ A', '   └─ A\n      │'), 'orphan-trunk-column=6'],
    [siblings.replace('   │\n   └─ B', '    │\n   └─ B'), 'orphan-trunk-column=4'],
    ['Local agents\n   │\n   └─ A\n         └─ shifted child', 'connector-parent-column=6 actual=9'],
    ['Summary\n   └─ orphan\nQuestions\n   │\n   └─ valid', 'line=2 connector-without-recognized-heading', 'asks'],
  ])
    rejects(text, detail, view || 'agents')
})

test('raw terminal checks reject missing divider rows without a row-count threshold', () => {
  const check = (frame, dividerColumn, paneWidth) =>
    checkTreeText(frame, { view: 'agents', inputMode: 'pane-in-terminal', dividerColumn, paneWidth })
  const rows = Array.from({ length: 30 }, (_, index) =>
    `${' '.repeat(40)}│${['Local agents', '   │', '   ├─ A', '   │', '   └─ B'][index] ?? ''}`.padEnd(92),
  )
  assert.deepEqual(check(rows.join('\n'), 40, 51), [])
  assert.ok(check(`broken row\n${rows.join('\n')}`, 40, 51).some(error => error.includes('line=1 unclassified line')))
  rows[2] = `${rows[2].slice(0, 40)} ${rows[2].slice(41)}`
  assert.ok(check(rows.join('\n'), 40, 51).some(error => error.includes('line=3 unclassified line')))
  rows[29] = `${rows[4].slice(0, 40)} ${rows[4].slice(41)}`
  assert.ok(check(rows.join('\n'), 40, 51).some(error => error.includes('line=30 unclassified line')))
})

test('Timeline root and paired square or rounded box borders are explicit', () => {
  const frame = 'Progress\n ┌──┐\n │  │\n └──┘\n    ◐ root\n    │  In progress\n    └─ child'
  const rejects = (text, view, expected) => assert.ok(paneOnly(text, { view }).some(error => error.includes(expected)))
  assert.deepEqual(paneOnly(frame, { view: 'timeline' }), [])
  const outsideBorder = frame.replace('    │  In progress', '   │  In progress')
  rejects(outsideBorder, 'timeline', 'orphan-trunk-column=3')
  rejects(frame.replace(' └──┘', ' └─┘'), 'timeline', 'orphan-trunk')
  rejects(frame.replace('    ◐ root\n', ''), 'timeline', 'connector-without-timeline-root')
})

test('list gutters allow deeper guides only for Agents', () => {
  const asks = registry.find(entry => entry.file === 'asks-empty-110.txt')
  const agents = registry.find(entry => entry.file === 'agents-empty-110.txt')
  assert.ok(!checkFrame(asks, 'Nothing needed\n   │ item', 110).some(error => error.includes('stray │')))
  assert.ok(checkFrame(asks, 'Nothing needed\n      │ item', 110).some(error => error.includes('stray │')))
  assert.ok(!checkFrame(agents, 'Orchestrators\n      │ item', 110).some(error => error.includes('stray │')))
})

test('capture and readiness timeouts save their last raw frame', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'render-snapshot-timeout-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const mode of ['raw', 'pane']) {
    let saved
    await assert.rejects(
      wait('socket', 'session', 87, () => false, 'readiness', mode, 1, {
        captureFrame: () => 'raw terminal frame',
        onTimeout: (frame, label) => {
          saved = saveRawTimeoutFrame(directory, `${label}.txt`, frame)
        },
      }),
      /timed out waiting for readiness/u,
    )
    assert.equal(readFileSync(saved, 'utf8'), 'raw terminal frame')
  }
})

test('left-edge check catches an indented Detail heading and its text', () => {
  const entry = registry.find(candidate => candidate.file === 'timeline-detail-layout-87.txt')
  const frame = `    Asks        b: ‹ Back Snapshot In progress\n${' '.repeat(16)}┌─────────────┐\n${' '.repeat(16)}│ Progress    │\n${' '.repeat(23)}Detail\n${' '.repeat(23)}Newest text`
  assert.match(checkLeftEdges(entry, frame).join('\n'), /left edge mismatch[\s\S]*left edge mismatch/)
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
  const agentsBusy = registry.find(candidate => candidate.fixture === 'agents-busy')
  assert.equal(ready(agentsBusy, 'Meta tasks\nStale\nIn progress\nWaiting\nsnapshot-local…'), true)
  const tree = registry.find(candidate => candidate.fixture === 'agents-tree' && candidate.width === 87)
  const treeFrame = `Orchestrators\nMeta tasks\nLocal agents\nsnapshot-local-worker\nIn\nprogress\n${'├─\n'.repeat(11)}`
  assert.equal(ready(tree, treeFrame.replace('snapshot-local-worker', '')), false)
  assert.equal(ready(tree, treeFrame), true)
  const tree110 = registry.find(candidate => candidate.fixture === 'agents-tree' && candidate.width === 110)
  const connectors = '├─\n'.repeat(11)
  assert.equal(ready(tree110, `Orchestrators\nMeta tasks\nLocal agents\nsnapshot-local…\n${connectors}`), false)
  assert.equal(
    ready(tree110, `Orchestrators\nMeta tasks\nLocal agents\nsnapshot-local…\nIn progress\n${connectors}`),
    true,
  )
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

test('chip box checks require one padded cell on each side and space before the pane edge', () => {
  const entry = { view: 'agents', scenario: 'busy', width: 20 }
  const frame = `${'\x1b[48;5;153m '}\x1b[38;5;16mStale\x1b[39m \x1b[49m `
  assert.deepEqual(checkChipBoxes(entry, frame, 20), [])
  const missingRight = stripChipRightPadding(frame, entry, 20, 'Stale')
  assert.ok(checkChipBoxes(entry, missingRight, 20).some(line => line.includes('chip box padding')))
  assert.ok(checkChipBoxes(entry, frame.trimEnd(), 20).some(line => line.includes('chip box right margin')))
})
