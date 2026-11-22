import type { Session, TaskTree } from '../types'
import type { TimelinePage } from './timeline-page'
import { shortAgo } from './rows'

type Kind = 'STATUS' | 'DONE' | 'BLOCKED'
type Report = { kind: Kind; line: string; at: number; seq: number }
type PrFacts = Pick<Session, 'taskPrStates' | 'taskPrCiStates'>

export function taskOwnerReports(tree: TaskTree, queue: string): Record<string, Report> {
  const latest = new Map<string, Report>()
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
    tree.flatMap(({ id, links }) => {
      const report = links?.owner && latest.get(JSON.stringify([links.owner.agent, links.owner.machine]))
      return report ? [[id, report]] : []
    }),
  )
}

export function taskTreeWithReports(tree: TaskTree, queue: string): TaskTree {
  const reports = taskOwnerReports(tree, queue)
  return tree.map(task => {
    const status =
      reports[task.id]?.kind === 'DONE' ? 'done' : reports[task.id]?.kind === 'BLOCKED' ? 'waits-on-other' : task.status
    return status === task.status ? task : { ...task, status }
  })
}

export function taskReportPage(page: TimelinePage, tree: TaskTree, queue: string, facts: PrFacts, now: number) {
  const reports = taskOwnerReports(tree, queue)
  const reportText = (id: string, url?: string) => {
    const report = reports[id]
    return `${report ? `${report.line} · ${shortAgo(Math.max(0, now - report.at))}` : 'No report yet'}${url ? ` · PR ${facts.taskPrStates[url]?.toLowerCase() ?? 'state unavailable'} · CI ${facts.taskPrCiStates[url]?.replace('-', ' ') ?? 'unavailable'}` : ''}`
  }
  const withReport = (row: TimelinePage['rows'][number]) =>
    !row.isCompletedFold && (reports[row.task.id] || row.task.links?.pr)
      ? { ...row, reportLine: reportText(row.task.id, row.task.links?.pr) }
      : { ...row, reportLine: undefined }
  const selected = page.selected && {
    ...page.selected,
    row: withReport(page.selected.row),
    details: [
      {
        label: 'Latest report' as const,
        text: reportText(page.selected.row.task.id, page.selected.row.task.links?.pr),
      },
      ...page.selected.details.filter(line => line.label !== 'Detail'),
    ],
  }
  return { ...page, rows: page.rows.map(withReport), selected }
}
