import { expect, test } from 'claude-code/testing'
import { taskOwnerReports, taskReportPage, taskTreeWithReports } from '../hooks/task-report'
import type { TaskTree } from '../types'

const owner = (id: string, agent: string, machine = 'local') => ({ id, links: { owner: { agent, machine } } })
const tree = (agent: string, machine = 'local'): TaskTree =>
  [{ ...owner('task', agent, machine), history: [] }] as never
const queue = (...records: object[]) => records.map(record => JSON.stringify(record)).join('\n')

test('newer reports remain visible and update saved status for each exact owner and machine', () => {
  const owners = ['worker', 'worker', 'closer', 'nobody'].map((agent, i) => ({
    id: ['local', 'gpu', 'done', 'absent'][i],
    links: { owner: { agent, machine: i === 1 ? 'gpu-a' : 'local' } },
    history: [{ at: 100_000, source: 'agent', kind: 'updated' }],
  })) as TaskTree
  const events = queue(
    { seq: 1, t: 120, from: 'worker', text: 'STATUS first' },
    { seq: 4, t: 150, from: 'worker', machine: 'gpu-a', text: 'DONE gpu' },
    { seq: 1, t: 120, from: 'closer', text: 'STATUS started' },
    { seq: 2, t: 130, from: 'closer', kind: 'DONE', text: 'finished' },
    { seq: 5, t: 160, from: 'outsider', text: 'BLOCKED unrelated' },
  )
  const reports = taskOwnerReports(owners, events)
  expect([reports.local?.line, reports.gpu?.line]).toEqual(['STATUS first', 'DONE gpu'])
  expect([reports.done?.kind, reports.absent]).toEqual(['DONE', undefined])
  owners[0]!.status = 'queued'
  expect(taskTreeWithReports(owners, events)[0]?.status).toBe('working')
})

test('an open linked PR shows its CI in the Timeline row and detail', () => {
  const pr = 'https://github.com/example/project/pull/13'
  const row = { task: { id: 'task', links: { pr } }, statusLabel: 'Not started', isCompletedFold: false }
  const ownerRow = { task: owner('unreported', 'worker'), isCompletedFold: false }
  const result = taskReportPage(
    { rows: [row, ownerRow], selected: { row, details: [] } } as never,
    tree('worker'),
    '',
    { taskPrStates: { [pr]: 'OPEN' }, taskPrCiStates: { [pr]: 'passing' } } as never,
    1_000,
  )
  expect(result.rows[0]?.reportLine).toBe('No report yet · PR open · CI passing')
  expect(result.rows[1]?.reportLine).toBe('No report yet')
  expect(result.selected?.details[0]).toEqual({ label: 'Latest report', text: 'No report yet · PR open · CI passing' })
})

test('an older report is hidden without changing saved status', () => {
  const task = {
    ...owner('task', 'worker'),
    status: 'queued',
    history: [{ at: 20_000, source: 'agent', kind: 'updated' }],
  }
  const events = queue({ seq: 1, t: 19, from: 'worker', text: 'STATUS stale report' })
  const row = { task, isCompletedFold: false }
  const result = taskReportPage(
    { rows: [row], selected: { row, details: [] } } as never,
    [task] as never,
    events,
    { taskPrStates: {}, taskPrCiStates: {} } as never,
    30_000,
  )
  expect(result.rows[0]?.reportLine).toBe('No report yet')
  expect(result.selected?.details[0]).toEqual({ label: 'Latest report', text: 'No report yet' })
  expect(taskTreeWithReports([task] as never, events)[0]?.status).toBe('queued')
})
