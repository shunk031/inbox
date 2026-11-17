import { expect, mock, test } from 'claude-code/testing'
import { PRESS_GUARD_MS } from '../hooks/timing'
import { w, world } from './hooks-world'
import { PANE, SAVED_SESSION, selectRow, replyField, replyKey } from './hooks-helpers'

test('t opens a field for a question and a saved legacy finding', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))
  w.stored.set(
    's:session-1',
    JSON.stringify({
      ...SAVED_SESSION,
      ledger: {
        ...SAVED_SESSION.ledger,
        items: [
          SAVED_SESSION.ledger.items[0],
          {
            ...SAVED_SESSION.ledger.items[0],
            id: 'i2',
            label: '2',
            ask: 'Name the command greet?',
            options: ['Yes', 'No'],
            rec: 'Yes',
          },
        ],
        findings: [
          {
            id: 'f3',
            kind: 'issue',
            title: 'README is stale',
            detail: 'It names the old command.',
            path: null,
            at: 900_000,
          },
        ],
        nextId: 4,
        turn: 1,
        batchTurn: 1,
      },
    }),
  )
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount(PANE)
  expect(await replyField(pane, 'i1')).toBeUndefined()
  await pane.press({ key: 'typekey-i1' })
  await pane.input({ key: await replyKey(pane, 'i1'), text: ' ' })
  await clock.settle()
  expect(await replyField(pane, 'i1')).toBeDefined()
  await pane.press({ key: 'send-i1' })
  await clock.settle()
  expect(await replyField(pane, 'i1')).toBeDefined()
  await pane.input({ key: await replyKey(pane, 'i1'), text: 'Deno, actually', kind: 'change' })
  await pane.press({ key: 'cancel-i1' })
  expect(await replyField(pane, 'i1')).toBeUndefined()
  expect(w.sent).toEqual([])
  await selectRow(pane, 'i2')
  await selectRow(pane, 'i1')
  await clock.advance(PRESS_GUARD_MS)
  await pane.press({ key: 'typekey-i1' })
  expect((await replyField(pane, 'i1'))?.props.value).toBe('Deno, actually')
  await pane.press({ key: 'send-i1' })
  expect(w.sent.at(-1)).toBe('Re "Use Node or Python?": Deno, actually')
  expect((await pane.find({ key: 'row-i1' }))?.text).toMatch(/^Use Node or Python\?\s·\s✓ Replied: Deno, actually/)
  const questionBack = await $.tool.call({ tool: 'mcp__inbox__close', id: 'i1', answer: 'Why not Deno?' } as never)
  expect(questionBack.result).toContain('Not closed: the user asked a question back')
  await $.tool.call({ tool: 'mcp__inbox__close', id: 'i1', answer: 'Deno' } as never)
  await clock.settle()
  expect(await pane.find({ key: 'row-i1' })).toBeUndefined()

  await pane.press({ key: 'tab-key-needsYou' })
  await clock.settle()
  if (!(await pane.find({ text: /README is stale/ }))) await pane.press({ key: 'fold-legacy' })
  await clock.settle()
  await selectRow(pane, 'f3')
  await clock.advance(PRESS_GUARD_MS)
  for (const key of ['discuss-f3', 'drop-f3'])
    if (!(await pane.find({ key }))) throw new Error(`Legacy action is missing: ${key}`)
  await pane.press({ key: 'drop-f3' })
  await clock.settle()
  expect(await pane.find({ text: /README is stale/ })).toBeUndefined()
  expect(JSON.parse(w.stored.get('s:session-1') ?? '{}').ledger.closedFindings).toHaveLength(1)
})

test('Escape in a reply field closes the field and keeps the pane and the draft', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))
  w.paneState = { isShown: true, isFocused: false }

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
  await pane.press({ key: 'typekey-i1' })
  await pane.input({ key: await replyKey(pane, 'i1'), text: 'Deno, actually', kind: 'change' })
  await clock.settle()
  expect(w.paneOpens.at(-1)?.closeOnEscape).toBeUndefined()

  await pane.redraw({ ...PANE.props, isFocused: false })
  await clock.settle()
  expect(await replyField(pane, 'i1')).toBeUndefined()
  expect(await pane.find({ key: 'row-i1' })).toBeDefined()
  expect(w.paneOpens.at(-1)).toMatchObject({ id: 'inbox', closeOnEscape: true })
  expect(w.paneOpens.at(-1)?.focus).toBeUndefined()

  await pane.redraw({ ...PANE.props, isFocused: true })
  await clock.advance(PRESS_GUARD_MS)
  await pane.press({ key: 'typekey-i1' })
  expect((await replyField(pane, 'i1'))?.props.value).toBe('Deno, actually')
  expect(w.sent).toEqual([])
})

test('a reply field that opens without the keys says to click it, until it has them', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: false }

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

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: false } })
  await pane.press({ key: 'typekey-i1' })
  await clock.settle()
  expect(await replyField(pane, 'i1')).toBeDefined()
  expect(await pane.find({ text: 'Click the field to type' })).toBeDefined()

  await pane.redraw({ ...PANE.props, isFocused: true })
  await clock.settle()
  expect(await replyField(pane, 'i1')).toBeDefined()
  expect(await pane.find({ text: 'Click the field to type' })).toBeUndefined()
})

test('a press on a question Claude closed since the draw sends nothing and says so', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('ui.focus', () => ({}))

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
  const close = (id: string) => () => $.tool.call({ tool: 'mcp__inbox__close', id, reason: 'settled in chat' } as never)
  const pane = await $.ui.mount(PANE)
  const stale = /^This changed before your press\. Nothing was sent\.$/

  w.beforeAct = close('i1')
  await pane.press({ key: 'answer-i1-0' })
  expect(w.sent).toEqual([])
  expect(await pane.find({ text: stale })).toBeDefined()
  await clock.advance(9000)
  expect(await pane.find({ text: stale })).toBeUndefined()
})
