import type { TaskPrCiState, TaskPrState, TaskTree } from '../types'
import type { TimelinePage } from './timeline-page'
import { shortAgo } from './rows'

type Kind = 'STATUS' | 'DONE' | 'BLOCKED'
type Report = { kind: Kind; line: string; at: number; seq: number }

export function taskOwnerReports(tree: TaskTree, queue: string): Record<string, Report> {
  const latest = new Map<string, Report>()
  for (const line of queue.split('\n')) {
    try {
      const record = JSON.parse(line)
      if (!record || typeof record.from !== 'string' || typeof record.text !== 'string') continue
      const prefix = /^(STATUS|DONE|BLOCKED)\b/i.exec(record.text)?.[1]?.toUpperCase() as Kind | undefined
      const tagged = ['STATUS', 'DONE', 'BLOCKED'].includes(String(record.kind).toUpperCase())
        ? (String(record.kind).toUpperCase() as Kind)
        : undefined
      const kind = prefix ?? tagged
      if (!kind) continue
      const key = JSON.stringify([record.from, typeof record.machine === 'string' ? record.machine : ''])
      const seq = Number(record.seq) || 0
      if (seq <= (latest.get(key)?.seq ?? -1)) continue
      const at = typeof record.t === 'number' ? record.t * 1000 : Date.parse(record.at)
      if (!Number.isFinite(at)) continue
      latest.set(key, { kind, line: prefix ? record.text : `${kind} ${record.text}`, at, seq })
    } catch {}
  }
  return Object.fromEntries(
    tree.flatMap(task => {
      const owner = task.links?.owner
      if (!owner) return []
      const exact = latest.get(JSON.stringify([owner.agent, owner.machine]))
      const anyMachine = latest.get(JSON.stringify([owner.agent, '']))
      const report = exact && (!anyMachine || exact.seq > anyMachine.seq) ? exact : (anyMachine ?? exact)
      return report ? [[task.id, report]] : []
    }),
  )
}

export function taskReportPage(
  page: TimelinePage,
  tree: TaskTree,
  queue: string,
  states: Readonly<Record<string, TaskPrState>>,
  ci: Readonly<Record<string, TaskPrCiState>>,
  now: number,
) {
  const reports = taskOwnerReports(tree, queue)
  const reportText = (id: string) => {
    const report = reports[id]
    return report ? `${report.line} · ${shortAgo(Math.max(0, now - report.at))}` : 'No report yet'
  }
  const updateRow = (row: TimelinePage['rows'][number]) => {
    if (row.isCompletedFold) return row
    const report = reports[row.task.id]
    const state =
      report?.kind === 'DONE'
        ? { status: 'done' as const, statusLabel: 'Completed', tone: 'done' as const, mark: '●' }
        : report?.kind === 'BLOCKED'
          ? { status: 'waiting' as const, statusLabel: 'Blocked', tone: 'error' as const, mark: '✕' }
          : report
            ? { status: 'working' as const, statusLabel: 'In progress', tone: 'key' as const, mark: '◐' }
            : { statusLabel: 'No report yet', tone: 'muted' as const, mark: '○' }
    const url = row.task.links?.pr
    const pr = url
      ? `PR ${states[url]?.toLowerCase() ?? 'state unavailable'} · CI ${ci[url]?.replace('-', ' ') ?? 'unavailable'}`
      : ''
    return { ...row, ...state, statusLabel: pr ? `${state.statusLabel} · ${pr}` : state.statusLabel }
  }
  const rows = page.rows.map(updateRow)
  const selected = page.selected && {
    ...page.selected,
    row: updateRow(page.selected.row),
    details: [
      { label: 'Latest report' as const, text: reportText(page.selected.row.task.id) },
      ...page.selected.details.filter(line => line.label !== 'Detail'),
    ],
  }
  return { ...page, rows, selected }
}
