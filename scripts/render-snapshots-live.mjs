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
import { isTerminalChrome, marker, pageMarker } from './render-snapshots-checks.mjs'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const tmux = (socket, ...args) =>
  execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const send = (socket, session, key, literal = false) =>
  tmux(socket, 'send-keys', '-t', `${session}:0.0`, ...(literal ? ['-l'] : []), key)
const stripAnsi = text => text.replace(ANSI, '').replace(/\r/g, '')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function cropInboxPane(capture, width) {
  const lines = stripAnsi(capture).replace(/\n+$/u, '').split('\n')
  const counts = new Map()
  for (const line of lines)
    for (const m of line.matchAll(/│/g)) {
      const col = cellWidth(line.slice(0, m.index))
      if (col >= Math.floor(width / 3) && col < width - 20) counts.set(col, (counts.get(col) ?? 0) + 1)
    }
  const candidate = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
  const singlePane = width <= 87 && candidate === undefined
  const divider = singlePane ? 0 : (candidate ?? -1)
  const paneWidth = singlePane ? width - 2 : divider < 0 ? width : width - divider - 1
  const frame = lines.map(line => {
    if (singlePane && line.startsWith('│') && line.endsWith('│') && cellWidth(line) === width)
      return line.slice(1, -1).replace(/ +$/u, '')
    const prefix = cutToCells(line, divider + 1)
    return divider >= 0 && cellWidth(prefix) === divider + 1 && prefix.endsWith('│')
      ? line.slice(prefix.length).replace(/ +$/u, '')
      : line
  })
  const top = frame.findIndex(line => line.startsWith('╭'))
  const bottom = frame.findLastIndex(line => line.startsWith('╰'))
  const visible = singlePane && top >= 0 && bottom > top ? frame.slice(top, bottom + 1) : frame
  return {
    text: visible
      .filter(line => !isTerminalChrome(line, width))
      .join('\n')
      .replace(capture.endsWith('\n') ? /\n$/u : /$^/u, ''),
    paneWidth,
    dividerColumn: divider,
  }
}
const focusedHelp = frame => {
  const line = frame.split('\n').find(text => text.includes('Help'))
  if (!line) return false
  let inverse = false
  for (const m of line.matchAll(/\x1b\[([\d;]*)m/gu)) {
    if (m.index >= line.indexOf('Help')) break
    for (const n of m[1].split(';').map(Number)) {
      if (n === 0 || n === 27) inverse = false
      if (n === 7) inverse = true
    }
  }
  return inverse
}
async function focusHelp(socket, session, onTimeout) {
  let frame = tmux(socket, 'capture-pane', '-e', '-p', '-t', `${session}:0.0`)
  const end = Date.now() + 20_000
  for (let i = 0; i < 100 && Date.now() < end; i++) {
    const before = frame
    send(socket, session, 'Tab')
    frame = (
      await wait(socket, session, 0, next => next !== before, 'Help navigation', 'ansi', end - Date.now(), {
        onTimeout,
      })
    ).text
    if (focusedHelp(frame)) return
  }
  onTimeout?.(frame, 'Help focus')
  throw Error('could not focus the existing Help footer button')
}
export function ready(entry, frame) {
  const has = text => pageMarker(frame, text)
  if (entry.view === 'help') return has('Keys') && has('Tabs') && frame.includes('●  Working')
  if (entry.view === 'prs') return has(marker(entry)) && !has('Refreshing PRs')
  if (entry.view === 'agents' && entry.fixture === 'agents-tree') {
    const connectors = [...frame.matchAll(/├─|└─/gu)].length
    return (
      ['Orchestrators', 'Meta tasks', 'Local agents'].every(has) &&
      connectors >= 11 &&
      ['snapshot-local', 'In progress'].every(has) &&
      (entry.width !== 87 || has('snapshot-local-worker'))
    )
  }
  if (entry.view === 'agents' && entry.fixture === 'agents-busy') {
    const required = [marker(entry), 'Stale', 'In progress', 'Waiting', 'snapshot-local']
    const missing = required.filter(text => !has(text))
    return missing.length === 0
  }
  if (entry.view === 'agents')
    return has(marker(entry)) && has('Herdr agent list unavailable; local agent status is not current.')
  if (entry.view === 'timeline-detail') return has('Snapshot') && has('Back')
  if (entry.view === 'asks-detail')
    return (
      has('Snapshot') &&
      has('Back to inbox') &&
      !has('Opening report') &&
      (entry.scenario === 'empty' || has('This invented report checks'))
    )
  return has(marker(entry))
}
export async function wait(
  socket,
  session,
  width,
  predicate,
  label,
  mode = 'pane',
  timeout = 45_000,
  { onTimeout, captureFrame } = {},
) {
  const end = Date.now() + timeout
  let last = ''
  let previous
  let lastCapture
  while (Date.now() < end) {
    const capture = captureFrame
      ? captureFrame()
      : tmux(socket, 'capture-pane', '-N', '-e', '-p', '-t', `${session}:0.0`)
    lastCapture = capture
    const crop =
      mode === 'pane' ? cropInboxPane(capture, width) : { text: mode === 'raw' ? stripAnsi(capture) : capture }
    last = crop?.text ?? stripAnsi(capture).slice(-1600)
    if (crop && predicate(crop.text) && capture === previous) return { ...crop, capture }
    previous = capture
    await pause(125)
  }
  onTimeout?.(lastCapture, label)
  throw Error(`timed out waiting for ${label}${last ? `\nLast frame:\n${last}` : ''}`)
}
export function saveRawTimeoutFrame(directory, name, frame) {
  const file = path.join(directory, name.replace(/\.txt$/u, '.timeout.ansi'))
  writeFileSync(file, frame)
  return file
}
async function press(socket, session, width, key, predicate, label, timeout = 15_000, onTimeout) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    send(socket, session, key)
    try {
      return await wait(socket, session, width, predicate, label, 'pane', Math.min(1_500, end - Date.now()), {
        onTimeout,
      })
    } catch (error) {
      if (!String(error).startsWith('Error: timed out waiting for')) throw error
      last = error
    }
  }
  throw last ?? Error(`timed out waiting for ${label}`)
}
function writeConfig(config, home, pluginDir, sessionId, fixture) {
  const settings = {
    hasCompletedOnboarding: true,
    primaryApiKey: 'sk-ant-placeholder-for-local-render-only',
    projects: { [pluginDir]: { hasTrustDialogAccepted: true } },
  }
  writeFileSync(path.join(config, '.claude.json'), JSON.stringify(settings))
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify(settings))
  const store = path.join(config, 'plugins', 'store')
  mkdirSync(store, { recursive: true })
  writeFileSync(path.join(store, PLUGIN_STORE), JSON.stringify({ [`s:${sessionId}`]: fixtureState(fixture) }))
  const bin = path.join(config, 'bin')
  mkdirSync(bin, { recursive: true })
  const fakeGh = path.join(bin, 'gh')
  writeFileSync(fakeGh, '#!/bin/sh\nprintf "gh is disabled in render snapshot fixtures\\n" >&2\nexit 1\n')
  chmodSync(fakeGh, 0o755)
  if (fixture === 'agents-busy' || fixture === 'agents-tree') {
    const fakeHerdr = path.join(bin, 'herdr')
    writeFileSync(
      fakeHerdr,
      `#!/bin/sh\nprintf '%s\\n' '{"result":{"agents":[{"name":"snapshot-local-worker","agent_status":"working"}]}}'\n`,
    )
    chmodSync(fakeHerdr, 0o755)
  }
  return bin
}
function copyReadOnlyFeeds(source, destination) {
  mkdirSync(destination, { recursive: true })
  const files = readdirSync(source, { withFileTypes: true }).filter(
    entry => entry.isFile() && entry.name.endsWith('.json'),
  )
  for (const entry of files) {
    const copy = path.join(destination, entry.name)
    writeFileSync(copy, readFileSync(path.join(source, entry.name)))
    chmodSync(copy, 0o444)
  }
  chmodSync(destination, 0o555)
  return files.length
}
export function storeKeys(env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude')
  const store = path.join(config, 'plugins', 'store')
  const keys = new Set()
  if (!existsSync(store)) return keys
  for (const name of readdirSync(store).filter(name => /^inbox_inline-.*\.json$/u.test(name))) {
    const data = JSON.parse(readFileSync(path.join(store, name), 'utf8'))
    assert.equal(typeof data, 'object', 'real store inventory must be a JSON object')
    Object.keys(data).forEach(key => keys.add(key))
  }
  return keys
}
const realPathOrResolve = value => {
  try {
    return realpathSync(value)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return path.resolve(value)
  }
}
export function isolate(root, home, config, env = process.env) {
  const homePath = env.HOME || os.homedir()
  const realHome = realPathOrResolve(homePath)
  const realConfig = realPathOrResolve(env.CLAUDE_CONFIG_DIR || path.join(homePath, '.claude'))
  const temp = `${realPathOrResolve(root)}${path.sep}`
  const h = realPathOrResolve(home)
  const c = realPathOrResolve(config)
  if ([realHome, realConfig].includes(h) || [realHome, realConfig].includes(c))
    throw Error('refusing to run with a real HOME or CLAUDE_CONFIG_DIR')
  if (![h, c].every(value => value.startsWith(temp)))
    throw Error('refusing isolated paths outside the runner temp directory')
}
export async function capture(entry, pluginDir, root, socket, claude, { feedSource, onTimeout } = {}) {
  const run = path.join(root, entry.file.replace(/\.txt$/u, ''))
  const home = path.join(run, 'home')
  const config = path.join(run, 'config')
  const tmp = path.join(run, 'tmp')
  const terminalWidth = entry.terminalWidth ?? entry.width
  for (const dir of [home, config, tmp]) mkdirSync(dir, { recursive: true })
  isolate(root, home, config)
  const id = randomUUID()
  const session = `snap-${entry.fixture}-${entry.view}-${entry.width}`
  const bin = writeConfig(config, home, pluginDir, id, entry.fixture)
  const feedCopy = feedSource ? path.join(config, 'feeds') : null
  if (feedSource && copyReadOnlyFeeds(feedSource, feedCopy) === 0) throw Error('no regular JSON feed files to copy')
  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    TMPDIR: tmp,
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin`,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    CLAUDE_CODE_NO_FLICKER: '1',
    ...(feedCopy ? { INBOX_FEED: feedCopy } : {}),
  }
  const vars = Object.entries(env)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(' ')
  const command = `env -i ${vars} ${quote(claude)} --session-id ${id} --plugin-dir ${quote(pluginDir)}`
  const before = storeKeys()
  try {
    tmux(
      socket,
      'new-session',
      '-d',
      '-s',
      session,
      '-x',
      String(terminalWidth),
      '-y',
      String(entry.height ?? HEIGHT),
      '-c',
      pluginDir,
      command,
    )
    await wait(
      socket,
      session,
      terminalWidth,
      frame => pageMarker(frame, '❯') || pageMarker(frame, 'Open inbox'),
      'Claude prompt',
      'raw',
      45_000,
      { onTimeout },
    )
    send(socket, session, '/inbox', true)
    send(socket, session, 'Enter')
    const initial = entry.fixture.startsWith('timeline-detail-layout')
      ? 'Timeline'
      : entry.fixture === 'detail-empty'
        ? 'Snapshot empty report'
        : entry.fixture === 'detail-busy'
          ? 'Snapshot report'
          : entry.fixture === 'agents-busy' || entry.fixture === 'agents-tree' || entry.fixture.endsWith('empty')
            ? 'Nothing needed'
            : 'Snapshot question'
    await wait(
      socket,
      session,
      terminalWidth,
      frame => pageMarker(frame, initial),
      `initial inbox pane for ${entry.fixture}`,
      'pane',
      45_000,
      { onTimeout },
    )
    const timelineDetail = frame =>
      pageMarker(
        frame,
        entry.fixture.startsWith('timeline-detail-layout')
          ? 'Snapshot timeline'
          : entry.scenario === 'empty'
            ? 'Snapshot detail empty'
            : 'Snapshot root',
      )
    const childSelected = frame => {
      const row = frame.split('\n').find(line => line.includes('折り返し用'))
      return row?.slice(0, row.indexOf('折り返し用')).includes('>') ?? false
    }
    const steps = {
      timeline: [['2', frame => ready(entry, frame)], ...(entry.scenario === 'busy' ? [['j', childSelected]] : [])],
      'timeline-detail': [
        ['2', timelineDetail],
        ['Enter', frame => ready(entry, frame)],
      ],
      agents: [['3', frame => ready(entry, frame)]],
      prs: [['4', frame => ready(entry, frame)]],
      'asks-detail': [['v', frame => ready(entry, frame)]],
      asks: [],
      help: [],
    }
    for (const [key, predicate] of steps[entry.view])
      await press(
        socket,
        session,
        terminalWidth,
        key,
        predicate,
        `${entry.view} ${entry.scenario} ${key}`,
        15_000,
        onTimeout,
      )
    if (entry.view === 'help') {
      await focusHelp(socket, session, onTimeout)
      send(socket, session, 'Enter')
    }
    const crop = await wait(
      socket,
      session,
      terminalWidth,
      frame => ready(entry, frame),
      `${entry.view} ${entry.scenario}`,
      'pane',
      45_000,
      { onTimeout },
    )
    const ansiFrame = crop.capture
    process.stdout.write(`CAPTURE ${entry.file}\n`)
    return { entry, frame: crop.text, ansiFrame, paneWidth: crop.paneWidth, dividerColumn: crop.dividerColumn }
  } finally {
    try {
      tmux(socket, 'kill-session', '-t', session)
    } catch {}
    const appeared = [...storeKeys()].filter(key => !before.has(key))
    if (appeared.length) throw Error(`real inbox store gained ${appeared.length} key(s) during ${entry.file}`)
  }
}
export const removeTemporaryTree = root => rmSync(root, { recursive: true, force: true })
export { cropInboxPane, tmux, stripAnsi }
