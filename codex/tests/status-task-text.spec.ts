import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TaskNode } from '../../types'
import { viewOf } from '../src/core'
import { emptyState } from '../src/state'

test('Codex Status uses the newest task note as its current text', () => {
  const now = 10_000
  const state = emptyState('overview')
  const task: TaskNode = {
    id: 't1',
    parentId: null,
    status: 'working',
    weight: 1,
    title: 'Implement the cache',
    detail: 'The original plan',
    notes: ['The latest note'],
    createdAt: now - 2_000,
    updatedAt: now,
    history: [
      { at: now - 2_000, source: 'Codex', kind: 'created' },
      { at: now - 1_000, source: 'Codex', kind: 'note', detail: 'The latest note' },
    ],
  }
  state.taskTree = [task]
  const row = viewOf(state, now).statusPage.rows.find(r => r.kind === 'subject' && r.name === task.title)

  assert.equal(row?.kind, 'subject')
  if (row?.kind === 'subject') {
    assert.match(row.text ?? '', /The latest note/)
    assert.doesNotMatch(row.text ?? '', /The original plan/)
  }
})
