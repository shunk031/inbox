import type { Finding, TaskNode, TaskOwnerFacts, TaskProgressSegments, TaskTree } from '../types'
import { shortAgo } from './rows'
import type { LocalAgent } from './herdr'
import { cellWidth, cutForEllipsis } from './text'
import { taskOwnerKey } from './task-facts'
import { weightedTaskProgress } from './task-tree'

const OWNER_STALLED_MS = 15 * 60_000
type AgentOwner = { machine: string; agent: string }

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
  kind: 'group' | 'root' | 'task' | 'agent' | 'progress'
  key: string
  status: string | null
  text: string
  depth: number
  hasLaterSibling: boolean
  guides: string[]
  owner?: AgentOwner
  count?: number
}
type AgentsPageGroup = { row: AgentsPageRow; rows: AgentsPageRow[] }
type AgentsPage = {
  notice: string | null
  empty: string | null
  groups: AgentsPageGroup[]
  rows: AgentsPageRow[]
  attentionCount: number
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

function ownerOf(task: TaskNode): AgentOwner | undefined {
  return task.links?.owner
}

function taskOwnerText(input: AgentsPageInput, task: TaskNode): string {
  const owner = ownerOf(task)
  if (!owner) return 'No owner'
  const fact = input.ownerFacts[taskOwnerKey(owner)]
  if (!fact) return `owner ${owner.machine}/${owner.agent}`
  const age = Math.max(0, input.now - fact.since)
  const stalled = task.status === 'working' && fact.state !== 'working' && age >= OWNER_STALLED_MS
  return `owner ${owner.machine}/${owner.agent} · ${fact.state} ${shortAgo(age)}${stalled ? ' · idle 15m+' : ''}`
}

function progressText(progress: TaskProgressSegments): string {
  if (progress.total <= 0) return 'No weighted tasks'
  return `${Math.round((progress.done / progress.total) * 100)}% complete · ${progress.done.toFixed(1)}/${progress.total.toFixed(1)} weight`
}

function linkedTask(input: AgentsPageInput, agent: LocalAgent): TaskNode | undefined {
  const key = JSON.stringify([agent.machine, agent.name])
  return input.taskTree
    .filter(task => isOpen(task.status) && task.links?.owner && taskOwnerKey(task.links.owner) === key)
    .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working') || b.updatedAt - a.updatedAt)[0]
}

function treeRow(
  kind: AgentsPageRow['kind'],
  key: string,
  status: string | null,
  text: string,
  depth: number,
  hasLaterSibling: boolean,
  guides: string[],
  owner?: AgentOwner,
): AgentsPageRow {
  return { kind, key, status, text, depth, hasLaterSibling, guides, ...(owner ? { owner } : {}) }
}

function taskRows(input: AgentsPageInput, width: number, agents: readonly LocalAgent[]): AgentsPageRow[] {
  const open = input.taskTree.filter(task => isOpen(task.status))
  const openIds = new Set(open.map(task => task.id))
  const children = new Map<string | null, TaskNode[]>()
  for (const task of open) {
    let parent = task.parentId
    while (parent !== null && !openIds.has(parent)) {
      parent = input.taskTree.find(candidate => candidate.id === parent)?.parentId ?? null
    }
    children.set(parent, [...(children.get(parent) ?? []), task])
  }

  const assigned = new Map<string, LocalAgent[]>()
  for (const agent of agents) {
    const task = linkedTask(input, agent)
    if (task) assigned.set(task.id, [...(assigned.get(task.id) ?? []), agent])
  }

  const rows: AgentsPageRow[] = [
    treeRow(
      'root',
      'meta-root',
      null,
      fitLine(`This session · meta · ${progressText(input.progress)}`, width),
      1,
      false,
      [],
    ),
  ]
  const visit = (siblings: (TaskNode | LocalAgent)[], depth: number, guides: string[]) => {
    siblings.forEach((entry, index) => {
      const hasLaterSibling = index < siblings.length - 1
      if ('id' in entry) {
        const fact = ownerOf(entry) ? input.ownerFacts[taskOwnerKey(ownerOf(entry)!)] : undefined
        const age = fact ? Math.max(0, input.now - fact.since) : 0
        const stalled =
          entry.status === 'working' && fact !== undefined && fact.state !== 'working' && age >= OWNER_STALLED_MS
        const status = stalled ? 'stalled' : taskStatus(entry.status)
        const nextGuides = [...guides, hasLaterSibling ? '│  ' : '   ']
        const percent = Math.round(weightedTaskProgress(input.taskTree, entry.id) * 100)
        rows.push(
          treeRow(
            entry.parentId === null || !openIds.has(entry.parentId) ? 'root' : 'task',
            entry.id,
            status,
            fitLine(`${percent}% · ${taskOwnerText(input, entry)} · ${entry.title}`, width),
            depth,
            hasLaterSibling,
            guides,
            ownerOf(entry),
          ),
        )
        const descendants: (TaskNode | LocalAgent)[] = [
          ...(children.get(entry.id) ?? []),
          ...(assigned.get(entry.id) ?? []),
        ]
        if (descendants.length) visit(descendants, depth + 1, nextGuides)
      } else {
        rows.push(
          treeRow(
            'agent',
            JSON.stringify([entry.machine, entry.name]),
            entry.status,
            fitLine(entry.name, width),
            depth,
            hasLaterSibling,
            guides,
            { machine: entry.machine, agent: entry.name },
          ),
        )
      }
    })
  }
  visit(children.get(null) ?? [], 2, ['   '])
  return rows
}

function groupRow(key: string, text: string, count: number, hasLaterSibling: boolean): AgentsPageRow {
  return { kind: 'group', key, status: null, text, count, depth: 0, hasLaterSibling, guides: [] }
}

function withGroup(title: string, key: string, entries: AgentsPageRow[]): AgentsPageGroup {
  const row = groupRow(key, title, entries.length, false)
  return { row, rows: entries }
}

export function agentsPage(input: AgentsPageInput, width: number): AgentsPage {
  const agentsById = new Map<string, LocalAgent>()
  for (const agent of input.localAgents) agentsById.set(JSON.stringify([agent.machine, agent.name]), agent)
  const agents = [...agentsById.values()]
  const feedRows: AgentsPageRow[] = input.feedRows.flatMap(finding => {
    if (!finding.feedOwned || finding.kind !== 'progress') return []
    const root = /^herdr\/([^/]+)\/([^/]+)$/.exec(finding.feedKey ?? '')
    if (root) {
      const machine = finding.owner?.machine ?? root[1]!
      const agent = finding.owner?.agent ?? root[2]!
      const age = Math.max(0, input.now - finding.at)
      const status = age >= OWNER_STALLED_MS ? 'stale' : (finding.ownerFact?.state ?? 'unknown')
      const label = status === 'stale' ? `stale ${shortAgo(age)} · ${machine}/${agent}` : `${machine}/${agent}`
      return [
        treeRow(
          'root',
          finding.id,
          status,
          fitLine(`${label} · ${finding.title} · ${finding.detail} · ${shortAgo(age)}`, width),
          1,
          false,
          [],
          { machine, agent },
        ),
      ]
    }
    return [
      treeRow(
        'progress',
        finding.id,
        finding.ownerFact?.state ?? null,
        fitLine(`${finding.title} · ${finding.detail} · ${shortAgo(input.now - finding.at)}`, width),
        1,
        false,
        [],
        finding.owner,
      ),
    ]
  })
  feedRows.forEach((row, index) => {
    row.hasLaterSibling = index < feedRows.length - 1
  })

  const metaRows = input.taskTree.some(task => isOpen(task.status)) ? taskRows(input, width, agents) : []
  const assignedAgentIds = new Set(metaRows.filter(row => row.kind === 'agent').map(row => row.key))
  const localRows = agents
    .filter(agent => !assignedAgentIds.has(JSON.stringify([agent.machine, agent.name])))
    .map((agent, index, rows) =>
      treeRow(
        'agent',
        JSON.stringify([agent.machine, agent.name]),
        agent.status,
        fitLine(agent.name, width),
        1,
        index < rows.length - 1,
        [],
        { machine: agent.machine, agent: agent.name },
      ),
    )
  const groups = [
    withGroup('Orchestrators', 'orchestrators', feedRows),
    withGroup('Meta tasks', 'meta-tasks', metaRows),
    withGroup('Local agents', 'local-agents', localRows),
  ].map((group, index, all) => ({
    ...group,
    row: { ...group.row, hasLaterSibling: index < all.length - 1 },
  }))
  const rows = groups.flatMap(group => [group.row, ...group.rows])
  const attentionCount = rows.filter(
    row => row.status === 'stalled' || row.status === 'blocked' || row.status === 'stale',
  ).length

  return {
    notice: input.localAgentsUnavailable ? 'Herdr agent list unavailable; local agent status is not current.' : null,
    empty: rows.every(row => row.kind === 'group') ? 'No roots, agents, or live feed rows.' : null,
    groups,
    rows,
    attentionCount,
  }
}

export function agentsAttentionCount(input: AgentsPageInput): number {
  return agentsPage(input, Number.MAX_SAFE_INTEGER).attentionCount
}

export function agentsInputForPane(
  input: Omit<AgentsPageInput, 'now'>,
  now: number,
  isDemo: boolean,
  localAgents: readonly LocalAgent[],
  unavailable: boolean,
): AgentsPageInput {
  return {
    ...input,
    now,
    localAgents: isDemo ? input.localAgents : localAgents,
    localAgentsUnavailable: isDemo ? input.localAgentsUnavailable : unavailable,
  }
}
