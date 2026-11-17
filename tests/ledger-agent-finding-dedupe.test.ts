import { expect, test } from 'claude-code/testing'

import { CLAUDE_CODE } from '../hooks/model-text'
import { EMPTY } from '../hooks/ledger'
import { closeFinding } from '../hooks/ledger-close'
import { recordItem, RETIRED_FINDING_ANSWER } from '../hooks/tools'
import { TOOL_FIELDS } from '../hooks/tool-schemas'
import { addLegacyFinding } from './seed-findings'

test('an attempted finding record does not reopen a dismissed legacy finding', () => {
  const finding = {
    kind: 'issue' as const,
    title: 'The old branch is still documented',
    detail: 'The docs link to a branch that has been removed.',
    path: null,
    at: 1000,
  }
  const oldLedger = addLegacyFinding(EMPTY, finding).ledger
  const dismissed = closeFinding(oldLedger, 'f1', { how: 'dismissed', outcome: 'dismissed' }, 1100)
  const repeated = recordItem(CLAUDE_CODE, dismissed, { ...finding, kind: 'finding' }, 1200, TOOL_FIELDS)

  expect(repeated.result).toBe(RETIRED_FINDING_ANSWER)
  expect(repeated.ledger).toBe(dismissed)
})

test('an attempted finding record that matches an open ask leaves it unchanged', () => {
  const open = recordItem(
    CLAUDE_CODE,
    EMPTY,
    { kind: 'question', ask: 'Which release branch should we use?', options: ['stable', 'next'] },
    1000,
    TOOL_FIELDS,
  )
  const attemptedFinding = recordItem(
    CLAUDE_CODE,
    open.ledger,
    {
      kind: 'finding',
      finding_kind: 'issue',
      title: 'Which release branch should we use?',
      detail: 'The release branch choice is still open.',
    },
    1200,
    TOOL_FIELDS,
  )

  expect(attemptedFinding.result).toBe(RETIRED_FINDING_ANSWER)
  expect(attemptedFinding.ledger).toBe(open.ledger)
})
