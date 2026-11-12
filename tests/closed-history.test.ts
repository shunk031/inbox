import { expect, test } from 'claude-code/testing'

import { closedHistoryPlan } from '../hooks/rows'
import { EMPTY } from '../hooks/ledger'
import { addFinding } from '../hooks/ledger-update'
import { emptySession } from '../hooks/session-files'
import { sessionView } from '../hooks/session-view'
import { NO_HOLDS } from '../hooks/timing'

test('the shared closed plan shows three rows and counts older records after more than 12 closes', () => {
  const records = Array.from({ length: 14 }, (_, n) => ({ id: `i${n + 1}` }))
  const history = closedHistoryPlan(records, new Set())

  expect(history).toEqual({ rows: records.slice(0, 3), total: 14, earlier: '11 earlier' })
})

test('a finding closed as list full appears in the Finds history plan', () => {
  const finding = { kind: 'issue' as const, title: '', detail: 'detail', path: null, at: 1 }
  const full = Array.from({ length: 31 }, (_, n) => n).reduce(
    (ledger, n) => addFinding(ledger, { ...finding, title: `Problem ${n + 1}`, at: n + 1 }).ledger,
    EMPTY,
  )
  const view = sessionView({ ...emptySession(), ledger: full }, 100, 1000, true, NO_HOLDS)
  const history = closedHistoryPlan(view.findings.closed, new Set())

  expect(history.rows.map(f => [f.title, f.outcome])).toContainEqual(['Problem 1', 'list full'])
})
