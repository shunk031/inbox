import type { Session, TaskHistoryEvent, TaskNode, TaskTree } from '../types'
import type { TimelineHistoryEvent, TimelinePage } from './timeline-page'
import { shortAgo } from './rows'

type Kind = 'STATUS' | 'DONE' | 'BLOCKED'
type TaskOwnerReport = { kind: Kind; line: string; at: number; seq: number }
type PrFacts = Pick<Session, 'taskPrStates' | 'taskPrCiStates'>
type ReportTask = Pick<TaskNode, 'id' | 'links'> & {
  history?: readonly TaskHistoryEvent[] | readonly TimelineHistoryEvent[]
  changedAt?: number
}
type TaskReportEnvironment = { HOME?: string; HERDR_META_PATROL_STATE_DIR?: string }
type TaskTextRow = { status: TaskNode['status']; report: string }
export type TaskTextFacts = { taskRows?: Record<string, TaskTextRow> }

/** Reads the owner's queue through the current host's filesystem adapter. */
export async function readTaskReportQueue(
  env: TaskReportEnvironment,
  read: (path: string) => Promise<string>,
): Promise<string> {
  const stateDir = env.HERDR_META_PATROL_STATE_DIR?.trim()
  const dir = stateDir || (env.HOME ? `${env.HOME.replace(/\/+$/, '')}/.local/state/herdr-meta-patrol` : '')
  return dir ? read(`${dir.replace(/\/+$/, '')}/queue.jsonl`).catch(() => '') : ''
}

export async function readTaskReportQueueFromHost(
  home: Promise<string | undefined>,
  stateDir: Promise<string | undefined>,
  read: (path: string) => Promise<string>,
): Promise<string> {
  const [HOME, HERDR_META_PATROL_STATE_DIR] = await Promise.all([home, stateDir])
  return readTaskReportQueue({ HOME, HERDR_META_PATROL_STATE_DIR }, read)
}

export function taskOwnerReports(tree: readonly ReportTask[], queue: string): Record<string, TaskOwnerReport> {
  const latest = new Map<string, TaskOwnerReport>()
  for (const line of queue.split('\n'))
    try {
      const r = JSON.parse(line)
      if (typeof r?.from !== 'string' || typeof r.text !== 'string') continue
      const prefix = /^(STATUS|DONE|BLOCKED)\b/i.exec(r.text)
      const kind = (prefix?.[1] ?? /^(STATUS|DONE|BLOCKED)$/i.exec(String(r.kind))?.[1])?.toUpperCase() as Kind
      const key = JSON.stringify([r.from, typeof r.machine === 'string' ? r.machine : 'local'])
      const seq = Number(r.seq) || 0,
        at = typeof r.t === 'number' ? r.t * 1000 : Date.parse(r.at)
      if (!kind || seq <= (latest.get(key)?.seq ?? -1) || !Number.isFinite(at)) continue
      latest.set(key, { kind, line: prefix ? r.text : `${kind} ${r.text}`, at, seq })
    } catch {}
  return Object.fromEntries(
    tree.flatMap(({ id, links, history, changedAt }) => {
      const report = links?.owner && latest.get(JSON.stringify([links.owner.agent, links.owner.machine]))
      const lastChange =
        changedAt ?? history?.reduce((at, event) => Math.max(at, 'at' in event ? event.at : at), -Infinity) ?? -Infinity
      return report && report.at >= lastChange ? [[id, report]] : []
    }),
  )
}

const reportedStatus = (status: TaskNode['status'], report?: TaskOwnerReport): TaskNode['status'] =>
  report ? ({ STATUS: 'working', DONE: 'done', BLOCKED: 'waits-on-other' } as const)[report.kind] : status

/** The task report and linked PR facts shared by Timeline and model-read task rows. */
function taskReportText(
  report: TaskOwnerReport | undefined,
  hasReport: boolean,
  url: string | undefined,
  facts: PrFacts,
  now: number,
): string {
  const parts = hasReport
    ? [report ? `${report.line} · ${shortAgo(Math.max(0, now - report.at))}` : 'No report yet']
    : []
  if (url)
    parts.push(
      `PR ${facts.taskPrStates[url]?.toLowerCase() ?? 'state unavailable'}`,
      `CI ${facts.taskPrCiStates[url]?.replace('-', ' ') ?? 'unavailable'}`,
    )

  return parts.join(' · ')
}

export function taskTreeWithReports(tree: TaskTree, queue: string): TaskTree {
  const reports = taskOwnerReports(tree, queue)
  return tree.map(task => {
    const status = reportedStatus(task.status, reports[task.id])
    return status === task.status ? task : { ...task, status }
  })
}

/** The derived status and report line shown in model-read task rows. */
export function taskReportRows(
  tree: TaskTree,
  queue: string,
  facts: PrFacts,
  now: number,
): Record<string, TaskTextRow> {
  const reports = taskOwnerReports(tree, queue)
  return Object.fromEntries(
    tree.map(task => {
      const report = reports[task.id]
      return [
        task.id,
        {
          status: reportedStatus(task.status, report),
          report: taskReportText(report, !!task.links?.owner || !!task.links?.pr, task.links?.pr, facts, now),
        },
      ]
    }),
  )
}

export function taskTextFacts(
  session: Pick<Session, 'taskTree' | 'taskPrStates' | 'taskPrCiStates'>,
  queue: string,
  now: number,
): TaskTextFacts {
  return { taskRows: taskReportRows(session.taskTree, queue, session, now) }
}

export function taskReportPage(
  page: TimelinePage,
  tree: readonly ReportTask[],
  queue: string,
  facts: PrFacts,
  now: number,
  preserveTaskDetail = false,
) {
  const reports = taskOwnerReports(tree, queue)
  const reportText = (id: string, hasOwner: boolean, url?: string) =>
    taskReportText(reports[id], hasOwner || !!url, url, facts, now)
  const withReport = (row: TimelinePage['rows'][number]) =>
    !row.isCompletedFold && (row.task.links?.owner || row.task.links?.pr)
      ? { ...row, reportLine: reportText(row.task.id, !!row.task.links?.owner, row.task.links?.pr) }
      : { ...row, reportLine: undefined }
  const selected = page.selected && {
    ...page.selected,
    row: withReport(page.selected.row),
    details: [
      {
        label: 'Latest report' as const,
        text: reportText(page.selected.row.task.id, true, page.selected.row.task.links?.pr),
      },
      ...page.selected.details.filter(line => preserveTaskDetail || line.label !== 'Detail'),
    ],
  }
  return { ...page, rows: page.rows.map(withReport), selected }
}
