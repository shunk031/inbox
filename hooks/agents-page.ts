import type { Finding, TaskOwnerFacts, TaskProgressSegments, TaskTree } from '../types'
import { shortAgo } from './rows'
import type { LocalAgent } from './herdr'
import { cellWidth, cutForEllipsis } from './text'
import { taskOwnerKey } from './task-facts'
import { weightedTaskProgress } from './task-tree'

const OWNER_STALLED_MS = 15 * 60_000

export type AgentsPageInput = {
  feedRows: readonly Finding[]
  taskTree: TaskTree
  ownerFacts: TaskOwnerFacts
  progress: TaskProgressSegments
  localAgents: readonly LocalAgent[]
  localAgentsUnavailable?: boolean
  now: number
}
export type AgentSourceOverrides = Partial<
  Pick<AgentsPageInput, 'feedRows' | 'ownerFacts' | 'localAgents' | 'localAgentsUnavailable'>
>
type AgentsPageRow = {
  kind: 'root' | 'task' | 'agent' | 'progress'
  key: string
  status: string | null
  prefix?: string
  text: string
}
type AgentsPage = {
  notice: string | null
  empty: string | null
  rows: AgentsPageRow[]
}

const isOpen = (status: string) => status !== 'done' && status !== 'dropped'

function fitLine(text: string, width: number): string {
  const limit = Math.max(1, Math.floor(width))
  if (cellWidth(text) <= limit) return text
  return `${cutForEllipsis(text, candidate => cellWidth(candidate) <= limit)}…`
}

function taskStatus(status: string): string {
  return status === 'waits-on-other' ? 'waiting' : status
}

function taskOwnerText(input: AgentsPageInput, task: AgentsPageInput['taskTree'][number]): string {
  const owner = task.links?.owner
  if (!owner) return 'No owner'
  const fact = input.ownerFacts[taskOwnerKey(owner)]
  if (!fact) return `owner ${owner.machine}/${owner.agent}`
  const age = Math.max(0, input.now - fact.since)
  const stalled = task.status === 'working' && fact.state !== 'working' && age >= OWNER_STALLED_MS
  return `owner ${owner.machine}/${owner.agent} · ${fact.state} ${shortAgo(age)}${stalled ? ' · idle 15m+' : ''}`
}

function taskDepth(id: string, parents: Map<string, string | null>): number {
  let depth = 0
  for (let parent = parents.get(id); parent != null && depth < 8; parent = parents.get(parent)) depth++
  return depth
}

function progressText(progress: TaskProgressSegments): string {
  if (progress.total <= 0) return 'No weighted tasks'
  return `${Math.round((progress.done / progress.total) * 100)}% complete · ${progress.done.toFixed(1)}/${progress.total.toFixed(1)} weight`
}

function linkedTask(input: AgentsPageInput, agent: LocalAgent): AgentsPageInput['taskTree'][number] | undefined {
  const key = JSON.stringify([agent.machine, agent.name])
  return input.taskTree
    .filter(task => isOpen(task.status) && task.links?.owner && taskOwnerKey(task.links.owner) === key)
    .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working') || b.updatedAt - a.updatedAt)[0]
}

export function agentsPage(input: AgentsPageInput, width: number): AgentsPage {
  const rows: AgentsPageRow[] = []
  for (const finding of input.feedRows) {
    if (!finding.feedOwned || finding.kind !== 'progress') continue
    const root = /^herdr\/([^/]+)\/([^/]+)$/.exec(finding.feedKey ?? '')
    if (root) {
      const machine = finding.owner?.machine ?? root[1]!
      const name = finding.owner?.agent ?? root[2]!
      const age = Math.max(0, input.now - finding.at)
      const status = age >= OWNER_STALLED_MS ? 'stale' : (finding.ownerFact?.state ?? 'unknown')
      const label = status === 'stale' ? `stale ${shortAgo(age)} · ${machine}/${name}` : `${machine}/${name}`
      rows.push({
        kind: 'root',
        key: finding.feedKey!,
        status,
        text: fitLine(`${label} · ${finding.title} · ${finding.detail} · ${shortAgo(age)}`, width),
      })
    } else {
      rows.push({
        kind: 'progress',
        key: finding.id,
        status: finding.ownerFact?.state ?? null,
        text: fitLine(`${finding.title} · ${finding.detail} · ${shortAgo(input.now - finding.at)}`, width),
      })
    }
  }

  const openTasks = input.taskTree.filter(task => isOpen(task.status))
  if (openTasks.length > 0) {
    rows.push({
      kind: 'root',
      key: 'meta-root',
      status: null,
      text: fitLine(`This session · meta · ${progressText(input.progress)}`, width),
    })
    const parents = new Map(input.taskTree.map(task => [task.id, task.parentId]))
    for (const task of openTasks) {
      const fact = task.links?.owner ? input.ownerFacts[taskOwnerKey(task.links.owner)] : undefined
      const age = fact ? Math.max(0, input.now - fact.since) : 0
      const stalled =
        task.status === 'working' && fact !== undefined && fact.state !== 'working' && age >= OWNER_STALLED_MS
      const status = stalled ? 'stalled' : taskStatus(task.status)
      const indent = '  '.repeat(taskDepth(task.id, parents))
      const percent = Math.round(weightedTaskProgress(input.taskTree, task.id) * 100)
      rows.push({
        kind: 'task',
        key: task.id,
        status,
        prefix: indent,
        text: fitLine(`${percent}% · ${taskOwnerText(input, task)} · ${task.title}`, width),
      })
    }
  }

  for (const agent of input.localAgents) {
    const task = linkedTask(input, agent)
    const assignment = task
      ? `${taskStatus(task.status)} · ${Math.round(weightedTaskProgress(input.taskTree, task.id) * 100)}% · ${taskOwnerText(input, task)} · ${task.title}`
      : 'No task linked'
    rows.push({
      kind: 'agent',
      key: agent.name,
      status: agent.status,
      text: fitLine(`${agent.name} · ${assignment}`, width),
    })
  }

  return {
    notice: input.localAgentsUnavailable ? 'Herdr agent list unavailable; local agent status is not current.' : null,
    empty: rows.length === 0 ? 'No roots, agents, or live feed rows.' : null,
    rows,
  }
}
