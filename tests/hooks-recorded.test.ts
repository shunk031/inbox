import { expect, mock, test } from 'claude-code/testing'
import { w, world } from './hooks-world'
import { PANE, SAVED_SESSION } from './hooks-helpers'
import { TOOL_FIELDS } from '../hooks/tool-schemas'
import { PRESS_GUARD_MS } from '../hooks/timing'

test('the guidance reaches Claude in the close tool’s description and nowhere else, and every inbox tool loads with the session', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('tool.describe', (_$, e) => ({ description: e.description }))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  const provider = { plugin: 'inbox', tier: 'user' } as const
  const close = await $.tool.describe({ tool: 'mcp__inbox__close', description: 'Close an item.', provider })
  const record = await $.tool.describe({ tool: 'mcp__inbox__record', description: 'Record an item.', provider })
  expect(close.description).toContain('Close an item.')
  expect(close.description).toContain('# Inbox')
  expect(close.description).toContain(
    'Write the text of questions and tasks in the language the person writes to you in.',
  )
  expect(record.description).toBe('Record an item.')
  const order = await $.tool.describe({ tool: 'mcp__inbox__order_prs', description: 'Order PRs.', provider })
  const tasks = await $.tool.describe({ tool: 'mcp__inbox__tasks', description: 'Maintain tasks.', provider })
  expect([close, record, order, tasks].map(d => d.isDeferred)).toEqual([false, false, false, false])
  expect(tasks.description).toContain('when you make a plan')
  expect(tasks.description).toContain('finished or stalled work can be noticed')
  for (const field of ['pr', 'issue', 'owner_agent', 'owner_machine']) expect(TOOL_FIELDS.tasks).toContain(field)
})

test('Claude saves the task-tree tool change through its session store and returns the normalized node', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

  const result = await $.tool.call({
    tool: 'mcp__inbox__tasks',
    operation: 'add',
    task_id: 't1',
    title: 'Implement task tool',
    pr: 'https://github.com/acme/app/pull/12',
    issue: 'https://github.com/acme/app/issues/34',
    owner_agent: 'worker-1',
    owner_machine: 'local',
  } as never)
  const saved = JSON.parse(w.stored.get('s:session-1') ?? '{}')

  expect(result.result).toContain('Task saved: {"id":"t1"')
  expect(saved.taskTree[0]).toMatchObject({
    id: 't1',
    status: 'queued',
    title: 'Implement task tool',
    links: {
      pr: 'https://github.com/acme/app/pull/12',
      issue: 'https://github.com/acme/app/issues/34',
      owner: { agent: 'worker-1', machine: 'local' },
    },
  })
  expect(saved.taskTree[0].history[0]).toMatchObject({ source: 'agent', kind: 'created' })
})

test("Claude is asked for a question's context, notes and reason in a new conversation and after it resumes, and not in a conversation an earlier build saved", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  let turns = 0
  on('session.turns', () => ({ value: turns }))
  w.stored.set('s:session-2', JSON.stringify(SAVED_SESSION))
  const recordAsk = async (ask: string) =>
    (
      await $.tool.call({
        tool: 'mcp__inbox__record',
        kind: 'question',
        ask,
        options: ['Redis', 'Memcached'],
        rec: 'Redis',
      })
    ).result
  const recorded = 'Recorded. The user sees it in the /inbox pane.'
  const fullAsk = `${recorded} It has no context or option_notes: record it again with context (why it came up) and option_notes (what picking each option does). It has no why: record it again with why, so the user sees your reason.`

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  expect(await recordAsk('Which cache should the API use?')).toBe(fullAsk)
  await clock.settle()
  turns = 3
  await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })
  expect(await recordAsk('Which queue should jobs use?')).toBe(recorded)
  await clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-1' })
  expect(await recordAsk('Which log store should we use?')).toBe(fullAsk)
})

test("a conversation /resume opens with no saved inbox state is asked only for what 0.3.0's record takes, one /clear begins is asked for everything while the turn count still names the last conversation, and a fork asks as its parent's saved record says", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  on('session.turns', () => ({ value: 3 }))
  const recordAsk = async (ask: string) =>
    (
      await $.tool.call({
        tool: 'mcp__inbox__record',
        kind: 'question',
        ask,
        options: ['Redis', 'Memcached'],
        rec: 'Redis',
      })
    ).result
  const recorded = 'Recorded. The user sees it in the /inbox pane.'
  const fullAsk = `${recorded} It has no context or option_notes: record it again with context (why it came up) and option_notes (what picking each option does). It has no why: record it again with why, so the user sees your reason.`

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
  expect(await recordAsk('Which cache should the API use?')).toBe(fullAsk)
  await clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'session-2', resume: { id: 'session-2' } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-3' })
  expect(await recordAsk('Which queue should jobs use?')).toBe(recorded)
  await clock.settle()
  w.stored.set('s:session-3', JSON.stringify({ ...SAVED_SESSION, toolFields: TOOL_FIELDS }))
  await $.session.end({ reason: 'resume', sessionId: 'session-3', resume: { id: 'session-3' } })
  await $.classic.SessionStart({ source: 'fork', session_id: 'session-4' })
  expect(await recordAsk('Which log store should we use?')).toBe(fullAsk)
})

test('a retired finding is refused, while an old finding stays in the collapsed Asks section until closed', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: true }
  w.stored.set(
    's:session-1',
    JSON.stringify({
      ...SAVED_SESSION,
      ledger: {
        ...SAVED_SESSION.ledger,
        findings: [
          {
            id: 'f1',
            kind: 'issue',
            title: 'Retry loop never backs off',
            detail: 'The fetch retry spins with no delay and can hammer the API.',
            path: 'src/api.ts',
            at: 1_000_000,
          },
        ],
        nextId: 2,
      },
    }),
  )

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inbox', args: '' } as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-needsYou' })
  await clock.settle()
  if (!(await pane.find({ key: 'fold-legacy' }))) throw new Error('Legacy fold is missing from Asks.')
  if (await pane.find({ text: /Retry loop never backs off/ })) {
    await pane.press({ key: 'fold-legacy' })
    await clock.settle()
  }
  expect(await pane.find({ text: /Retry loop never backs off/ })).toBeUndefined()
  const r = await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'finding',
    finding_kind: 'issue',
    title: 'Retry loop never backs off',
    detail: 'The fetch retry spins with no delay and can hammer the API.',
    path: 'src/api.ts',
  })
  expect(r.result).toBe(
    'Not recorded: findings are retired. Add it as a task with `tasks` if it is work to track, or record a question or task if the person must decide or act.',
  )
  await clock.settle()
  expect(JSON.parse(w.stored.get('s:session-1') ?? '{}').ledger.findings).toHaveLength(1)
  if (!(await pane.find({ text: /Retry loop never backs off/ }))) {
    await pane.press({ key: 'fold-legacy' })
    await clock.settle()
  }
  await pane.press({ key: 'title-f1' })
  await clock.advance(PRESS_GUARD_MS)
  expect(await pane.find({ text: /Retry loop never backs off/ })).toBeDefined()
  for (const key of ['discuss-f1', 'drop-f1'])
    if (!(await pane.find({ key }))) throw new Error(`Legacy action is missing: ${key}`)
  await pane.press({ key: 'drop-f1' })
  await clock.settle()
  expect(await pane.find({ key: 'settled-f1' })).toBeDefined()
  expect(JSON.parse(w.stored.get('s:session-1') ?? '{}').ledger.closedFindings).toMatchObject([
    { id: 'f1', how: 'dismissed', outcome: 'dismissed' },
  ])
})

test('a recorded report is read through its resolved path and the inbox stores its short excerpt', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: true }
  w.documentFile = {
    path: '/reports/current.md',
    realPath: '/archive/current.md',
    text: '# Release plan\n\nShip to one region first.',
  }
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inbox', args: '' } as never)
  const pane = await $.ui.mount(PANE)

  const result = await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'question',
    ask: 'Which rollout should we use?',
    options: ['One region', 'All regions'],
    document: '/reports/current.md',
  })
  const saved = JSON.parse(w.stored.get('s:session-1') ?? '{}')
  await clock.settle()

  expect(result.result).toStartWith('Recorded. The user sees it in the /inbox pane.')
  expect(saved.ledger.items[0]).toMatchObject({
    document: '/reports/current.md',
    documentPreview: '# Release plan Ship to one region first.',
  })
  expect(await pane.find({ text: /Report preview: # Release plan/ })).toBeDefined()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.settle()
  expect(await desktop.find({ text: /Report preview: # Release plan/ })).toBeDefined()
})

test('a question Claude records waits in the pane with its recommendation, a repeat is not added, one the person dismissed is not recorded again, and one they answered with List the choices can be asked again with choices', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: true }

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inbox', args: '' } as never)
  const pane = await $.ui.mount(PANE)
  const question = {
    tool: 'mcp__inbox__record',
    kind: 'question',
    ask: 'Which cache should the API use?',
    context: 'The price lookups are slow, and a cache is the next step',
    options: ['Redis', 'In-memory'],
    option_notes: ['Adds a Redis server to each stack', 'Keeps prices in each process'],
    rec: 'Redis',
    why: 'it survives restarts',
  } as const
  const r = await $.tool.call(question)
  expect(r.result).toStartWith('Recorded. The user sees it in the /inbox pane.')
  await clock.settle()
  expect(await pane.find({ text: /Which cache should the API use\?/ })).toBeDefined()
  expect((await $.tool.call({ ...question, ask: 'Which cache should the API use?' })).result).toBe(
    'Already open as i1 with the same text; nothing changed.',
  )
  expect((await $.tool.call({ ...question, ask: 'Which cache should it use?', rec: 'Memcached' })).result).toBe(
    'Not recorded: rec must be one of the options.',
  )

  const task = await $.tool.call({
    tool: 'mcp__inbox__record',
    kind: 'task',
    ask: 'Sign in to the registry',
    steps: ['npm login', 'Then tell me when it is done.'],
  })
  expect(task.result).toBe(
    'Recorded. The user sees it in the /inbox pane. Some steps were not a command, a file path or a link, so they are left out.',
  )
  expect(
    (
      await $.tool.call({
        tool: 'mcp__inbox__record',
        kind: 'task',
        ask: 'Sign in to the registry',
        steps: ['npm login', 'Then tell me when it is done.'],
      })
    ).result,
  ).toBe(
    'Already open as i2 with the same text; nothing changed. Some steps were not a command, a file path or a link, so they are left out.',
  )

  await $.tool.call({ tool: 'mcp__inbox__close', id: 'i1', answer: 'Redis' })
  expect((await $.tool.call(question)).result).toBe(
    'Not recorded: it matches closed item i1 (the user answered it (Redis)); nothing changed. Ask again only if the user brings it up.',
  )

  const placement = { tool: 'mcp__inbox__record', kind: 'question', ask: 'Where should the job run?' } as const
  await $.tool.call({ ...placement, options: ['List the choices'] })
  await $.tool.call({ tool: 'mcp__inbox__close', id: 'i3', answer: 'List the choices' })
  expect(
    (
      await $.tool.call({
        ...placement,
        context: 'The cleanup job needs a schedule before it ships',
        options: ['Nightly', 'Hourly'],
        option_notes: ['Runs once at 2 a.m.', 'Runs at the top of each hour'],
        rec: 'Nightly',
        why: 'traffic is low at night',
      })
    ).result,
  ).toBe('Recorded. The user sees it in the /inbox pane.')
})

test("the result under a record or close call reads the person's line, nothing when the call changed nothing, and the agent's text in the ctrl+o transcript", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', { component: 'ToolResult' }, ($, e) => $.ui.resolve(e).Text({ children: [String(e.props.output)] }))
  world($, on, [])

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  const question = {
    tool: 'mcp__inbox__record',
    kind: 'question',
    ask: 'Which cache should the API use?',
    options: ['Redis', 'In-memory'],
  } as const
  const calls = [
    { use: 'u1', call: question },
    { use: 'u2', call: question },
    { use: 'u3', call: { tool: 'mcp__inbox__close', id: 'i1', answer: 'Redis' } },
  ] as const
  const results: unknown[] = []
  for (const { use, call } of calls) results.push((await $.tool.call({ ...call, tool_use_id: use } as never)).result)
  const resultRow = (i: number, isExpanded = false) =>
    $.ui.mount({
      plugin: 'inbox',
      surface: 'terminal',
      component: 'ToolResult',
      props: {
        tool_use_id: calls[i]!.use,
        tool: calls[i]!.call.tool,
        output: results[i],
        isErrored: false,
        isExpanded,
      },
    } as never)

  expect(await (await resultRow(0)).find({ text: 'Question: Which cache should the API use?' })).toBeDefined()
  expect(await (await resultRow(1)).find({ text: /./ })).toBeUndefined()
  expect(await (await resultRow(2)).find({ text: 'Closed: Which cache should the API use?' })).toBeDefined()
  expect(
    await (await resultRow(0, true)).find({ text: 'Recorded. The user sees it in the /inbox pane.' }),
  ).toBeDefined()
})

test('questions that arrive one by one keep the first one open', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  world($, on, [])
  w.paneState = { isShown: true, isFocused: true }

  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inbox', args: '' } as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-needsYou' })
  await clock.settle()
  for (const ask of ['Should retries back off?', 'Should we cache the token?', 'Should we add a lint script?']) {
    await $.tool.call({
      tool: 'mcp__inbox__record',
      kind: 'question',
      ask,
      options: ['Yes', 'Not now'],
    })
    await clock.settle()
  }
  expect(await pane.find({ key: 'answer-i1-0' })).toBeDefined()
  expect(await pane.find({ key: 'row-i3' })).toBeDefined()
  await pane.press({ key: 'title-i3' })
  await clock.settle()
  expect(await pane.find({ key: 'answer-i3-0' })).toBeDefined()
  expect(await pane.find({ key: 'address-i1' })).toBeUndefined()
})
