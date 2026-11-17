import { expect, test } from 'claude-code/testing'

import { parseStatus } from '../hooks/status'
import { applyStatus } from '../hooks/status-ops'
import { STATUS_SYSTEM } from '../hooks/status-prompt'
import type { TaskNode } from '../types'

const task = (id: string): TaskNode => ({
  id,
  parentId: null,
  status: 'working',
  weight: 1,
  title: id,
  detail: '',
  notes: [],
  createdAt: 0,
  updatedAt: 0,
  history: [],
})

test('the Status parser ignores legacy subject and milestone lines, including when mixed with current lines', () => {
  expect(parseStatus('NEW: working | Build | started\nMILESTONE: queued | Demo | later\nSERVES: t1 | Demo')).toEqual({
    kind: 'unchanged',
  })
  expect(
    parseStatus('NEW: working | Build | started\nHEAD: Offline sync | Syncs edits offline\nLINK: i1 | t1'),
  ).toEqual({
    kind: 'ops',
    ops: [
      { kind: 'head', title: 'Offline sync', description: 'Syncs edits offline' },
      { kind: 'link', ref: 'i1', taskId: 't1' },
    ],
  })
  expect(parseStatus('NO CHANGE')).toEqual({ kind: 'unchanged' })
  expect(parseStatus(null)).toBeNull()
  expect(parseStatus('')).toBeNull()
})

test('Status applies its head and links only to existing tasks and open asks', () => {
  const tree = [task('t1')]
  const answer = parseStatus('HEAD: Offline sync | Syncs edits offline\nLINK: i1 | t1\nLINK: i2 | missing')!
  const result = applyStatus(null, answer, 100, new Set(['i1']), null, tree)!

  expect(result.head).toEqual({ title: 'Offline sync', description: 'Syncs edits offline' })
  expect(result.askSubjects).toEqual({ i1: ['t1'] })
  expect(result.subjects).toEqual([])
  expect(result.milestones).toEqual([])
})

test('a number-only HEAD is ignored and an unchanged answer leaves saved Status alone', () => {
  const current = applyStatus(null, parseStatus('HEAD: Offline sync | Syncs edits offline')!, 100, new Set())!

  expect(applyStatus(current, parseStatus('HEAD: PR #3655 | Fixing the pull request')!, 200, new Set())?.head).toEqual(
    current.head,
  )
  expect(applyStatus(current, parseStatus('NO CHANGE')!, 200, new Set())).toEqual(current)
})

test('reply and catch-up answers need a fresh HEAD, including answers that say NO CHANGE', () => {
  const current = applyStatus(null, parseStatus('HEAD: Old focus | Earlier work')!, 100, new Set())!

  expect(parseStatus('NO CHANGE', true)).toBeNull()
  expect(parseStatus('LINK: i1 | t1', true)).toBeNull()
  expect(parseStatus('NO CHANGE\nHEAD: New focus | Current work', true)).toEqual({
    kind: 'ops',
    ops: [{ kind: 'none' }, { kind: 'head', title: 'New focus', description: 'Current work' }],
  })
  expect(applyStatus(current, parseStatus('NO CHANGE')!, 200, new Set(), null, [], true)).toEqual(current)
  expect(
    applyStatus(
      current,
      parseStatus('NO CHANGE\nHEAD: New focus | Current work', true)!,
      200,
      new Set(),
      null,
      [],
      true,
    )?.head,
  ).toEqual({
    title: 'New focus',
    description: 'Current work',
  })
  expect(parseStatus('NO CHANGE')).toEqual({ kind: 'unchanged' })
  expect(STATUS_SYSTEM).toContain(
    'Write a fresh HEAD on every reply and catch-up, even if the focus is unchanged. NO CHANGE means no GOAL or LINK changed; it never replaces HEAD.',
  )
})
