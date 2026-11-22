import { expect, test } from 'claude-code/testing'

import { applyTaskOwnerFacts, observedTaskOwnerFact, taskOwnerKey } from '../hooks/task-facts'
import type { TaskNode } from '../types'

const NOW = 1_000_000
const owner = { machine: 'local', agent: 'worker-1' }
const task = (change: Partial<TaskNode> = {}): TaskNode => ({
  id: 'task-1',
  parentId: null,
  status: 'working',
  weight: 1,
  title: 'Build the feature',
  detail: '',
  notes: [],
  createdAt: NOW,
  updatedAt: NOW,
  history: [],
  links: { owner },
  ...change,
})

test('owner idle for 15 minutes stalls a working task without changing its status', () => {
  const original = [task()]
  const facts = { [taskOwnerKey(owner)]: { state: 'idle' as const, since: NOW - 15 * 60_000 } }
  const result = applyTaskOwnerFacts(original, facts)

  expect(result.stalledSince).toEqual({ 'task-1': NOW - 15 * 60_000 })
  expect(original[0]?.status).toBe('working')
})

test('unknown owner state adds no marker', () => {
  expect(applyTaskOwnerFacts([task()], {})).toMatchObject({ stalledSince: {} })
})

test('a finished owner keeps its stalled marker', () => {
  const facts = { [taskOwnerKey(owner)]: { state: 'done' as const, since: NOW - 120_000 } }
  const result = applyTaskOwnerFacts([task()], facts)

  expect(result.stalledSince).toEqual({ 'task-1': NOW - 120_000 })
})

test('a repeated non-working observation retains its start time', () => {
  expect(observedTaskOwnerFact({ state: 'blocked', since: 10 }, 'blocked', 20)).toEqual({ state: 'blocked', since: 10 })
  expect(observedTaskOwnerFact({ state: 'working', since: 10 }, 'idle', 20)).toEqual({ state: 'idle', since: 20 })
})
