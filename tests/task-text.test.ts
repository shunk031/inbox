import { expect, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/ledger'
import { inboxText, promptNotes, statusCarryText } from '../hooks/inbox-text'
import { statusPage } from '../hooks/status-page'
import { statusPrompt } from '../hooks/status-prompt'
import { currentTaskText } from '../hooks/task-text'
import { taskReportRows } from '../hooks/task-report'
import { EMPTY_SESSION_STATUS } from '../hooks/status-limits'
import { timelineData, timelinePage } from '../hooks/timeline-page'
import { emptySession } from '../hooks/session-files'
import type { TaskNode, TaskPrCiState, TaskPrState, TaskProgressSegments } from '../types'
import { CLAUDE_CODE } from '../hooks/model-text'

const task = (change: Partial<TaskNode> = {}): TaskNode => ({
  id: 't1',
  parentId: null,
  status: 'working',
  weight: 1,
  title: 'Implement the cache',
  detail: 'The original plan',
  notes: ['The latest note'],
  createdAt: 1_000,
  updatedAt: 2_000,
  history: [
    { at: 1_000, source: 'agent', kind: 'created' },
    { at: 2_000, source: 'agent', kind: 'note', detail: 'The latest note' },
    { at: 1_500, source: 'agent', kind: 'detail' },
  ],
  ...change,
})

const segments: TaskProgressSegments = { total: 1, done: 0, working: 1, stalled: 0, waiting: 0, queued: 0 }

const textFacts = (
  tree: TaskNode[],
  queue = '',
  now = 10_000,
  taskPrStates: Record<string, TaskPrState> = {},
  taskPrCiStates: Record<string, TaskPrCiState> = {},
) => ({ taskRows: taskReportRows(tree, queue, { taskPrStates, taskPrCiStates }, now) })

test('Status rows and Timeline details use the newer note while retaining the full task history', () => {
  const current = task()
  const session = emptySession()
  const status = statusPage({ ledger: session.ledger, taskTree: [current], presence: session.presence }, 2_000)
  const row = status.rows.find(candidate => candidate.kind === 'subject')
  const timeline = timelinePage(timelineData([current], segments, {}, [], 2_000), 't1', [])

  expect(row?.kind === 'subject' ? row.text : '').toContain('The latest note')
  expect(row?.kind === 'subject' ? row.text : '').not.toContain('The original plan')
  expect(timeline.selected?.details.map(line => line.label)).toEqual(['Detail', 'Note', 'History'])
  expect(timeline.selected?.details).toContainEqual({ label: 'Detail', text: 'The original plan' })
  expect(timeline.selected?.details).toContainEqual({ label: 'Note', text: 'The latest note' })
  const history = timeline.selected?.details.find(line => line.label === 'History')
  if (history?.label === 'History') expect(history.text).toMatch(/Task detail updated[\s\S]*Note added/u)
})

test('current task text uses newer detail when its recorded change time follows the latest note', () => {
  const current = task({
    detail: 'The verified plan',
    updatedAt: 3_000,
    history: [
      { at: 1_000, source: 'agent', kind: 'created' },
      { at: 2_000, source: 'agent', kind: 'note', detail: 'The latest note' },
      { at: 3_000, source: 'agent', kind: 'detail' },
    ],
  })
  const status = statusPage({ ledger: EMPTY, taskTree: [current], presence: emptySession().presence }, 3_000)

  expect(status.rows.find(row => row.kind === 'subject')).toMatchObject({
    text: '0% complete · The verified plan',
  })
})

test('legacy task text stays on its note after an untyped status update', () => {
  const legacy = task({
    status: 'done',
    updatedAt: 3_000,
    history: [
      { at: 1_000, source: 'agent', kind: 'created' },
      { at: 2_000, source: 'agent', kind: 'note', detail: 'The latest note' },
      { at: 3_000, source: 'agent', kind: 'updated' },
    ],
  })

  expect(currentTaskText(legacy)).toEqual({ text: 'The latest note', at: 2_000 })
})

test('legacy task text cannot tell whether an untyped update edited detail, so it stays on the note', () => {
  const legacy = task({
    detail: 'The possibly newer plan',
    updatedAt: 3_000,
    history: [
      { at: 1_000, source: 'agent', kind: 'created' },
      { at: 2_000, source: 'agent', kind: 'note', detail: 'The latest note' },
      { at: 3_000, source: 'agent', kind: 'updated' },
    ],
  })

  expect(currentTaskText(legacy)).toEqual({ text: 'The latest note', at: 2_000 })
})

test('prompt task rows use the owner report and its age instead of hand-written task text', () => {
  const current = task({ links: { owner: { agent: 'worker', machine: 'local' } } })
  const reportQueue = JSON.stringify({
    from: 'worker',
    machine: 'local',
    seq: 1,
    t: 3,
    text: 'STATUS Cache is implemented',
  })
  const facts = textFacts([current], reportQueue, 123_000)
  const inbox = inboxText(CLAUDE_CODE, EMPTY, true, [current], [], facts)
  const carry = statusCarryText(EMPTY, [current], facts)
  const prompt = statusPrompt(
    { last: null, asks: [], taskTree: [current], now: 2_500 },
    {
      turn: 1,
      person: 'Continue',
      trigger: null,
      activity: [],
      reply: 'The fix is ready.',
      press: null,
      screen: '',
      tasks: [],
    },
  )

  expect(inbox).toContain("Open tasks with each owner's latest report and linked PR.")
  expect(inbox).not.toContain('Keep it current with `tasks`')
  expect(inbox).toContain('- t1 | working | Implement the cache | STATUS Cache is implemented · 2m')
  expect(inbox).not.toContain('Where it stands:')
  expect(inbox).not.toContain('The latest note')
  expect(inbox).not.toContain('The original plan')
  expect(carry).toContain('Where it stands:\n- t1 | working | Implement the cache | STATUS Cache is implemented · 2m')
  expect(prompt).toContain('Implement the cache | The latest note (just now)')
  expect(prompt).toContain('note | just now | The latest note')
  expect(prompt).not.toContain('The original plan')

  const olderPrompt = statusPrompt(
    { last: null, asks: [], taskTree: [current], now: 62_000 },
    {
      turn: 1,
      person: 'Continue',
      trigger: null,
      activity: [],
      reply: 'The fix is ready.',
      press: null,
      screen: '',
      tasks: [],
    },
  )
  expect(olderPrompt).toContain('Implement the cache | The latest note (1m ago)')
})

test('a newer DONE report replaces STATUS and derives the task row status', () => {
  const current = task({ links: { owner: { agent: 'worker', machine: 'local' } } })
  const reportQueue = [
    { from: 'worker', machine: 'local', seq: 1, t: 3, text: 'STATUS Still implementing' },
    { from: 'worker', machine: 'local', seq: 2, t: 4, text: 'DONE Cache is implemented' },
  ]
    .map(row => JSON.stringify(row))
    .join('\n')
  const inbox = inboxText(CLAUDE_CODE, EMPTY, true, [current], [], textFacts([current], reportQueue, 124_000))

  expect(inbox).toContain('- t1 | done | Implement the cache | DONE Cache is implemented · 2m')
  expect(inbox).not.toContain('Still implementing')
})

test('an owner with no current report is named plainly', () => {
  const current = task({ links: { owner: { agent: 'worker', machine: 'local' } } })
  const inbox = inboxText(CLAUDE_CODE, EMPTY, true, [current], [], textFacts([current]))

  expect(inbox).toContain('- t1 | working | Implement the cache | No report yet')
})

test('a task without an owner or PR shows only its id, status and title', () => {
  const current = task()
  const inbox = inboxText(CLAUDE_CODE, EMPTY, true, [current], [], textFacts([current]))
  const row = inbox.split('\n').find(line => line.startsWith('- t1 |'))

  expect(row).toBe('- t1 | working | Implement the cache')
})

test('linked merged and open PRs show their state and CI result', () => {
  const tree = [
    task({ id: 'merged', title: 'Merged task', links: { pr: 'https://github.com/acme/cache/pull/1' } }),
    task({ id: 'open', title: 'Open task', links: { pr: 'https://github.com/acme/cache/pull/2' } }),
  ]
  const inbox = inboxText(
    CLAUDE_CODE,
    EMPTY,
    true,
    tree,
    [],
    textFacts(
      tree,
      '',
      10_000,
      {
        'https://github.com/acme/cache/pull/1': 'MERGED',
        'https://github.com/acme/cache/pull/2': 'OPEN',
      },
      {
        'https://github.com/acme/cache/pull/1': 'passing',
        'https://github.com/acme/cache/pull/2': 'failing',
      },
    ),
  )

  expect(inbox).toContain('- merged | working | Merged task | No report yet · PR merged · CI passing')
  expect(inbox).toContain('- open | working | Open task | No report yet · PR open · CI failing')
})

test('Status task facts include an open child task id and its current status', () => {
  const parent = task()
  const child = task({ id: 't1-child', parentId: parent.id, status: 'queued', title: 'Check parser behavior' })
  const prompt = statusPrompt(
    { last: null, asks: [], taskTree: [parent, child], now: 2_500 },
    {
      turn: 1,
      person: 'Continue',
      trigger: null,
      activity: [],
      reply: 'The parser check is complete.',
      press: null,
      screen: '',
      tasks: [],
    },
  )

  expect(prompt).toContain('Open task statuses ([id, status] pairs):\n[["t1","working"],["t1-child","queued"]]')
})

test('Status task facts keep child ids and statuses ahead of clipped details within the existing cap', () => {
  const roots = Array.from({ length: 6 }, (_, index) =>
    task({
      id: `root-${index}`,
      detail: 'Current task detail. '.repeat(80),
      notes: [],
      createdAt: 1_000,
      history: [{ at: 2_000, source: 'agent', kind: 'detail' }],
    }),
  )
  const child = task({ id: 'last-child', parentId: 'root-0', status: 'queued' })
  const closed = [task({ id: 'closed-done', status: 'done' }), task({ id: 'closed-dropped', status: 'dropped' })]
  const prompt = statusPrompt(
    { last: null, asks: [], taskTree: [...roots, child, ...closed], now: 2_500 },
    {
      turn: 1,
      person: 'Continue',
      trigger: null,
      activity: [],
      reply: 'The child is still queued.',
      press: null,
      screen: '',
      tasks: [],
    },
  )
  const taskTree = /<task tree>\n([\s\S]*?)\n<\/task tree>/.exec(prompt)?.[1] ?? ''

  expect(taskTree).toContain('["last-child","queued"]')
  expect(taskTree.length).toBeLessThanOrEqual(8000)
  expect(taskTree).not.toContain('Current task detail.')
  expect(taskTree).not.toContain('closed-done')
  expect(taskTree).not.toContain('closed-dropped')
})

test('an open task near the middle of 200 long ids stays in the uncut status block', () => {
  const ids = Array.from({ length: 200 }, (_, index) => `task-${String(index).padStart(3, '0')}-${'x'.repeat(90)}`)
  const childId = ids[100]!
  const tree = ids.map((id, index) =>
    task({
      id,
      parentId: index === 0 ? null : ids[0]!,
      status: index === 100 ? 'queued' : 'working',
      detail: 'Long task detail. '.repeat(100),
      notes: [],
      history: [{ at: 2_000, source: 'agent', kind: 'detail' }],
    }),
  )
  const prompt = statusPrompt(
    { last: null, asks: [], taskTree: tree, now: 2_500 },
    {
      turn: 1,
      person: 'Continue',
      trigger: null,
      activity: [],
      reply: 'The child is still queued.',
      press: null,
      screen: '',
      tasks: [],
    },
  )
  const taskTree = /<task tree>\n([\s\S]*?)\n<\/task tree>/.exec(prompt)?.[1] ?? ''

  expect(taskTree.length).toBeGreaterThan(8000)
  expect(taskTree).toContain(JSON.stringify([childId, 'queued']))
  expect(taskTree).toContain(JSON.stringify([ids[199], 'working']))
})

test('a new turn does not change an unchanged task snapshot', () => {
  const tree = [task()]
  const first = promptNotes(
    CLAUDE_CODE,
    { ...EMPTY, turn: 1 },
    { text: 'Continue.', isPress: false, isOpen: true },
    { inbox: null, closed: [] },
    tree,
  )
  const note = first.notes.find(text => text.startsWith('inbox:')) ?? ''
  expect(note).toContain("Open tasks with each owner's latest report and linked PR.")
  expect(note).toContain('- t1 | working | Implement the cache')
  expect(first.told.inbox).toBe(note)

  const next = promptNotes(
    CLAUDE_CODE,
    { ...EMPTY, turn: 2 },
    { text: 'Continue again.', isPress: false, isOpen: true },
    first.told,
    tree,
  )
  expect(next.notes.some(text => text.startsWith('inbox:'))).toBe(false)
  expect(next.told.inbox).toBe(note)
  expect(tree[0]?.status).toBe('working')
})

test('task snapshots omit closed tasks, cap rows and row length, and report omissions', () => {
  const tree = Array.from({ length: 14 }, (_, index) =>
    task({
      id: `task-${index}`,
      title: `タスク ${index} ${'日本語 '.repeat(20)}`,
      detail: '最新の詳細 '.repeat(12),
      notes: [],
      status: index === 13 ? 'done' : 'queued',
      history: [],
    }),
  )
  const inbox = inboxText(CLAUDE_CODE, { ...EMPTY, turn: 7 }, true, tree)
  const legacyInbox = inboxText(
    CLAUDE_CODE,
    {
      ...EMPTY,
      overview: {
        ...EMPTY_SESSION_STATUS,
        subjects: [
          {
            id: 'old-task',
            name: 'Old task group',
            status: 'working',
            text: 'Legacy task summary',
            was: null,
            merged: null,
            createdAt: 1,
            changedAt: 1,
            closedAt: null,
            into: null,
          },
        ],
      },
      turn: 7,
    },
    true,
    tree,
  )
  const lines = inbox.split('\n')
  const start = lines.findIndex(line => line.startsWith('Open tasks with each owner'))
  const rows = lines.slice(start + 1, start + 13)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(rows).toHaveLength(12)
  expect(rows[0]).toContain('task-0')
  expect(rows.at(-1)).toContain('task-11')
  expect(lines).toContain('- 1 more open task omitted.')
  expect(inbox).not.toContain('task-12')
  expect(inbox).not.toContain('task-13')
  expect(lines.filter(line => line.startsWith('- task-'))).toHaveLength(12)
  expect(legacyInbox).not.toContain('Where it stands:')
  expect(legacyInbox).not.toContain('Legacy task summary')
})

test('an empty task tree adds no snapshot text', () => {
  expect(inboxText(CLAUDE_CODE, { ...EMPTY, turn: 3 }, true, [])).not.toContain('Open tasks with each owner')
})
