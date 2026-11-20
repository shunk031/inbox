import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PRESS_GUARD_MS, QUEUED_AFTER_MS, SETTLED_MS } from '../hooks/timing'
import { RUNNING_FRAMES } from '../hooks/help'
import { waitForPressWindow } from '../hooks/held-sends'
import { deliverPrompt } from '../hooks/mod-delivery'
import { w, arrive, arriveFirst, world } from './hooks-world'
import { BAND, PANE, selectRow, replyKey } from './hooks-helpers'

async function answerPane($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))
  w.paneState = { isShown: true, isFocused: true }
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'add a greeting cli', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'Plan ready.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  const pane = await $.ui.mount(PANE)
  await clock.settle()
  return { clock, pane }
}

test('a press whose submit stays pending through a turn reads Queued instead of Not confirmed until the message runs', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))

  await $.session.start({ cwd: '/tmp/project', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'add a greeting cli', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer: 'Plan ready. 1. Node or Python? 2. Call it greet?',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.settle()
  const pane = await $.ui.mount(PANE)

  w.submitAnswer = 'hold'
  w.inFlight.push(pane.press({ key: 'explain-i1-key' }))
  await clock.advance(QUEUED_AFTER_MS)
  expect(await pane.find({ text: /Not\s+confirmed/ })).toBeUndefined()
  expect(await pane.find({ text: /Queued:\sExplain$/ })).toBeDefined()

  await arrive($)
  await clock.settle()
  expect(await pane.find({ text: /Queued/ })).toBeUndefined()
  expect(await pane.find({ text: /Not\s+confirmed/ })).toBeUndefined()
})

test(
  'a press during a turn reads Queued until its prompt enters, and one that will not enter is undone with Not sent and [Try again]',
  { timeoutMs: 20_000 },
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const prompts: string[] = []
    world($, on, prompts)
    on('ui.focus', () => ({}))
    let drafts: unknown = null
    on('state.set', { plugin: 'inbox', key: 'drafts' } as const, (_$, e, next) => {
      drafts = e.value
      return next(e)
    })

    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
    await $.prompt.submit({ text: 'add a greeting cli', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({
      answer: 'Plan ready. 1. Node or Python? 2. Call it greet?',
      durationMs: 5,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    })
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    const band = await $.ui.mount({ plugin: 'inbox', surface: 'terminal', ...BAND })

    w.submitAnswer = 'hold'
    w.inFlight.push(pane.press({ key: 'explain-i1-key' }))
    await clock.settle()
    expect(await pane.find({ text: /Queued/ })).toBeUndefined()
    await clock.advance(QUEUED_AFTER_MS)
    expect(await pane.find({ text: /^Queued:\sExplain$/ })).toBeDefined()
    await selectRow(pane, 'i2')
    await clock.advance(PRESS_GUARD_MS)
    await pane.press({ key: 'typekey-i2' })
    w.inFlight.push(pane.input({ key: await replyKey(pane, 'i2'), text: 'yes' }))
    await clock.settle()
    await clock.advance(QUEUED_AFTER_MS)
    expect(await pane.find({ text: /Queued reply: yes/ })).toBeDefined()
    await arrive($)
    await clock.settle()
    await selectRow(pane, 'i1')
    expect(await pane.find({ text: new RegExp(`^[${RUNNING_FRAMES.join('')}] Explaining…$`) })).toBeDefined()
    expect(await pane.find({ text: /Queued/ })).toBeUndefined()

    w.submitAnswer = { drop: 'a hook refused it' }
    await selectRow(pane, 'i1')
    await clock.advance(PRESS_GUARD_MS)
    await pane.press({ key: 'typekey-i1' })
    await pane.input({ key: await replyKey(pane, 'i1'), text: 'Deno, actually' })
    await clock.settle()
    expect(w.sent.at(-1)).toBe('Re "Use Node or Python?": Deno, actually')
    expect(await pane.find({ key: 'row-i1' })).toBeDefined()
    expect(drafts).toEqual({ i1: { text: 'Deno, actually', since: expect.any(Number) } })
    const answer = pane.press({ key: 'answer-i1-0' })
    w.inFlight.push(answer)
    await clock.advance(SETTLED_MS)
    await Promise.all(w.inFlight)
    w.inFlight = []
    expect(w.sent.at(-1)).toBe('Re "Use Node or Python?": Node')
    expect(await pane.find({ key: 'row-i1' })).toBeDefined()
    expect(await pane.find({ text: 'Not sent: a hook refused it' })).toBeDefined()
    expect(await band.find({ text: /Asks 1/ })).toBeDefined()
    expect((await pane.find({ key: 'answer-i1-0-key' }))?.props.label).toBe('Node (recommended)')

    w.submitAnswer = 'enter'
    const next = await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
    expect(next.context?.join('\n') ?? '').not.toMatch(/→ (Node|Deno)/)
    await $.turn.complete({ answer: 'Carrying on.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.settle()
    expect(prompts.at(-1)).toContain('carry on\n</person>')
    expect(prompts.at(-1)).not.toContain('Re "Use Node or Python?"')

    w.inFlight.push(pane.press({ key: 'retry-i1' }))
    await clock.advance(SETTLED_MS)
    await Promise.all(w.inFlight)
    w.inFlight = []
    expect(w.sent.at(-1)).toBe('Re "Use Node or Python?": Node')
    expect(await pane.find({ key: 'row-i1' })).toBeUndefined()
  },
)

test('a reply another plugin rewrote to the text of a pending press reads Not confirmed and keeps its draft', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))
  let drafts: unknown = null
  on('state.set', { plugin: 'inbox', key: 'drafts' } as const, (_$, e, next) => {
    drafts = e.value
    return next(e)
  })

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'add a greeting cli', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer: 'Plan ready. 1. Node or Python? 2. Call it greet?',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.settle()
  const pane = await $.ui.mount(PANE)
  w.submitAnswer = 'hold'
  w.inFlight.push(pane.press({ key: 'explain-i1-key' }))
  await clock.settle()
  await selectRow(pane, 'i2')
  await clock.advance(PRESS_GUARD_MS)
  await pane.press({ key: 'typekey-i2' })
  w.submitAnswer = { rewrite: w.held[0]!.text }
  await pane.input({ key: await replyKey(pane, 'i2'), text: 'greet is fine' })
  await clock.settle()
  expect(await pane.find({ text: /Reply not confirmed: greet is fine/ })).toBeDefined()
  expect(drafts).toEqual({ i2: { text: 'greet is fine', since: expect.any(Number) } })
  await arrive($)
})

test('a second Explain press while the first is out sends nothing, and the first reads Explaining… once it enters', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'add a greeting cli', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer: 'Plan ready. 1. Node or Python? 2. Call it greet?',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.settle()
  const pane = await $.ui.mount(PANE)
  w.submitAnswer = 'hold'
  w.inFlight.push(pane.press({ key: 'explain-i1-key' }))
  await clock.advance(PRESS_GUARD_MS)
  expect((await pane.find({ key: 'explain-i1' }))?.props.dimColor).toBe(true)
  w.inFlight.push(pane.press({ key: 'explain-i1-key' }))
  await clock.settle()
  expect(w.held).toHaveLength(1)

  await arriveFirst($)
  await clock.settle()
  expect(await pane.find({ text: /Explaining…/ })).toBeDefined()
  expect(await pane.find({ text: /Not confirmed/ })).toBeUndefined()
})

test('Undo works while an Answer press is holding the host vouch, and cancels its send', async ($, on) => {
  const { clock, pane } = await answerPane($, on)
  expect(await pane.find({ key: 'answer-i1-0' })).toBeDefined()
  const answer = pane.press({ key: 'answer-i1-0' })
  w.inFlight.push(answer)
  await clock.advance(SETTLED_MS / 2)

  expect(JSON.parse(w.stored.get('s:session-1')!).lastActions.i1.delivery.state).toBe('held')
  expect(await pane.find({ key: 'undo-i1' })).toBeDefined()
  expect(w.sent).toEqual([])
  await pane.press({ key: 'undo-i1' })
  await clock.advance(SETTLED_MS)
  await Promise.all(w.inFlight)
  w.inFlight = []

  expect(w.sent).toEqual([])
  expect(await pane.find({ key: 'answer-i1-0' })).toBeDefined()
})

test('the exact host-stop refusal stays queued, then retries once after a human prompt', async ($, on) => {
  const { clock, pane } = await answerPane($, on)
  expect(await pane.find({ key: 'answer-i1-0' })).toBeDefined()
  const message = 'Re "Use Node or Python?": Node'
  w.submitAnswer = { drop: 'the session was stopped and nobody has sent input since' }
  const answer = pane.press({ key: 'answer-i1-0' })
  w.inFlight.push(answer)
  await clock.advance(SETTLED_MS)
  await Promise.all(w.inFlight)
  w.inFlight = []

  expect(w.sent).toEqual([message])
  expect(JSON.parse(w.stored.get('s:session-1')!).lastActions.i1.delivery.state).toBe('queued')
  expect(await pane.find({ text: /Queued/ })).toBeDefined()
  expect(await pane.find({ text: /Not sent/ })).toBeUndefined()

  w.submitAnswer = 'enter'
  await $.prompt.submit({ text: 'continue', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(w.sent).toEqual([message, message])
  await $.prompt.submit({ text: 'continue again', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(w.sent).toEqual([message, message])
})

test('closing the pane leaves a held Answer to send when its Undo window ends', async ($, on) => {
  const { clock, pane } = await answerPane($, on)
  const answer = pane.press({ key: 'answer-i1-0' })
  await clock.advance(1)
  await pane.unmount()
  expect(w.sent).toEqual([])
  await clock.advance(SETTLED_MS)
  await answer
  expect(w.sent).toEqual(['Re "Use Node or Python?": Node'])
})

test('aborting the Answer wait cancels its timer', async () => {
  const wait = new AbortController()
  let timer = true
  const waiting = waitForPressWindow(SETTLED_MS, wait.signal, () => ({ cancel: () => (timer = false) }))
  wait.abort()
  await waiting
  expect(timer).toBe(false)
})

test('the host-stop refusal stays rejected if its conversation changes during submit', async () => {
  const reason = 'the session was stopped and nobody has sent input since'
  let current = true
  const outcome = await deliverPrompt(
    {
      isCurrent: () => current,
      read: async () => Promise.reject(new Error('conversation changed before reading')),
      submit: async () => ((current = false), { drop: reason }),
      rewrite: async () => Promise.reject(new Error('refused send cannot be rewritten')),
    },
    'Re "Use Node or Python?": Node',
    'delivery-1',
  )
  expect(outcome).toEqual({ state: 'rejected', reason })
})
