import { expect, test } from 'claude-code/testing'
import { taskOwnerReports, taskReportPage } from '../hooks/task-report'
import type { TaskTree } from '../types'

const owner = (id: string, agent: string, machine = 'local') => ({ id, links: { owner: { agent, machine } } })
const tree = (agent: string, machine = 'local'): TaskTree => [owner('task', agent, machine)] as TaskTree
const queue = (...records: object[]) => records.map(record => JSON.stringify(record)).join('\n')

test('selects the newest report for each exact owner and machine', () => {
  const owners = ['worker', 'worker', 'closer', 'nobody'].map((agent, i) => ({
    id: ['local', 'gpu', 'done', 'absent'][i],
    links: { owner: { agent, machine: i === 1 ? 'gpu-a' : 'local' } },
  })) as TaskTree
  const reports = taskOwnerReports(
    owners,
    queue(
      { seq: 1, t: 120, from: 'worker', text: 'STATUS first' },
      { seq: 4, t: 150, from: 'worker', machine: 'gpu-a', text: 'DONE gpu' },
      { seq: 1, t: 120, from: 'closer', text: 'STATUS started' },
      { seq: 2, t: 130, from: 'closer', kind: 'DONE', text: 'finished' },
      { seq: 5, t: 160, from: 'outsider', text: 'BLOCKED unrelated' },
    ),
  )
  expect([reports.local?.line, reports.gpu?.line]).toEqual(['STATUS first', 'DONE gpu'])
  expect([reports.done?.kind, reports.absent]).toEqual(['DONE', undefined])
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
  expect(result.rows[0]?.reportLine).toBe('No report yet · PR open · CI passing')
  expect(result.selected?.details[0]).toEqual({ label: 'Latest report', text: 'No report yet · PR open · CI passing' })
})
