import { expect, mock, test } from 'claude-code/testing'
import { SESSION_VERSION } from '../hooks/session-version'
import { PRESS_GUARD_MS, SETTLED_MS } from '../hooks/timing'
import { statusPage } from '../hooks/status-page'
import { taskOwnerKey } from '../hooks/task-facts'
import { taskTreeFromStatus } from '../hooks/task-tree'
import type { Session } from '../types'
import { w, world } from './hooks-world'
import { PANE, selectRow, SAVED_SESSION } from './hooks-helpers'
import { savedTaskSession } from './task-tree-fixtures'

test('a session saved with no version, mid-turn, by a process that ended loads with no turn running, its Done message goes, and its next save writes the session version', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let session: Parameters<typeof statusPage>[0] | null = null
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, e, next) => {
    session = e.value as never
    return next(e)
  })
  const task = {
    ...SAVED_SESSION.ledger.items[0]!,
    kind: 'task',
    label: null,
    ask: 'Sign in to npm',
    options: [],
    rec: null,
  }
  w.stored.set(
    's:session-1',
    JSON.stringify({
      ...SAVED_SESSION,
      ledger: { ...SAVED_SESSION.ledger, items: [task] },
      presence: { isTurnRunning: true },
    }),
  )

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(session!.presence.isTurnRunning).toBe(false)
  const pane = await $.ui.mount(PANE)
  await selectRow(pane, 'i1')
  await clock.advance(PRESS_GUARD_MS)
  await pane.press({ key: 'done-i1' })
  await clock.advance(SETTLED_MS)
  expect(w.sent).toEqual(['Done: Sign in to npm'])
  expect(JSON.parse(w.stored.get('s:session-1')!).version).toBe(SESSION_VERSION)
})

test('the Claude mod upgrades a legacy task tree save when it loads it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let session: Session | null = null
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    session = event.value as Session
    return next(event)
  })
  const oldSave = { ...SAVED_SESSION, ...savedTaskSession() }
  w.stored.set('s:session-1', JSON.stringify(oldSave))

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(session!.taskTree).toEqual(taskTreeFromStatus(oldSave.ledger.overview))
})

test('the Claude mod keeps a task tree already present in its saved session', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let session: Session | null = null
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    session = event.value as Session
    return next(event)
  })
  const status = savedTaskSession().ledger.overview
  const migratedTree = taskTreeFromStatus(status).map((task, index) =>
    index === 0
      ? {
          ...task,
          links: {
            pr: 'https://github.com/acme/app/pull/12',
            issue: 'https://github.com/acme/app/issues/34',
            owner: { agent: 'worker-1', machine: 'local' },
          },
        }
      : task,
  )
  w.stored.set('s:session-1', JSON.stringify({ ...SAVED_SESSION, ...savedTaskSession(migratedTree) }))

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(session!.taskTree).toEqual(migratedTree)
  expect(session!.taskTree[0]?.links).toEqual(migratedTree[0]?.links)
})

test('a live owner refresh survives bringing the saved session back', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [], { HOME: '/home/test' })
  const owner = { agent: 'owner-refresh', machine: 'local' }
  const ownerKey = taskOwnerKey(owner)
  const tree = taskTreeFromStatus(savedTaskSession().ledger.overview).map((task, index) =>
    index === 0 ? { ...task, status: 'working' as const, links: { owner } } : task,
  )
  const saved = {
    ...SAVED_SESSION,
    ...savedTaskSession(tree),
    taskOwnerFacts: { [ownerKey]: { state: 'done' as const, since: 1 } },
    taskOwnerFactCheckedAt: 1,
  }
  w.stored.set('s:session-1', JSON.stringify(saved))
  w.ghAnswers.push({
    match: argv => argv[0] === 'herdr' && argv[1] === 'agent' && argv[2] === 'get' && argv[3] === owner.agent,
    stdout: JSON.stringify({ result: { agent: { agent_status: 'working' } } }),
  })
  let session: Session | null = null
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    session = event.value as Session
    return next(event)
  })

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(JSON.parse(w.stored.get('s:session-1')!).taskOwnerFacts[ownerKey].state).toBe('working')

  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
  await clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-1' })
  await clock.settle()

  expect(session!.taskOwnerFacts[ownerKey]).toMatchObject({ state: 'working' })
})

test('a restored session exports its existing task tree as soon as it loads, without a task change', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [], { HOME: '/home/test' })
  const tree = taskTreeFromStatus(savedTaskSession().ledger.overview)
  const restored = { ...SAVED_SESSION, ...savedTaskSession(tree) }
  let firstRead = true
  on('state.get', { plugin: 'inbox', key: 'session' } as const, (_$, event, next) => {
    if (firstRead) {
      firstRead = false
      return { value: restored as never }
    }
    return next(event)
  })
  w.stored.set('s:session-1', JSON.stringify(restored))

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const exported = w.written['/home/test/.local/state/inbox/task-tree/session-1.json']
  expect(exported).toBeDefined()
  expect(JSON.parse(exported!).tasks.map((task: { id: string }) => task.id)).toEqual(tree.map(task => task.id))
})

test('resuming a session waits for its in-flight save before loading it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'old request', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'Old reply.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  let entered!: () => void
  let release!: () => void
  const inSet = new Promise<void>(resolve => (entered = resolve))
  const held = new Promise<void>(resolve => (release = resolve))
  w.storeSetHold = async key => {
    if (key !== 's:session-1') return
    w.storeSetHold = undefined
    entered()
    await held
  }
  const adding = $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'task',
    ask: 'New task',
  })
  await inSet
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  let loaded = false
  const loading = $.classic.SessionStart({ source: 'resume', session_id: 'session-1' }).then(() => {
    loaded = true
  })
  await clock.settle()
  expect(loaded).toBe(false)
  release()
  await Promise.all([loading, adding])
  await clock.settle()
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-needsYou' })
  expect(await pane.find({ text: /New task/ })).toBeDefined()
})

test('a delayed saved-session read cannot replace a newer conversation', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  const savedFor = (ask: string) => ({
    ...SAVED_SESSION,
    ledger: { ...SAVED_SESSION.ledger, items: [{ ...SAVED_SESSION.ledger.items[0]!, ask }] },
  })
  w.stored.set('s:session-2', JSON.stringify(savedFor('Second session question?')))
  w.stored.set('s:session-3', JSON.stringify(savedFor('Third session question?')))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  let entered!: () => void
  let release!: () => void
  const inRead = new Promise<void>(resolve => (entered = resolve))
  const held = new Promise<void>(resolve => (release = resolve))
  let heldOnce = false
  w.storeHold = async () => {
    if (!heldOnce) {
      heldOnce = true
      entered()
      await held
    }
  }
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  const loadingOld = $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
  await inRead
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-3' })
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: /Third session question/ })).toBeDefined()
  release()
  await loadingOld
  await clock.settle()
  expect(await pane.find({ text: /Third session question/ })).toBeDefined()
  expect(await pane.find({ text: /Second session question/ })).toBeUndefined()
})

test('a delayed saved-session application cannot poison the next load', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  const savedFor = (ask: string) => ({
    ...SAVED_SESSION,
    ledger: { ...SAVED_SESSION.ledger, items: [{ ...SAVED_SESSION.ledger.items[0]!, ask }] },
  })
  w.stored.set('s:session-2', JSON.stringify(savedFor('Second session question?')))
  w.stored.set('s:session-3', JSON.stringify(savedFor('Third session question?')))
  let entered!: () => void
  let release!: () => void
  const afterWrite = new Promise<void>(resolve => (entered = resolve))
  const held = new Promise<void>(resolve => (release = resolve))
  let holdNext = false
  on('state.set', { plugin: 'inbox', key: 'unreadable' } as const, async (_$, e, next) => {
    const result = await next(e)
    if (holdNext) {
      holdNext = false
      entered()
      await held
    }
    return result
  })
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  holdNext = true
  const loadingOld = $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
  await afterWrite
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  const loadingNew = $.classic.SessionStart({ source: 'resume', session_id: 'session-3' })
  release()
  await Promise.all([loadingOld, loadingNew])
  await clock.settle()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: /Third session question/ })).toBeDefined()
  expect(await pane.find({ text: /Second session question/ })).toBeUndefined()
})

test('a tool call after a hot reload, before the load converts the ledger, still applies', async ($, on) => {
  mock.clock(on, { now: 1 })
  world($, on, [])
  let strip = false
  on('state.set', { plugin: 'inbox', key: 'session' } as const, (_$, e, next) => {
    if (!strip) return next(e)
    const { closedFindings, ...old } = e.value.ledger as unknown as Record<string, unknown>
    return next({ ...e, value: { ...e.value, ledger: old as never } })
  })
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'task',
    ask: 'Review the README',
  })
  strip = true
  await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'task',
    ask: 'Review the second file',
  })
  strip = false
  const r = await $.tool.call({ tool: 'mcp__inbox__close', id: 'i1', reason: 'reviewed' } as never)
  expect(r.result).toContain('Closed. The user sees it in the /inbox pane')
})
