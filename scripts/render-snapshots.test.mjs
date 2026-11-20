import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTreeText } from './check-tree.mjs'
import { checkChipBoxes, checkFrame, stripChipRightPadding } from './render-snapshots-checks.mjs'
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
  assert.equal(registry.length, 33)
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

test('tree trunks stay continuous through descendant and wrapped rows', () => {
  const frame = 'Local agents\n   │\n   ├─ A\n   │  ├─ C1\n   │  │  wrap\n   │  └─ C2\n   │\n   └─ B'
  const check = text => checkTreeText(text, { view: 'agents' })
  const broken = (from, to, expected = 'missing-continuity-column=3') =>
    assert.ok(check(frame.replace(from, to)).some(error => error.includes(expected)))
  assert.deepEqual(check(frame), [])
  broken('   │  ├─ C1', '      ├─ C1')
  broken('   │  │  wrap', '      │  wrap')
  broken('   │\n   └─ B', '   \n   └─ B')
  broken('Local agents\n   │', 'Local agents\n   │\n   │', 'duplicate-heading-trunk-column=3')
  assert.ok(check('Local agents\n   │\n   └─ A\n      │').some(error => error.includes('orphan-trunk-column=6')))
})

test('tree checks reject heading trunks without children, connectors without headings, and off-column trunks', () => {
  const check = text => checkTreeText(text, { view: 'agents' })
  const rejects = (text, detail) => assert.ok(check(text).some(error => error.includes(detail)))
  const oneChild = 'Local agents\n   │\n   └─ A'
  const empty = oneChild.replace('\n   └─ A', '')
  assert.deepEqual(check(oneChild), [])
  rejects('   ├─ stray\nLocal agents\n   │\n   └─ A', 'missing-heading-trunk-column=3')
  rejects(empty, 'orphan-trunk-column=3')
  assert.ok(checkTreeText(empty, { view: 'agents', requireTree: true }).some(error => error.includes('no-tree-found')))
  rejects(oneChild.replace('Local agents\n   │\n', ''), 'missing-heading-trunk-column=3')
  rejects(oneChild.replace('   └─ A', '   └─ A\n   │'), 'orphan-trunk-column=3')
  rejects(oneChild.replace('   └─ A', '   └─ A\n      │'), 'orphan-trunk-column=6')
  const siblings = 'Local agents\n   │\n   ├─ A\n   │\n   └─ B'
  const offColumn = siblings.replace('   │\n   └─ B', '    │\n   └─ B')
  rejects(offColumn, 'orphan-trunk-column=4')
})

test('pane extraction ignores sidebar rows but checks the pane tree', () => {
  const rows = Array.from({ length: 30 }, (_, index) =>
    `${' '.repeat(40)}│${['Local agents', '   │', '   ├─ A', '   │', '   └─ B'][index] ?? ''}`.padEnd(92),
  )
  const check = () => checkTreeText(['Sidebar\n   │\n   └─ A', ...rows].join('\n'), { view: 'agents' })
  assert.deepEqual(check(), [])
  rows[2] = `${rows[2].slice(0, 40)} ${rows[2].slice(41)}`
  assert.ok(check().some(error => error.includes('line=6 unclassified line')))
  rows[29] = `${rows[4].slice(0, 40)} ${rows[4].slice(41)}`
  assert.ok(check().some(error => error.includes('line=33 unclassified line')))
})

test('Timeline exempts only paired box borders and rejects edges outside them', () => {
  const frame = 'Progress\n ┌──┐\n │  │\n └──┘\n      │\n      └─ child'
  assert.deepEqual(checkTreeText(frame, { view: 'timeline' }), [])
  const broken = frame.replace('      │\n      └─ child', '     │\n      └─ child')
  assert.ok(checkTreeText(broken, { view: 'timeline' }).some(error => error.includes('orphan-trunk-column=5')))
  const outsideBorder = frame.replace('      │\n      └─ child', '    │\n      └─ child')
  assert.ok(checkTreeText(outsideBorder, { view: 'timeline' }).some(error => error.includes('orphan-trunk-column=4')))
  const unpairedBox = frame.replace(' └──┘', ' └─┘')
  assert.ok(checkTreeText(unpairedBox, { view: 'timeline' }).some(error => error.includes('orphan-trunk-column=4')))
})

test('current tree snapshots pass the geometry checker', () => {
  for (const entry of registry.filter(
    candidate => ['asks', 'timeline', 'agents'].includes(candidate.view) && candidate.fixture !== 'agents-busy',
  )) {
    const file = path.join(process.cwd(), 'tests/render-snapshots/snapshots', entry.file)
    assert.deepEqual(checkTreeText(readFileSync(file, 'utf8'), { view: entry.view, source: entry.file }), [])
  }
})

test('list gutters allow deeper guides only for Agents', () => {
  const asks = registry.find(entry => entry.file === 'asks-empty-110.txt')
  const agents = registry.find(entry => entry.file === 'agents-empty-110.txt')
  assert.equal(
    checkFrame(asks, 'Nothing needed\n   │ item', 110).some(error => error.includes('stray │')),
    false,
  )
  assert.ok(checkFrame(asks, 'Nothing needed\n      │ item', 110).some(error => error.includes('stray │')))
  assert.equal(
    checkFrame(agents, 'Orchestrators\n      │ item', 110).some(error => error.includes('stray │')),
    false,
  )
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
  assert.equal(ready(tree110, `Orchestrators\nMeta tasks\nLocal agents\n${connectors}`), false)
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
  assert.equal(cropped.text.endsWith('\n'), false)
})

test('pane crop handles the 87-column single-pane border', () => {
  const capture = Array.from({ length: 14 }, (_, index) => `│${(index === 5 ? 'Asks' : '').padEnd(85)}│`).join('\n')
  const cropped = cropInboxPane(capture, 87)
  assert.equal(cropped.paneWidth, 85)
  assert.equal(cropped.dividerColumn, 0)
  assert.equal(cropped.text.split('\n')[5], 'Asks')
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
