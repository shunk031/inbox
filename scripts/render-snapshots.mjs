import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registry, SCENARIOS, VIEWS } from './render-snapshots-fixtures.mjs'
import { capture, removeTemporaryTree, tmux } from './render-snapshots-live.mjs'
import { checkTreeText } from './check-tree.mjs'
import {
  checkFrame,
  checkChipBoxes,
  checkTimelineFocus,
  failure,
  inventoryErrors,
  runMutationProofs,
} from './render-snapshots-checks.mjs'

async function main() {
  const plugin = realpathSync(process.env.INBOX_SNAPSHOT_PLUGIN_DIR || process.cwd())
  const baseline = path.join(process.cwd(), 'tests/render-snapshots/snapshots')
  const root = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'inbox-render-snapshots-'))
  const socket = `inbox-render-${process.pid}`
  const frames = new Map()
  const claude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
  const pin = readFileSync('.github/workflows/plugin-tests.yml', 'utf8').match(/claude-code@([\d.]+)/u)?.[1]
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' })
    .trim()
    .match(/^[\d.]+/u)?.[0]
  assert.ok(pin, 'Claude Code version pin not found in Plugin tests workflow')
  assert.equal(version, pin, `Claude Code is ${version ?? 'unknown'}; workflow pins ${pin}`)
  try {
    tmux(socket, 'start-server')
    for (const entry of registry) frames.set(entry.file, await capture(entry, plugin, root, socket, claude))
  } finally {
    try {
      tmux(socket, 'kill-server')
    } catch {}
    removeTemporaryTree(root)
  }
  assert.equal(
    frames.size,
    registry.length,
    `registry entries captured exactly once (${frames.size}/${registry.length})`,
  )
  mkdirSync(baseline, { recursive: true })
  const errors = []
  const oldAgents = path.join(baseline, 'agents-busy-110.txt')
  if (checkTreeText(readFileSync(oldAgents, 'utf8'), { view: 'agents' }).length === 0)
    errors.push(`FAIL ${oldAgents} legacy negative fixture unexpectedly passes`)
  for (const [name, item] of frames) {
    const file = path.join(baseline, name)
    const rendered = `${item.frame}\n`
    // Keep the old Agents frames as negative geometry fixtures while checking the new live drawing below.
    if (!['agents-busy', 'agents-tree'].includes(item.entry.fixture)) {
      if (process.env.UPDATE_SNAPSHOTS === '1') writeFileSync(file, rendered)
      else if (!existsSync(file))
        errors.push(failure(item.entry, 'snapshot inventory', name, 'missing', 'baseline missing'))
      else {
        const expected = readFileSync(file, 'utf8').replace(/\n$/u, '')
        if (expected !== item.frame)
          errors.push(failure(item.entry, 'baseline', 'same pane frame', 'different', 'frame differs'))
      }
    }
    errors.push(...checkFrame(item.entry, item.frame, item.paneWidth))
    errors.push(...checkChipBoxes(item.entry, item.ansiFrame, item.paneWidth))
    errors.push(...checkTimelineFocus(item.entry, item.frame, item.ansiFrame))
    if (['asks', 'timeline', 'agents'].includes(item.entry.view))
      errors.push(...checkTreeText(item.frame, { view: item.entry.view, source: name }))
  }
  errors.push(
    ...inventoryErrors(
      new Set(registry.filter(entry => entry.fixture !== 'agents-tree').map(entry => entry.file)),
      new Set(readdirSync(baseline).filter(name => name.endsWith('.txt'))),
    ),
  )
  if (errors.length) {
    const rawFrames = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'inbox-render-failures-'))
    for (const [name, item] of frames)
      writeFileSync(path.join(rawFrames, name.replace(/\.txt$/u, '.ansi')), item.ansiFrame)
    process.stderr.write(`Raw frames saved: ${rawFrames}\n`)
    errors.forEach(line => process.stderr.write(`${line}\n`))
    throw Error(`${errors.length} render snapshot failure(s)`)
  }
  runMutationProofs(frames)
  const summary = `PASS ${registry.length} live pane snapshots`
  const coverage = `${VIEWS.length} views × ${SCENARIOS.length} scenarios × 2 widths + 3 Agents tree widths + 1 Timeline case × 2 widths`
  process.stdout.write(`${summary} (${coverage})\n`)
}
main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
