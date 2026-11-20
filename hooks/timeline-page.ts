import type {
  LastAction,
  TaskFactWarning,
  TaskHistoryEvent,
  TaskNode,
  TaskProgressSegments,
  TaskStatusMismatch,
  TaskTree,
} from '../types'
import { prMarkId } from './pr-rows'
import { shortAgo } from './rows'
import { weightedTaskProgress, weightedTaskProgressSegments } from './task-tree'
import { currentTaskText } from './task-text'
import type { CurrentTaskText } from './task-text'
import type { PrAction } from './pr-press'
import type { ActionView } from './rows'
import { COMPLETED_FOLD_ID, timelineCompletedFolded } from './timeline-state'

export type TimelineState = 'done' | 'working' | 'stalled' | 'waiting' | 'queued' | 'dropped'
export type TimelineTone = 'done' | 'key' | 'error' | 'muted'
export { COMPLETED_FOLD_ID }
type TimelineBarPart = {
  state: keyof Omit<TaskProgressSegments, 'total'>
  mark: string
  count: number
  tone: TimelineTone
}
type TimelineHistoryEvent = Omit<TaskHistoryEvent, 'at'> & { time: string }
type TimelineTask = Omit<TaskNode, 'createdAt' | 'updatedAt' | 'history'> & {
  updatedAgo: string
  currentText: (CurrentTaskText & { ago: string }) | null
  history: TimelineHistoryEvent[]
}
type TimelineRowAction = Pick<ActionView, 'label' | 'hotkey' | 'kind' | 'emphasis'> & {
  action: 'select' | 'detail' | 'toggle-branch' | 'back'
  id: string
}
type TimelineLinkAction = PrAction & { result: LastAction['result'] | null }
type TimelineDetailLine =
  | { label: 'Current' | 'Detail' | 'Updated' | 'Note' | 'History'; text: string }
  | { label: 'Links'; actions: TimelineLinkAction[] }
type TimelineStats = { progress: string; weight: string; completedUnits: string }
type TimelineNode = {
  task: TimelineTask
  depth: number
  guides: string[]
  prefix: string
  treeLead: string
  detailLead: string
  hasLaterSibling: boolean
  hasChildren: boolean
  hasVisibleChildren: boolean
  progress: number
  percent: string
  progressBar: TimelineBarPart[]
  completedUnits: { done: number; total: number }
  status: TimelineState
  statusLabel: string
  tone: TimelineTone
  mark: string
  alternate: boolean
  warnings: string[]
  isCompletedFold?: boolean
  actions: TimelineRowAction[]
}
type TimelineProgressCard = {
  status: TimelineState
  statusLabel: string
  tone: TimelineTone
  percent: number
  percentLabel: string
  leavesDone: number
  leavesTotal: number
  elapsed: string
  bar: TimelineBarPart[]
}
type TimelineBase = {
  isEmpty: boolean
  openTasks: number
  empty: { title: string; hint: string }
  progressCard: TimelineProgressCard
}
type TimelineDataRow = Omit<TimelineNode, 'actions' | 'treeLead' | 'detailLead' | 'hasVisibleChildren'>
export type TimelineData = TimelineBase & { rows: TimelineDataRow[] }
export type TimelinePage = TimelineBase & {
  mode: 'tree' | 'detail'
  completedRootIds: string[]
  rows: TimelineNode[]
  selected: {
    row: TimelineNode
    stats: TimelineStats
    details: TimelineDetailLine[]
    links: TimelineLinkAction[]
  } | null
}

const BAR_MARKS: Record<TimelineBarPart['state'], string> = {
  done: '━',
  working: '━',
  stalled: '━',
  waiting: '━',
  queued: '─',
}
const BAR_TONES: Record<TimelineBarPart['state'], TimelineTone> = {
  done: 'done',
  working: 'key',
  stalled: 'error',
  waiting: 'error',
  queued: 'muted',
}
const BAR_STATES = Object.keys(BAR_MARKS) as TimelineBarPart['state'][]
const HISTORY_TEXT: Record<TaskHistoryEvent['kind'], string> = {
  created: 'Task created',
  updated: 'Task updated',
  moved: 'Task moved',
  completed: 'Task completed',
  detail: 'Task detail updated',
  note: 'Note added',
  imported: 'Task imported',
}

function timelineTask(task: TaskNode, now: number): TimelineTask {
  const { createdAt: _createdAt, updatedAt, history, ...details } = task
  const current = currentTaskText(task)
  return {
    ...details,
    updatedAgo: shortAgo(now - updatedAt),
    currentText: current ? { ...current, ago: shortAgo(now - current.at) } : null,
    history: history.map(({ at, ...event }) => ({ ...event, time: shortAgo(now - at) })),
  }
}

function percent(value: number): { value: number; label: string } {
  const rounded = Math.round(value * 10000) / 100
  return { value: rounded, label: `${rounded.toFixed(2)}%` }
}

function timelineBar(segments: TaskProgressSegments, width: number): TimelineBarPart[] {
  if (segments.total <= 0) return []
  let cumulative = 0
  let drawn = 0
  return BAR_STATES.flatMap(state => {
    cumulative += segments[state]
    const end = Math.round((cumulative / segments.total) * width)
    const count = Math.max(0, end - drawn)
    drawn = end
    return count > 0 ? [{ state, mark: BAR_MARKS[state], count, tone: BAR_TONES[state] }] : []
  })
}

function taskStatus(task: TaskNode, stalled: ReadonlySet<string>): TimelineState {
  if (stalled.has(task.id)) return 'stalled'
  if (task.status === 'done' || task.status === 'dropped') return task.status
  return task.status === 'working' ? 'working' : task.status === 'waits-on-other' ? 'waiting' : 'queued'
}

export function timelineStatusPresentation(status: TimelineState): { label: string; tone: TimelineTone; mark: string } {
  switch (status) {
    case 'done':
      return { label: 'Completed', tone: 'done', mark: '●' }
    case 'working':
      return { label: 'In progress', tone: 'key', mark: '◐' }
    case 'waiting':
      return { label: 'Waiting', tone: 'error', mark: '✕' }
    case 'stalled':
      return { label: 'Stalled', tone: 'error', mark: '✕' }
    case 'dropped':
      return { label: 'Dropped', tone: 'muted', mark: '○' }
    default:
      return { label: 'Not started', tone: 'muted', mark: '○' }
  }
}

function completedLeaves(tree: TaskTree, rootIds?: string | readonly string[]): { done: number; total: number } {
  const children = new Map<string | null, TaskNode[]>()
  for (const task of tree) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task])
  const count = { done: 0, total: 0 }
  const visit = (task: TaskNode, isDone: boolean) => {
    if (task.status === 'dropped') return
    const done = isDone || task.status === 'done'
    const activeChildren = (children.get(task.id) ?? []).filter(child => child.status !== 'dropped')
    if (activeChildren.length === 0) {
      count.total++
      if (done) count.done++
      return
    }
    for (const child of activeChildren) visit(child, done)
  }
  const roots =
    rootIds === undefined
      ? (children.get(null) ?? [])
      : tree.filter(task => (Array.isArray(rootIds) ? rootIds.includes(task.id) : task.id === rootIds))
  for (const root of roots) visit(root, false)
  return count
}

function progressStatus(segments: TaskProgressSegments): TimelineState {
  if (segments.stalled > 0) return 'stalled'
  if (segments.working > 0 || (segments.done > 0 && segments.done < segments.total)) return 'working'
  if (segments.waiting > 0) return 'waiting'
  if (segments.total > 0 && segments.done >= segments.total) return 'done'
  return 'queued'
}

export function timelineData(
  tree: TaskTree,
  segments: TaskProgressSegments,
  stalledSince: Record<string, number>,
  warnings: readonly TaskFactWarning[],
  now: number,
  taskStatusMismatches: readonly TaskStatusMismatch[] = [],
): TimelineData {
  const children = new Map<string | null, TaskNode[]>()
  for (const task of tree) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task])
  const stalled = new Set(Object.keys(stalledSince))
  const mismatchByTask = new Map(
    taskStatusMismatches.map(mismatch => [
      mismatch.taskId,
      `Task status mismatch: agent says ${mismatch.claim}; saved status is ${mismatch.savedStatus}`,
    ]),
  )
  const rows: TimelineDataRow[] = []
  const visit = (siblings: TaskNode[], depth: number, guides: string[]) => {
    siblings.forEach((task, index) => {
      const childrenOfTask = children.get(task.id) ?? []
      const hasLaterSibling = index < siblings.length - 1
      const connector = depth === 0 ? '' : hasLaterSibling ? '├─ ' : '└─ '
      const status = taskStatus(task, stalled)
      const presentation = timelineStatusPresentation(status)
      const progress = percent(weightedTaskProgress(tree, task.id))
      const completedUnits = completedLeaves(tree, task.id)
      rows.push({
        task: timelineTask(task, now),
        depth,
        guides,
        prefix: `${guides.join('')}${connector}`,
        hasLaterSibling,
        hasChildren: childrenOfTask.length > 0,
        progress: progress.value,
        percent: progress.label,
        progressBar: timelineBar(weightedTaskProgressSegments(tree, stalled, task.id), 10),
        completedUnits,
        status,
        statusLabel: presentation.label,
        tone: presentation.tone,
        mark: presentation.mark,
        alternate: rows.length % 2 === 1,
        warnings: [
          ...warnings.filter(warning => warning.taskId === task.id).map(warning => warning.message),
          ...(mismatchByTask.has(task.id) ? [mismatchByTask.get(task.id)!] : []),
        ],
      })
      visit(childrenOfTask, depth + 1, depth === 0 ? guides : [...guides, hasLaterSibling ? '│  ' : '   '])
    })
  }
  visit(children.get(null) ?? [], 0, [])

  const overall = percent(weightedTaskProgress(tree))
  const state = progressStatus(segments)
  const presentation = timelineStatusPresentation(state)
  const leaves = completedLeaves(tree)
  const firstCreated = tree.reduce<number | null>(
    (first, task) => (first === null ? task.createdAt : Math.min(first, task.createdAt)),
    null,
  )

  return {
    isEmpty: tree.length === 0,
    openTasks: tree.filter(task => task.status !== 'done' && task.status !== 'dropped').length,
    empty: { title: 'Timeline', hint: 'No tasks have been recorded for this session.' },
    progressCard: {
      status: state,
      statusLabel: presentation.label,
      tone: presentation.tone,
      percent: overall.value,
      percentLabel: overall.label,
      leavesDone: leaves.done,
      leavesTotal: leaves.total,
      elapsed: firstCreated === null ? '—' : shortAgo(now - firstCreated),
      bar: timelineBar(segments, 28),
    },
    rows,
  }
}

function timelineLinkPlan(
  task: Pick<TimelineTask, 'links'>,
  lastActions: Record<string, LastAction>,
): TimelineLinkAction[] {
  return (['pr', 'issue'] as const).flatMap(kind => {
    const url = task.links?.[kind]
    if (!url) return []
    const result = lastActions[prMarkId(url)]?.result ?? null
    return [
      {
        press: { action: 'pr-open' as const, ref: url },
        label: kind === 'pr' ? 'Open PR' : 'Open issue',
        kind: 'local' as const,
        emphasis: 'normal' as const,
        icon: 'open' as const,
        isOut: result?.state === 'pending',
        result,
      },
    ]
  })
}

export function timelinePage(
  data: TimelineData,
  selectedId: string | null,
  folded: readonly string[],
  lastActions: Record<string, LastAction> = {},
  isDetailOpen = false,
  foldCompleted = false,
): TimelinePage {
  const nodes = new Map(data.rows.map(row => [row.task.id, row]))
  const foldedIds = new Set(folded)
  const completedFolded = foldCompleted && timelineCompletedFolded(folded)
  const rootById = new Map<string, string>()
  const finishedByRoot = new Map<string, boolean>()
  if (foldCompleted) {
    for (const row of data.rows) {
      const root = row.depth ? rootById.get(row.task.parentId!)! : row.task.id
      rootById.set(row.task.id, root)
      const finished = row.task.status === 'done' || row.task.status === 'dropped'
      finishedByRoot.set(root, (finishedByRoot.get(root) ?? true) && finished)
    }
  }
  const completedRootIds = [...finishedByRoot].flatMap(([id, done]) => (done ? [id] : []))
  const completedRoots = new Set(completedRootIds)
  const completedRows = data.rows.filter(row => completedRoots.has(rootById.get(row.task.id)!))
  const activeRows = data.rows.filter(row => !completedRoots.has(rootById.get(row.task.id)!))
  const summary: TimelineDataRow | null = completedRootIds.length
    ? {
        ...data.rows[0]!,
        task: {
          ...data.rows[0]!.task,
          id: COMPLETED_FOLD_ID,
          parentId: null,
          status: 'done',
          title: `${completedRootIds.length} completed`,
          detail: '',
          notes: [],
          updatedAgo: '',
          currentText: null,
          history: [],
          links: {},
        },
        depth: 0,
        guides: [],
        prefix: '',
        hasLaterSibling: false,
        hasChildren: false,
        progress: 100,
        percent: '100.00%',
        progressBar: [],
        completedUnits: { done: completedRootIds.length, total: completedRootIds.length },
        status: 'done',
        statusLabel: 'Completed',
        tone: 'done',
        mark: completedFolded ? '▸' : '▾',
        alternate: false,
        warnings: [],
        isCompletedFold: true,
      }
    : null
  const orderedRows = foldCompleted
    ? [...activeRows, ...(summary ? [summary] : []), ...(completedFolded ? [] : completedRows)]
    : data.rows
  const visibleRows = orderedRows.filter(row => {
    if (row.isCompletedFold) return true
    let parent = row.task.parentId
    while (parent !== null) {
      if (foldedIds.has(parent)) return false
      parent = nodes.get(parent)?.task.parentId ?? null
    }
    return true
  })
  const visibleParents = new Set(visibleRows.flatMap(row => (row.task.parentId ? [row.task.parentId] : [])))
  const rows = visibleRows.map(row => {
    const hasVisibleChildren = visibleParents.has(row.task.id)
    const childGuide = hasVisibleChildren ? '│  ' : '   '
    const siblingGuide = row.hasLaterSibling || row.depth > 0 ? (row.hasLaterSibling ? '│  ' : '   ') : ''
    return {
      ...row,
      hasVisibleChildren,
      treeLead: `  ${row.guides.join('')}${childGuide}`,
      detailLead: `  ${row.guides.join('')}${siblingGuide}${childGuide}`,
    }
  })
  let selected = rows.find(row => row.task.id === selectedId)
  if (!selected && selectedId) {
    const root = rootById.get(selectedId)
    if (completedFolded && root && completedRoots.has(root)) selected = rows.find(row => row.isCompletedFold)
    let parent = nodes.get(selectedId)?.task.parentId ?? null
    while (parent !== null && !selected) {
      selected = rows.find(row => row.task.id === parent)
      parent = nodes.get(parent)?.task.parentId ?? null
    }
  }
  selected ??= rows[0]
  const drawnRows = rows.map(row => {
    const isSelected = row.task.id === selected?.task.id
    const isFolded = foldedIds.has(row.task.id)
    const actions: TimelineRowAction[] = row.isCompletedFold
      ? [
          {
            action: 'toggle-branch',
            id: COMPLETED_FOLD_ID,
            label: completedFolded ? 'Show completed' : 'Hide completed',
            hotkey: 'enter',
            kind: 'view',
            emphasis: 'quiet',
          },
        ]
      : isDetailOpen && isSelected
        ? [
            {
              action: 'back',
              id: row.task.id,
              label: 'Back to timeline',
              hotkey: 'b',
              kind: 'view',
              emphasis: 'normal',
            },
          ]
        : [
            ...(isSelected
              ? [
                  {
                    action: 'detail' as const,
                    id: row.task.id,
                    label: 'Open details',
                    hotkey: 'enter',
                    kind: 'view' as const,
                    emphasis: 'normal' as const,
                  },
                ]
              : [
                  {
                    action: 'select' as const,
                    id: row.task.id,
                    label: 'Select',
                    hotkey: 'enter',
                    kind: 'view' as const,
                    emphasis: 'normal' as const,
                  },
                ]),
            ...(isSelected && row.hasChildren
              ? [
                  {
                    action: 'toggle-branch' as const,
                    id: row.task.id,
                    label: isFolded ? 'Open branch' : 'Close branch',
                    hotkey: isFolded ? 'l' : 'h',
                    kind: 'view' as const,
                    emphasis: 'quiet' as const,
                  },
                ]
              : []),
          ]
    return { ...row, actions }
  })
  const selectedRow = selected ? drawnRows.find(row => row.task.id === selected!.task.id)! : null
  const selectedLinks = selectedRow ? timelineLinkPlan(selectedRow.task, lastActions) : []
  const details: TimelineDetailLine[] = selectedRow
    ? [
        ...(selectedRow.task.currentText && selectedRow.task.currentText.text !== selectedRow.task.detail
          ? [
              {
                label: 'Current' as const,
                text: `${selectedRow.task.currentText.text} · ${selectedRow.task.currentText.ago}`,
              },
            ]
          : []),
        ...(selectedRow.task.detail ? [{ label: 'Detail' as const, text: selectedRow.task.detail }] : []),
        ...selectedRow.task.notes.map(text => ({ label: 'Note' as const, text })),
        ...selectedRow.task.history.map(event => ({
          label: 'History' as const,
          text: `${event.time} · ${event.source} · ${event.kind === 'note' ? HISTORY_TEXT.note : (event.detail ?? HISTORY_TEXT[event.kind])}`,
        })),
        ...(selectedLinks.length ? [{ label: 'Links' as const, actions: selectedLinks }] : []),
      ]
    : []
  const taskProgress = selectedRow ? percent(selectedRow.progress / 100) : null
  const units = selectedRow?.completedUnits ?? null
  const stats = selectedRow?.isCompletedFold
    ? { progress: selectedRow.percent, weight: '—', completedUnits: `${units?.done ?? 0} / ${units?.total ?? 0}` }
    : selectedRow && taskProgress && units
      ? {
          progress: taskProgress.label,
          weight: String(Number(selectedRow.task.weight.toFixed(1))),
          completedUnits: `${units.done} / ${units.total}`,
        }
      : null

  return {
    ...data,
    mode: isDetailOpen && selectedRow && !selectedRow.isCompletedFold ? 'detail' : 'tree',
    completedRootIds,
    rows: drawnRows,
    selected: selectedRow && stats ? { row: selectedRow, stats, details, links: selectedLinks } : null,
  }
}

export function moveTimelineSelection(
  rows: readonly TimelineNode[],
  selectedId: string | null,
  step: number,
): string | null {
  if (rows.length === 0) return null
  const selected = rows.findIndex(row => row.task.id === selectedId)
  const at = selectedId === null ? -1 : Math.max(0, selected)
  const to = (at + step + rows.length) % rows.length
  return rows[to]!.task.id
}

export function toggleTimelineBranch(folded: readonly string[], id: string): string[] {
  return folded.includes(id) ? folded.filter(value => value !== id) : [...folded, id]
}
