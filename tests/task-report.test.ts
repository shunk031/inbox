import { expect, test } from 'claude-code/testing'
import { taskOwnerReports, taskReportPage } from '../hooks/task-report'
import type { TaskTree } from '../types'

const tree = (agent: string, machine = 'local'): TaskTree => [
  { id: 'task', links: { owner: { agent, machine } } } as TaskTree[number],
]
const queue = (...records: object[]) => records.map(record => JSON.stringify(record)).join('\n')

test('selects the newest report for each exact owner and machine', () => {
  const owners = ['local', 'gpu', 'done', 'absent'].map(id => ({
    id,
    links: {
      owner: {
        agent: id === 'done' ? 'closer' : id === 'absent' ? 'nobody' : 'worker',
        machine: id === 'gpu' ? 'gpu-a' : 'local',
      },
    },
  })) as TaskTree
  const reports = taskOwnerReports(
    owners,
    queue(
      { seq: 1, t: 120, from: 'worker', text: 'STATUS first' },
      { seq: 3, t: 140, from: 'worker', text: 'STATUS local' },
      { seq: 2, t: 130, from: 'worker', machine: 'local', text: 'BLOCKED older' },
      { seq: 4, t: 150, from: 'worker', machine: 'gpu-a', text: 'DONE gpu' },
      { seq: 1, t: 120, from: 'closer', text: 'STATUS started' },
      { seq: 2, t: 130, from: 'closer', kind: 'DONE', text: 'finished' },
      { seq: 5, t: 160, from: 'outsider', text: 'BLOCKED unrelated' },
    ),
  )
  expect([reports.local?.line, reports.gpu?.line, reports.done?.kind, reports.absent]).toEqual([
    'STATUS local',
    'DONE gpu',
    'DONE',
    undefined,
  ])
})

test('an open linked PR shows its CI in the Timeline row and detail', () => {
  const pr = 'https://github.com/example/project/pull/13'
  const row = { task: { id: 'task', links: { pr } }, statusLabel: 'Not started', isCompletedFold: false }
  const result = taskReportPage(
    { rows: [row], selected: { row, details: [] } } as never,
    tree('worker'),
    '',
    { taskPrStates: { [pr]: 'OPEN' }, taskPrCiStates: { [pr]: 'passing' } } as never,
    1_000,
  )
  expect([result.rows[0]?.statusLabel, result.selected?.row.statusLabel]).toEqual(['Not started', 'Not started'])
  expect(result.rows[0]?.reportLine).toBe('No report yet · PR open · CI passing')
  expect(result.selected?.details[0]).toEqual({ label: 'Latest report', text: 'No report yet · PR open · CI passing' })
})
