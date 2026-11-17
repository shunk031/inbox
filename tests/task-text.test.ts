import { expect, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/ledger'
import { inboxText, statusCarryText } from '../hooks/inbox-text'
import { statusPage } from '../hooks/status-page'
import { statusPrompt } from '../hooks/status-prompt'
import { currentTaskText } from '../hooks/task-text'
import { timelineData, timelinePage } from '../hooks/timeline-page'
import { emptySession } from '../hooks/session-files'
import type { TaskNode, TaskProgressSegments } from '../types'
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
  ],
  ...change,
})

const segments: TaskProgressSegments = { total: 1, done: 0, working: 1, stalled: 0, waiting: 0, queued: 0 }

test('Status rows, Timeline rows and selected details use the newer note while retaining the full task history', () => {
  const current = task()
  const session = emptySession()
  const status = statusPage({ ledger: session.ledger, taskTree: [current], presence: session.presence }, 2_000)
  const row = status.rows.find(candidate => candidate.kind === 'subject')
  const timeline = timelinePage(timelineData([current], segments, {}, [], 2_000), 't1', [])

  expect(row?.kind === 'subject' ? row.text : '').toContain('The latest note')
  expect(row?.kind === 'subject' ? row.text : '').not.toContain('The original plan')
  expect(timeline.rows[0]?.measure).toContain('The latest note')
  expect(timeline.selected?.details).toContainEqual({ label: 'Current', text: 'The latest note · now' })
  expect(timeline.selected?.details).toContainEqual({ label: 'Detail', text: 'The original plan' })
  expect(timeline.selected?.details).toContainEqual({ label: 'Note', text: 'The latest note' })
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

test('legacy task detail uses its latest updated event when it follows a note', () => {
  const legacy = task({
    detail: 'The verified plan',
    updatedAt: 3_000,
    history: [
      { at: 1_000, source: 'agent', kind: 'created' },
      { at: 2_000, source: 'agent', kind: 'note', detail: 'The latest note' },
      { at: 3_000, source: 'agent', kind: 'updated' },
    ],
  })

  expect(currentTaskText(legacy)).toEqual({ text: 'The verified plan', at: 3_000 })
})

test('prompt inbox and Status carry text use the current task note, and the Status prompt gives its time', () => {
  const current = task()
  const inbox = inboxText(CLAUDE_CODE, EMPTY, true, [current])
  const carry = statusCarryText(EMPTY, [current])
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

  expect(inbox).toContain('Where it stands:\n- Implement the cache: The latest note (working)')
  expect(inbox).not.toContain('The original plan')
  expect(carry).toContain('Where it stands:\n- Implement the cache: The latest note (working)')
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
