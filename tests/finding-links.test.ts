import { expect, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/ledger'
import { CLAUDE_CODE } from '../hooks/model-text'
import { recordItem } from '../hooks/tools'
import { linkLabel } from '../hooks/inline'

test('finding title and detail caps count visible text without partial links', () => {
  const title = `${'x'.repeat(113)} [release notes](https://example.com/release)`
  const detail = `${'y'.repeat(593)} [release notes](https://example.com/release)`
  const result = recordItem(CLAUDE_CODE, EMPTY, { kind: 'finding', title, detail }, 1000)
  const finding = result.ledger.findings[0]!

  expect(linkLabel(finding.title)).toHaveLength(120)
  expect(linkLabel(finding.detail)).toHaveLength(600)
  expect(finding.title).not.toContain('](')
  expect(finding.detail).not.toContain('](')
})
