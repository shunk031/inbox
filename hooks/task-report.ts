import type { Session, TaskTree } from '../types'
import type { TimelinePage } from './timeline-page'
import { shortAgo } from './rows'

type Kind = 'STATUS' | 'DONE' | 'BLOCKED'
type Report = { kind: Kind; line: string; at: number; seq: number }

export function taskOwnerReports(tree: TaskTree, queue: string): Record<string, Report> {
  const latest = new Map<string, Report>()
  for (const line of queue.split('\n'))
    try {
      const record = JSON.parse(line)
      if (typeof record?.from !== 'string' || typeof record.text !== 'string') continue
      const prefix = /^(STATUS|DONE|BLOCKED)\b/i.exec(record.text)
      const kind = (prefix?.[1] ?? /^(STATUS|DONE|BLOCKED)$/i.exec(String(record.kind))?.[1])?.toUpperCase() as
        Kind | undefined
      const key = JSON.stringify([record.from, typeof record.machine === 'string' ? record.machine : 'local'])
      const seq = Number(record.seq) || 0
      const at = typeof record.t === 'number' ? record.t * 1000 : Date.parse(record.at)
      if (!kind || seq <= (latest.get(key)?.seq ?? -1) || !Number.isFinite(at)) continue
      latest.set(key, { kind, line: prefix ? record.text : `${kind} ${record.text}`, at, seq })
    } catch {}
  return Object.fromEntries(
    tree.flatMap(task => {
      const owner = task.links?.owner
      const report = owner && latest.get(JSON.stringify([owner.agent, owner.machine]))
      return report ? [[task.id, report]] : []
    }),
  )
}

export function taskTreeWithReports(tree: TaskTree, queue: string): TaskTree {
  const reports = taskOwnerReports(tree, queue)
  return tree.map(task => {
    const kind = reports[task.id]?.kind
    const status = kind === 'DONE' ? 'done' : kind === 'BLOCKED' ? 'waits-on-other' : task.status
    return status === task.status ? task : { ...task, status }
  })
}

export function taskReportPage(
  page: TimelinePage,
  tree: TaskTree,
  queue: string,
  facts: Pick<Session, 'taskPrStates' | 'taskPrCiStates'>,
  now: number,
) {
  const reports = taskOwnerReports(tree, queue)
  const prText = (url?: string) =>
    url &&
    ` · PR ${facts.taskPrStates[url]?.toLowerCase() ?? 'state unavailable'} · CI ${facts.taskPrCiStates[url]?.replace('-', ' ') ?? 'unavailable'}`
  const reportText = (id: string, url?: string) =>
    `${reports[id] ? `${reports[id]!.line} · ${shortAgo(Math.max(0, now - reports[id]!.at))}` : 'No report yet'}${prText(url) ?? ''}`
  const latestReport = (id: string, url?: string) => ({ label: 'Latest report' as const, text: reportText(id, url) })
  const withReport = (row: TimelinePage['rows'][number]) => ({
    ...row,
    reportLine:
      !row.isCompletedFold && (reports[row.task.id] || row.task.links?.pr)
        ? reportText(row.task.id, row.task.links?.pr)
        : undefined,
  })
  const selected = page.selected && {
    ...page.selected,
    row: withReport(page.selected.row),
    details: [
      latestReport(page.selected.row.task.id, page.selected.row.task.links?.pr),
      ...page.selected.details.filter(line => line.label !== 'Detail'),
    ],
  }
  return { ...page, rows: page.rows.map(withReport), selected }
}
