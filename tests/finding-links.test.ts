import { expect, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/ledger'
import { CLAUDE_CODE } from '../hooks/model-text'
import { recordItem } from '../hooks/tools'
import type { Finding } from '../types'

test('an old finding payload is refused without changing an existing legacy finding', () => {
  const oldFinding: Finding = {
    id: 'f1',
    kind: 'issue',
    title: 'Existing issue',
    detail: 'Keep this row readable.',
    path: null,
    at: 900,
  }
  const ledger = { ...EMPTY, findings: [oldFinding] }
  const link = '[release notes](https://example.com/release)'
  const result = recordItem(CLAUDE_CODE, ledger, { kind: 'finding', title: link, detail: link }, 1000)

  expect(result.result).toBe(
    'Not recorded: findings are retired. Add it as a task with `tasks` if it is work to track, or record a question or task if the person must decide or act.',
  )
  expect(result.ledger).toBe(ledger)
  expect(result.ledger.findings).toEqual([oldFinding])
})
