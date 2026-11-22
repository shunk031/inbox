import { expect, test } from 'claude-code/testing'

import { taskOwnerReports } from '../hooks/task-report'
import type { TaskTree } from '../types'

const tree = (agent: string, machine = 'laptop'): TaskTree => [
  { id: 'task', links: { owner: { agent, machine } } } as TaskTree[number],
]
const queue = (...records: object[]) => records.map(record => JSON.stringify(record)).join('\n')

test('uses the greatest sequence for an owner', () => {
  expect(
    taskOwnerReports(
      tree('worker'),
      queue(
        { seq: 1, t: 120, from: 'worker', machine: 'laptop', text: 'STATUS first' },
        { seq: 3, t: 140, from: 'worker', machine: 'laptop', text: 'STATUS latest' },
        { seq: 2, t: 130, from: 'worker', machine: 'laptop', text: 'BLOCKED older' },
      ),
    ).task,
  ).toMatchObject({ kind: 'STATUS', line: 'STATUS latest', at: 140_000 })
})

test('a newer DONE replaces STATUS', () => {
  expect(
    taskOwnerReports(
      tree('worker'),
      queue(
        { seq: 1, t: 120, kind: 'message', from: 'worker', text: 'STATUS started' },
        { seq: 2, t: 130, kind: 'DONE', from: 'worker', text: 'finished' },
      ),
    ).task?.kind,
  ).toBe('DONE')
})

test('returns no report when the queue has no matching report', () => {
  expect(taskOwnerReports(tree('worker'), queue({ seq: 1, from: 'worker', text: 'ordinary message' }))).toEqual({})
})

test('ignores reports from another owner or machine', () => {
  expect(
    taskOwnerReports(
      tree('worker'),
      queue(
        { seq: 2, from: 'other', machine: 'laptop', text: 'DONE other owner' },
        { seq: 3, from: 'worker', machine: 'server', text: 'DONE other machine' },
      ),
    ),
  ).toEqual({})
})
