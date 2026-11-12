import { expect, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/ledger'
import { applyUpdate } from '../hooks/ledger-update'
import { parseReply, recordedAsksOnly } from '../hooks/reply-parse'
import { CLAUDE_CODE } from '../hooks/model-text'
import { recordItem } from '../hooks/tools'

test('question and task explanations are recorded, replaced, and kept by both update modes', () => {
  const question = {
    kind: 'question',
    ask: 'Which cache should we use?',
    options: ['Redis', 'Memory'],
    detail: 'The choice blocks launch.\nRedis handles several instances; memory does not.',
  }
  const first = recordItem(CLAUDE_CODE, EMPTY, question, 1000)
  expect(first.ledger.items[0]?.detail).toBe(question.detail)

  const replacement = 'The deployment now runs on one instance.'
  const second = recordItem(CLAUDE_CODE, first.ledger, { ...question, detail: replacement }, 1100)
  expect(second.ledger.items[0]?.detail).toBe(replacement)
  expect(second.result).toContain('replaced its detail')

  const update = parseReply('UPDATE: i1 | Redis / Memory | Memory')!
  for (const recordedOnly of [false, true]) {
    const applied = applyUpdate(second.ledger, recordedOnly ? recordedAsksOnly(update) : update, 1200, 1)
    expect(applied.items[0]?.detail).toBe(replacement)
  }

  const task = recordItem(
    CLAUDE_CODE,
    EMPTY,
    { kind: 'task', ask: 'Sign in to the dashboard', detail: 'Only the user has the required account.' },
    1000,
  )
  expect(task.ledger.items[0]?.detail).toBe('Only the user has the required account.')
})

test('the detail cap counts visible text and leaves no partial Markdown link', () => {
  const detail = `${'a'.repeat(1190)} [release notes](https://example.com/release)`
  const result = recordItem(CLAUDE_CODE, EMPTY, { kind: 'task', ask: 'Read the release notes', detail }, 1000)

  expect(result.ledger.items[0]?.detail).toHaveLength(1200)
  expect(result.ledger.items[0]?.detail).not.toContain('](')
})
