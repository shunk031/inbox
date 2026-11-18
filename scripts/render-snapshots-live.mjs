import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cellWidth, cutToCells } from '../hooks/text.ts'
import { fixtureState, HEIGHT, PLUGIN_STORE } from './render-snapshots-fixtures.mjs'
import { marker, pageMarker } from './render-snapshots-checks.mjs'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g
// prettier-ignore
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`, tmux = (socket, ...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), send = (socket, session, key, literal = false) => tmux(socket, 'send-keys', '-t', `${session}:0.0`, ...(literal ? ['-l'] : []), key), stripAnsi = text => text.replace(ANSI, '').replace(/\r/g, '')
// prettier-ignore
function cropInboxPane(capture, width) {
  const lines = stripAnsi(capture).split('\n'); if (lines.at(-1) === '') lines.pop()
  const counts = new Map()
  for (const line of lines) for (const m of line.matchAll(/│/g)) { const col = cellWidth(line.slice(0, m.index)); if (col >= Math.floor(width / 3)) counts.set(col, (counts.get(col) ?? 0) + 1) }
  const [divider, rows] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? []
  if (!divider || rows < 20) throw Error(`inbox pane divider not found at ${width} terminal columns`)
  const paneWidth = width - divider - 1
  const frame = lines.flatMap(line => { const prefix = cutToCells(line, divider + 1); return cellWidth(prefix) === divider + 1 && prefix.endsWith('│') ? [line.slice(prefix.length).replace(/ +$/u, '')] : [] })
  while (frame.at(-1) === '') frame.pop()
  if (frame.length < 20) throw Error(`inbox pane crop is incomplete at ${width} terminal columns`)
  return { text: frame.join('\n'), paneWidth, dividerColumn: divider }
}
// prettier-ignore
const focusedHelp = frame => {
  const line = frame.split('\n').find(text => text.includes('Help')); if (!line) return false
  let inverse = false
  for (const m of line.matchAll(/\x1b\[([\d;]*)m/gu)) { if (m.index >= line.indexOf('Help')) break; for (const n of m[1].split(';').map(Number)) { if (n === 0 || n === 27) inverse = false; if (n === 7) inverse = true } }
  return inverse
}
// prettier-ignore
async function focusHelp(socket, session) {
  let frame = tmux(socket, 'capture-pane', '-e', '-p', '-t', `${session}:0.0`), end = Date.now() + 20_000
  for (let i = 0; i < 100 && Date.now() < end; i++) { send(socket, session, 'Tab'); const before = frame
    while (frame === before && Date.now() < end) { await new Promise(resolve => setTimeout(resolve, 50)); frame = tmux(socket, 'capture-pane', '-e', '-p', '-t', `${session}:0.0`) }
    if (frame === before) break; if (focusedHelp(frame)) return
  }
  throw Error('could not focus the existing Help footer button')
}
// prettier-ignore
export function ready(entry, frame) {
  const has = text => pageMarker(frame, text)
  if (entry.view === 'help') return has('Keys') && has('Tabs') && frame.includes('●  Working')
  if (entry.view === 'prs') return has(marker(entry)) && !has('Refreshing PRs')
  if (entry.view === 'agents') return has(marker(entry)) && has('Herdr agent list unavailable; local agent status is not current.')
  if (entry.view === 'timeline-detail') return has('Snapshot') && has('Back')
  if (entry.view === 'asks-detail') return has('Snapshot') && has('Back to inbox') && !has('Opening report') && (entry.scenario === 'empty' || has('This invented report checks'))
  return has(marker(entry))
}
// prettier-ignore
async function wait(socket, session, width, predicate, label, timeout = 45_000, raw = false) {
  const end = Date.now() + timeout; let last = ''
  while (Date.now() < end) { try { const capture = tmux(socket, 'capture-pane', '-p', '-t', `${session}:0.0`), crop = raw ? { text: stripAnsi(capture) } : cropInboxPane(capture, width); last = crop.text; if (predicate(last)) return crop }
    catch (error) { if (raw || !/inbox pane (divider not found|crop is incomplete)/u.test(String(error))) throw error }
    await new Promise(resolve => setTimeout(resolve, 125))
  }
  throw Error(`timed out waiting for ${label}; last pane frame:\n${last}`)
}
// prettier-ignore
async function press(socket, session, width, key, predicate, label, timeout = 15_000) {
  const end = Date.now() + timeout; let error
  while (Date.now() < end) { send(socket, session, key); try { return await wait(socket, session, width, predicate, label, Math.min(1_500, end - Date.now())) } catch (e) { error = e } }
  throw error ?? Error(`timed out waiting for ${label}`)
}
// prettier-ignore
function writeConfig(config, home, pluginDir, sessionId, fixture) {
  const settings = { hasCompletedOnboarding: true, primaryApiKey: 'sk-ant-placeholder-for-local-render-only', projects: { [pluginDir]: { hasTrustDialogAccepted: true } } }
  writeFileSync(path.join(config, '.claude.json'), JSON.stringify(settings)); writeFileSync(path.join(home, '.claude.json'), JSON.stringify(settings))
  const store = path.join(config, 'plugins', 'store'); mkdirSync(store, { recursive: true }); writeFileSync(path.join(store, PLUGIN_STORE), JSON.stringify({ [`s:${sessionId}`]: fixtureState(fixture) }))
  const bin = path.join(config, 'bin'); mkdirSync(bin, { recursive: true }); const fakeGh = path.join(bin, 'gh')
  writeFileSync(fakeGh, '#!/bin/sh\nprintf "gh is disabled in render snapshot fixtures\\n" >&2\nexit 1\n'); chmodSync(fakeGh, 0o755)
  return bin
}
// prettier-ignore
function storeKeys() {
  const store = path.join(process.env.HOME || os.homedir(), '.claude/plugins/store'), keys = new Set(); if (!existsSync(store)) return keys
  for (const name of readdirSync(store).filter(name => /^inbox_inline-.*\.json$/u.test(name))) { const data = JSON.parse(readFileSync(path.join(store, name), 'utf8')); assert.equal(typeof data, 'object', 'real store inventory must be a JSON object'); Object.keys(data).forEach(key => keys.add(key)) }
  return keys
}
// prettier-ignore
function isolate(root, home, config) {
  const realHome = realpathSync(process.env.HOME || os.homedir()), realConfig = realpathSync(process.env.CLAUDE_CONFIG_DIR || path.join(realHome, '.claude')), temp = `${realpathSync(root)}${path.sep}`, h = realpathSync(home), c = realpathSync(config)
  if ([realHome, realConfig].includes(h) || [realHome, realConfig].includes(c)) throw Error('refusing to run with a real HOME or CLAUDE_CONFIG_DIR')
  if (![h, c].every(value => value.startsWith(temp))) throw Error('refusing isolated paths outside the runner temp directory')
}
// prettier-ignore
export async function capture(entry, pluginDir, root, socket, claude) {
  const run = path.join(root, `${entry.fixture}-${entry.width}`), home = path.join(run, 'home'), config = path.join(run, 'config'), tmp = path.join(run, 'tmp')
  for (const dir of [home, config, tmp]) mkdirSync(dir, { recursive: true }); isolate(root, home, config)
  const id = randomUUID(), session = `snap-${entry.fixture}-${entry.view}-${entry.width}`, bin = writeConfig(config, home, pluginDir, id, entry.fixture)
  const env = { HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: tmp, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin`, TERM: 'xterm-256color', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CLAUDE_CODE_NO_FLICKER: '1' }
  const vars = Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join(' '), command = `cd ${quote(pluginDir)} && exec env -i ${vars} ${quote(claude)} --session-id ${id} --plugin-dir ${quote(pluginDir)}`, before = storeKeys()
  let started = false
  try {
    tmux(socket, 'new-session', '-d', '-s', session, '-x', String(entry.width), '-y', String(HEIGHT), '-c', pluginDir, command); started = true
    await wait(socket, session, entry.width, frame => pageMarker(frame, '❯') || pageMarker(frame, 'Open inbox'), 'Claude prompt', 45_000, true)
    send(socket, session, '/inbox', true); send(socket, session, 'Enter')
    const initial = entry.fixture === 'detail-empty' ? 'Snapshot empty report' : entry.fixture === 'detail-busy' ? 'Snapshot report' : entry.fixture.endsWith('empty') ? 'Nothing needed' : 'Snapshot question'
    await wait(socket, session, entry.width, frame => pageMarker(frame, initial), `initial inbox pane for ${entry.fixture}`)
    if (entry.view === 'timeline' || entry.view === 'timeline-detail') await press(socket, session, entry.width, '2', frame => entry.view === 'timeline' ? ready(entry, frame) : pageMarker(frame, entry.scenario === 'empty' ? 'Snapshot detail empty' : 'Snapshot root'), 'Timeline')
    if (entry.view === 'agents' || entry.view === 'prs') await press(socket, session, entry.width, entry.view === 'agents' ? '3' : '4', frame => ready(entry, frame), entry.view)
    if (entry.view === 'timeline-detail') await press(socket, session, entry.width, 'Enter', frame => ready(entry, frame), 'Timeline detail')
    if (entry.view === 'asks-detail') await press(socket, session, entry.width, 'v', frame => ready(entry, frame), 'Asks detail')
    if (entry.view === 'help') { await focusHelp(socket, session); send(socket, session, 'Enter') }
    const crop = await wait(socket, session, entry.width, frame => ready(entry, frame), `${entry.view} ${entry.scenario}`); process.stdout.write(`CAPTURE ${entry.file}\n`)
    return { entry, frame: crop.text, paneWidth: crop.paneWidth }
  } finally { if (started) try { tmux(socket, 'kill-session', '-t', session) } catch {}; const appeared = [...storeKeys()].filter(key => !before.has(key)); if (appeared.length) throw Error(`real inbox store gained ${appeared.length} key(s) during ${entry.file}`) }
}
// prettier-ignore
export const removeTemporaryTree = root => rmSync(root, { recursive: true, force: true })
export { cropInboxPane, tmux, stripAnsi }
