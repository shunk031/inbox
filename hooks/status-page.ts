import type { Item, Ledger, Session, Subject, TaskNode, TaskTree } from '../types'
import { isChildRunning } from './status-children'
import { isOpen } from './status-limits'
import { cutAtPhrase } from './text'
import type { StatusTone } from './help'
import { goalPage, oldestAsk } from './status-goal-page'
import type { GoalParts } from './status-goal-page'
import { isFinishedUnseen, partRows } from './status-page-parts'
import type { ListContext } from './status-page-parts'
import { weightedTaskProgress } from './task-tree'

const STATUS_FAILED =
  "The inbox couldn't update this page from one of the agent's replies. What changed in that reply may be missing. It reads the conversation again after the next reply."

export type StatusBranch = 'mid' | 'last'
export type StatusStall = { text: string; tone: 'needsYou' | 'done' | 'muted' }

export type StatusRow = { depth: number } & (
  | {
      kind: 'subject'
      id: string
      mark: string
      tone: StatusTone
      isRunning: boolean
      name: string
      text: string | null
      stall: StatusStall | null
      merged: string | null
      was: string | null
      hasChildren: boolean
      ask: { id: string; kind: Item['kind'] } | null
    }
  | {
      kind: 'child'
      id: string
      mark: string
      tone: StatusTone
      isRunning: boolean
      name: string
      stall: StatusStall | null
      branch: StatusBranch | null
    }
  | { kind: 'more'; id: string; text: string; branch: 'last' }
  | { kind: 'fold'; id: string; mark: string; tone: StatusTone; text: string; subjectIds: string[] }
  | { kind: 'done-fold'; id: string; text: string; rows: StatusRow[] }
  | { kind: 'part'; id: string; text: string }
  | { kind: 'counts'; id: string; counts: StatusCount[] }
)

export type StatusCount = { mark: string; tone: StatusTone; text: string }

export type StatusPage = GoalParts & {
  isEmpty: boolean
  head: { title: string; description: string | null } | null
  rows: StatusRow[]
  error: string | null
  empty: { title: string; hint: string }
}

export const WAS_PREFIX = 'was: '
const MERGED_PREFIX = 'merged in: '
export const STALL_GAP = ' · '
export const STATUS_TEXT_LINES = 3
export const NAMED_FOLD_TEXT = { done: 'Also done: ', dropped: 'Also dropped: ' } as const
export const namedFoldMore = (n: number) => `+${n} more`

export function mergedLine(merged: string, fits: (text: string) => boolean): string {
  return `${MERGED_PREFIX}${cutAtPhrase(merged, names => fits(`${MERGED_PREFIX}${names}`))}`
}

export function nameBeforeStall(name: string, fits: (shown: string) => boolean): string {
  const words = name.split(' ')
  const cuts = words.map((_, n) => (n === 0 ? name : `${words.slice(0, words.length - n).join(' ')}…`))

  return cuts.find(fits) ?? cuts.at(-1)!
}

function rootOf(taskId: string | null, byId: ReadonlyMap<string, TaskNode>): TaskNode | null {
  let task = taskId === null ? undefined : byId.get(taskId)
  while (task?.parentId !== null && task?.parentId !== undefined) task = byId.get(task.parentId)
  return task ?? null
}

function rootsOf(tree: TaskTree): { id: string; roots: TaskNode[] }[] {
  const groups = new Map<string, TaskNode[]>()
  for (const task of tree.filter(node => node.parentId === null)) {
    const key = task.streamId ? `stream:${task.streamId}` : `task:${task.id}`
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  return [...groups.values()].map(roots => ({ id: roots[0]!.id, roots }))
}

function statusOf(roots: TaskNode[]): TaskNode['status'] {
  if (roots.every(task => task.status === 'done' || task.status === 'dropped'))
    return roots.some(task => task.status === 'done') ? 'done' : 'dropped'
  if (roots.some(task => task.status === 'working')) return 'working'
  if (roots.some(task => task.status === 'waits-on-other')) return 'waits-on-other'
  return 'queued'
}

function progressOf(tree: TaskTree, roots: TaskNode[]): number {
  const totalWeight = roots.reduce((sum, task) => sum + task.weight, 0)
  return totalWeight === 0
    ? 0
    : Math.round(
        (roots.reduce((sum, task) => sum + weightedTaskProgress(tree, task.id) * task.weight, 0) / totalWeight) * 100,
      )
}

export function statusPage(
  s: {
    ledger: Pick<Ledger, 'overview' | 'items'>
    taskTree?: TaskTree
    presence: Session['presence']
    overviewFailure?: Session['overviewFailure']
  },
  now: number,
): StatusPage {
  const o = s.ledger.overview
  const tree = s.taskTree ?? []
  const byId = new Map(tree.map(task => [task.id, task]))
  const groups = rootsOf(tree)
  const rootIds = new Map<string, string>()
  for (const group of groups) for (const root of group.roots) rootIds.set(root.id, group.id)
  const rootIdOf = (id: string | null) => {
    const root = rootOf(id, byId)
    return root === null ? null : (rootIds.get(root.id) ?? root.id)
  }
  const askLinks = Object.fromEntries(
    Object.entries(o?.askSubjects ?? {}).map(([ask, ids]) => [
      ask,
      [...new Set(ids.map(rootIdOf).filter((id): id is string => id !== null))],
    ]),
  )
  const heldIds = new Set(Object.values(askLinks).flat())
  const lastLookAt = o?.lastLookAt ?? null
  const missed = o?.missedInLastLook ?? {}
  const runningChildren = (o?.children ?? [])
    .filter(child => isChildRunning(child, now) || isFinishedUnseen(child, lastLookAt))
    .map(child => ({ ...child, subjectId: rootIdOf(child.subjectId) }))
    .sort((a, b) => (b.lastActivityAt ?? b.startedAt) - (a.lastActivityAt ?? a.startedAt))
  const taskRows = groups.map(({ id, roots }) => {
    const detail = roots
      .map(task => task.detail)
      .filter(Boolean)
      .join('; ')
    const progress = progressOf(tree, roots)
    const changedAt = Math.max(...roots.map(task => task.updatedAt))
    const closed = roots.every(task => task.status === 'done' || task.status === 'dropped')
    return {
      id,
      name: roots.map(task => task.title).join(', '),
      status: statusOf(roots),
      text: `${progress}% complete${detail ? ` · ${detail}` : ''}`,
      was: null,
      merged: null,
      createdAt: Math.min(...roots.map(task => task.createdAt)),
      changedAt,
      closedAt: closed ? changedAt : null,
      into: null,
    }
  })
  const isNew = (task: Subject) => {
    const seenAt = task.id in missed ? missed[task.id] : lastLookAt
    return seenAt === null || seenAt === undefined || task.changedAt > seenAt
  }
  const isHeld = (task: Subject) => isOpen(task) && heldIds.has(task.id)
  const oldestAskOf = (task: Subject) => (isHeld(task) ? oldestAsk(s.ledger.items, askLinks, task.id) : null)
  const ctx: ListContext = {
    isNew,
    isHeld,
    oldestAskOf,
    running: runningChildren,
    isTurnRunning: s.presence.isTurnRunning,
    now,
  }
  const shown: Subject[] = taskRows.filter(task => isOpen(task) || isNew(task))
  const done = taskRows.filter(task => task.status === 'done' && !isNew(task))
  const rows = partRows(shown, ctx, 0)
  if (done.length > 0)
    rows.push({ kind: 'done-fold', id: 'tasks-done', depth: 0, text: `${done.length} tasks done`, rows: [] })
  const goalParts = goalPage(o, s.ledger.items, tree)
  const head = o?.head ? { title: o.head.title, description: o.head.description || null } : null

  return {
    isEmpty: head === null && rows.length === 0 && goalParts.goal === null && !goalParts.canRestoreGoal,
    head,
    ...goalParts,
    rows,
    error: s.overviewFailure ? STATUS_FAILED : null,
    empty: {
      title: 'Status',
      hint: "What this session's work is for, where each top-level task stands, and what changed.",
    },
  }
}

export function seenSubjectIds(row: StatusRow): string[] {
  return row.kind === 'subject' ? [row.id] : row.kind === 'fold' ? row.subjectIds : []
}

export function statusListRows(page: StatusPage): StatusRow[] {
  return [...(page.goal?.milestones ?? []).flatMap(milestone => milestone.rows), ...page.rows]
}
