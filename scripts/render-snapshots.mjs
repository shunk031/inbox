import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registry, SCENARIOS, VIEWS } from './render-snapshots-fixtures.mjs'
import { capture, removeTemporaryTree, tmux } from './render-snapshots-live.mjs'
import { checkFrame, failure, inventoryErrors, lineDiff, runMutationProofs } from './render-snapshots-checks.mjs'

// prettier-ignore
async function main() {
  const plugin = real(process.env.INBOX_SNAPSHOT_PLUGIN_DIR || process.cwd()), baseline = path.join(process.cwd(), 'tests/render-snapshots/snapshots')
  const root = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'inbox-render-snapshots-')), socket = `inbox-render-${process.pid}`, frames = new Map()
  const claude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim(), pin = readFileSync('.github/workflows/plugin-tests.yml', 'utf8').match(/claude-code@([\d.]+)/u)?.[1]
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim().match(/^[\d.]+/u)?.[0]
  assert.ok(pin, 'Claude Code version pin not found in Plugin tests workflow'); assert.equal(version, pin, `Claude Code is ${version ?? 'unknown'}; workflow pins ${pin}`)
  try { tmux(socket, 'start-server'); for (const entry of registry) frames.set(entry.file, await capture(entry, plugin, root, socket, claude)) }
  finally { try { tmux(socket, 'kill-server') } catch {}; removeTemporaryTree(root) }
  assert.equal(frames.size, registry.length, `registry entries captured exactly once (${frames.size}/${registry.length})`)
  mkdirSync(baseline, { recursive: true }); const errors = []
  for (const [name, item] of frames) {
    const file = path.join(baseline, name), rendered = `${item.frame}\n`
    if (process.env.UPDATE_SNAPSHOTS === '1') writeFileSync(file, rendered)
    else if (!existsSync(file)) errors.push(failure(item.entry, 'snapshot inventory', name, 'missing', 'baseline missing'))
    else { const expected = readFileSync(file, 'utf8').replace(/\n$/u, ''); if (expected !== item.frame) errors.push(failure(item.entry, 'baseline', 'same pane frame', 'different', lineDiff(expected, item.frame))) }
    errors.push(...checkFrame(item.entry, item.frame, item.paneWidth))
  }
  errors.push(...inventoryErrors(new Set(registry.map(entry => entry.file)), new Set(readdirSync(baseline).filter(name => name.endsWith('.txt')))))
  if (errors.length) { errors.forEach(line => process.stderr.write(`${line}\n`)); throw Error(`${errors.length} render snapshot failure(s)`) }
  runMutationProofs(frames); process.stdout.write(`PASS ${registry.length} live pane snapshots (${VIEWS.length} views × ${SCENARIOS.length} scenarios × 2 widths)\n`)
}
function real(value) {
  return execFileSync('realpath', [value], { encoding: 'utf8' }).trim()
}
// prettier-ignore
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 })
