import { expect, test } from 'claude-code/testing'

import { taskOwnerReports, taskReportPage } from '../hooks/task-report'
import type { TaskTree } from '../types'

const tree = (agent: string, machine = 'local'): TaskTree => [
  { id: 'task', links: { owner: { agent, machine } } } as TaskTree[number],
]
const queue = (...records: object[]) => records.map(record => JSON.stringify(record)).join('\n')

test('uses the greatest sequence for an owner', () => {
  expect(
    taskOwnerReports(
      tree('worker', 'laptop'),
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

test('matches records only to the exact owner and machine', () => {
  const owners = ['local', 'gpu-a'].map(machine => ({
    id: machine,
    links: { owner: { agent: 'worker', machine } },
  })) as TaskTree
  expect(
    taskOwnerReports(
      owners,
      queue(
        { seq: 3, t: 140, from: 'worker', text: 'STATUS local' },
        { seq: 2, t: 130, from: 'worker', machine: 'gpu-a', text: 'DONE gpu' },
      ),
    ),
  ).toMatchObject({ local: { line: 'STATUS local' }, 'gpu-a': { line: 'DONE gpu' } })
})

test('an open linked PR shows its CI in the Timeline row and detail', () => {
  const pr = 'https://github.com/example/project/pull/13'
  const row = { task: { id: 'task', links: { pr } }, isCompletedFold: false }
  const page = { rows: [row], selected: { row, details: [] } } as never
  const result = taskReportPage(page, tree('worker'), '', { [pr]: 'OPEN' }, { [pr]: 'passing' }, 1_000)
  expect(result.rows[0]?.statusLabel).toBe('No report yet · PR open · CI passing')
  expect(result.selected?.row.statusLabel).toBe('No report yet · PR open · CI passing')
})
