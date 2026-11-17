import { expect, test } from 'claude-code/testing'

import { EMPTY, upgradeLedger } from '../hooks/ledger'
import { guidanceText, CLAUDE_CODE } from '../hooks/model-text'
import { systemText } from '../hooks/ledger-prompt'
import { inboxView, perTurnStatus } from '../hooks/view'
import { shownTabs, isShownTab } from '../hooks/tabs'
import { upgradeSession } from '../hooks/session-files'
import { RETIRED_FINDING_ANSWER, recordItem, toolAnswer } from '../hooks/tools'
import { RECORD_SCHEMA, TOOL_FIELDS } from '../hooks/tool-schemas'
import { recordDescription } from '../hooks/tool-descriptions'
import type { Finding } from '../types'

const oldFindings: Finding[] = [
  { id: 'f1', kind: 'issue', title: 'Old issue', detail: 'Still matters.', path: null, at: 10 },
  { id: 'f2', kind: 'opportunity', title: 'Old opportunity', detail: 'Worth keeping.', path: null, at: 20 },
]

test('record rejects a retired finding with the actionable answer and does not change saved findings', () => {
  const ledger = { ...EMPTY, findings: oldFindings }
  const answer = toolAnswer(
    CLAUDE_CODE,
    ledger,
    'record',
    { kind: 'finding' },
    30,
    {
      lastActions: {},
      turnStartedAt: null,
    },
    TOOL_FIELDS,
  )

  expect(answer.result).toBe(RETIRED_FINDING_ANSWER)
  expect(answer.ledger).toBe(ledger)
  expect(recordItem(CLAUDE_CODE, ledger, { kind: 'finding' }, 30).result).toBe(RETIRED_FINDING_ANSWER)
})

test('the Asks view exposes old issue and opportunity rows with only Discuss and Close actions', () => {
  const view = inboxView({
    ledger: { ...EMPTY, findings: oldFindings },
    lastActions: {},
    notes: {},
    turns: { turnsStarted: 0, turnsApplied: 0 },
    extraSteps: {},
    settleWindowMs: 9_000,
    status: perTurnStatus(false, 'none'),
    now: 30,
    replies: {},
    discarded: {},
    shownSince: null,
    lastTypedMessageAt: null,
    listInput: null,
  })

  expect(view.needsYou.legacyFindings.map(r => r.id)).toEqual(['f1', 'f2'])
  expect(view.needsYou.count).toBe(2)
  expect(view.needsYou.legacyFindings[0]?.actions.map(a => a.label)).toEqual(['Discuss', 'Close'])
})

test('saved issue and opportunity findings, including closed history, survive ledger and session upgrades', () => {
  const saved = {
    ...EMPTY,
    findings: oldFindings,
    closedFindings: [{ ...oldFindings[0]!, how: 'dismissed' as const, outcome: 'dismissed', closedAt: 25 }],
  }

  expect(upgradeLedger(saved).findings).toEqual(oldFindings)
  expect(upgradeSession({ ledger: saved } as never).ledger).toMatchObject({
    findings: oldFindings,
    closedFindings: saved.closedFindings,
  })
})

test('Finds is absent from the tab list and model text contains no instruction to create findings', () => {
  expect(shownTabs(false).map(t => t.id)).toEqual(['needsYou', 'prs'])
  expect(isShownTab('findings')).toBe(false)
  expect(RECORD_SCHEMA.properties.kind.enum).toEqual(['question', 'task'])
  expect(recordDescription(CLAUDE_CODE)).not.toMatch(/record.{0,20}finding/i)
  expect(guidanceText(CLAUDE_CODE)).not.toMatch(/record.{0,30}finding/i)
  expect(systemText(CLAUDE_CODE)).toContain('Never create new findings.')
  expect(systemText(CLAUDE_CODE)).not.toContain('FND:')
})
