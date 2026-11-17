import { expect, test } from 'claude-code/testing'

import { CLAUDE_CODE } from '../hooks/model-text'
import { EMPTY } from '../hooks/ledger'
import { closeFinding } from '../hooks/ledger-close'
import { recordItem } from '../hooks/tools'
import { TOOL_FIELDS } from '../hooks/tool-schemas'

test('a finding matching a dismissed finding names the closed id and says it changed nothing', () => {
  const finding = {
    kind: 'finding',
    finding_kind: 'issue',
    title: 'The old branch is still documented',
    detail: 'The docs link to a branch that has been removed.',
  }
  const first = recordItem(CLAUDE_CODE, EMPTY, finding, 1000, TOOL_FIELDS)
  const dismissed = closeFinding(first.ledger, 'f1', { how: 'dismissed', outcome: 'dismissed' }, 1100)
  const repeated = recordItem(CLAUDE_CODE, dismissed, finding, 1200, TOOL_FIELDS)

  expect(repeated.result).toBe(
    'Not recorded: it matches closed item f1 (the user already closed it: dismissed); nothing changed. Record it again only if the user brings it up.',
  )
})

test('a finding that matches an open ask names the id and says it made no change', () => {
  const open = recordItem(
    CLAUDE_CODE,
    EMPTY,
    { kind: 'question', ask: 'Which release branch should we use?', options: ['stable', 'next'] },
    1000,
    TOOL_FIELDS,
  )
  const finding = recordItem(
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

  expect(finding.result).toBe('Already open as i1 as a matching ask; nothing changed.')
  expect(finding.ledger.items).toHaveLength(1)
  expect(finding.ledger.findings).toHaveLength(0)
})
