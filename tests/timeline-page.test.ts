import { expect, test } from 'claude-code/testing'
import {
  COMPLETED_FOLD_ID,
  moveTimelineSelection,
  timelineData,
  timelineBar,
  timelinePage,
  toggleTimelineBranch,
} from '../hooks/timeline-page'
import type { TaskFactWarning, TaskNode, TaskProgressSegments, TaskTree } from '../types'
import { upgradedTimelineFolded } from '../hooks/timeline-state'
import { weightedTaskProgressSegments } from '../hooks/task-tree'
import { taskTreeWithReports } from '../hooks/task-report'

const now = 1_000_000
const task = (id: string, change: Partial<TaskNode> = {}): TaskNode => ({
  id,
  parentId: null,
  status: 'queued',
  weight: 1,
  title: id,
  detail: '',
  notes: [],
  createdAt: now - 60_000,
  updatedAt: now,
  history: [],
  ...change,
})
const segments: TaskProgressSegments = { total: 4, done: 1, working: 1, stalled: 1, waiting: 0, queued: 1 }
const barText = (parts: ReturnType<typeof timelineBar>) => parts.map(part => part.mark.repeat(part.count)).join('')
const queuedBar = (count: number) => [{ state: 'queued', mark: '─', count, tone: 'muted' }]

test('Timeline has an empty state and a not-started progress card without tasks', () => {
  const page = timelineData([], { total: 0, done: 0, working: 0, stalled: 0, waiting: 0, queued: 0 }, {}, [], now)
  expect(page.isEmpty).toBe(true)
  expect(page.empty.title).toBe('Timeline')
  expect(page.progressCard).toMatchObject({
    statusLabel: 'Not started',
    percentLabel: '0.00%',
    leavesDone: 0,
    leavesTotal: 0,
    elapsed: '—',
    segments: { total: 0, done: 0, working: 0, stalled: 0, waiting: 0, queued: 0 },
  })
  expect(timelineBar(page.progressCard.segments, 10)).toEqual(queuedBar(10))
  expect(page.progressCard.bar).toEqual(queuedBar(28))
})

test('Timeline keeps tree order and derives progress, stall age and warnings', () => {
  const root = task('root', { status: 'working', weight: 2 })
  const child = task('child', { parentId: root.id, status: 'working', weight: 1 })
  const warning: TaskFactWarning = {
    taskId: child.id,
    pr: 'https://github.com/a/b/pull/1',
    message: 'PR closed without merge',
  }
  const page = timelineData([root, child], segments, { [child.id]: now - 15 * 60_000 }, [warning], now)

  expect(page.rows.map(row => row.task.id)).toEqual(['root', 'child'])
  expect(page.rows[0]).toMatchObject({ percent: '0.00%', statusLabel: 'In progress' })
  expect(page.rows[1]).toMatchObject({
    depth: 1,
    status: 'stalled',
    statusLabel: 'Stalled',
    percent: '0.00%',
    tone: 'error',
    mark: '✕',
    warnings: [warning.message],
  })
  expect(page.rows[0]?.progressBar.map(part => [part.state, part.count, part.tone])).toEqual([['stalled', 10, 'error']])
})

test('Timeline bars fill the rounded displayed percent before status-colored remaining work', () => {
  const cases: [[number, number, number, number, number, number], number, string, string][] = [
    [[100, 0, 0, 0, 100, 0], 10, '─'.repeat(10), 'error'],
    [[2, 1, 1, 0, 0, 0], 10, '━━━━━─────', 'done key'],
    [[10_000, 6_613, 3_387, 0, 0, 0], 31, '━'.repeat(21) + '─'.repeat(10), 'done key'],
    [[100, 50, 25, 10, 10, 5], 100, '━'.repeat(50) + '─'.repeat(50), 'done key error error muted'],
  ]
  for (const [values, width, marks, tones] of cases) {
    const [total, done, working, stalled, waiting, queued] = values
    const bar = timelineBar({ total, done, working, stalled, waiting, queued }, width)
    expect([barText(bar), bar.map(part => part.tone).join(' ')]).toEqual([marks, tones])
  }
})

test('Timeline child rows use their subtree and omit dropped work from percent and bar', () => {
  const tree: TaskTree = [
    task('parent', { status: 'working' }),
    task('child-done', {
      parentId: 'parent',
      status: 'working',
      weight: 1,
      links: { owner: { agent: 'worker', machine: 'local' } },
    }),
    task('child-waiting', { parentId: 'parent', status: 'waits-on-other', weight: 1 }),
    task('child-dropped', { parentId: 'parent', status: 'dropped', weight: 99 }),
    task('dropped-root', { status: 'dropped', weight: 99 }),
  ]
  const reported = taskTreeWithReports(tree, JSON.stringify({ seq: 1, t: 140, from: 'worker', text: 'DONE shipped' }))
  const active = weightedTaskProgressSegments(reported)
  const page = timelineData(reported, active, {}, [], now)
  const parent = page.rows.find(row => row.task.id === 'parent')!
  const done = page.rows.find(row => row.task.id === 'child-done')!

  expect([parent.percent, page.progressCard.percentLabel, done.percent].join('|')).toBe('50.00%|50.00%|100.00%')
  const bars = [parent.progressBar, timelineBar(page.progressCard.segments, 10), done.progressBar].map(barText)
  expect(bars.join('|')).toBe('━━━━━─────|━━━━━─────|━━━━━━━━━━')
  expect(done).toMatchObject({ statusLabel: 'Completed', percent: '100.00%', completedUnits: { done: 1, total: 1 } })
})

test('Timeline summarizes weighted completion and counts completed leaf tasks', () => {
  const tree: TaskTree = [
    task('plan', { status: 'working', weight: 14 }),
    task('done-a', { parentId: 'plan', status: 'done', weight: 2 }),
    task('done-b', { parentId: 'plan', status: 'done', weight: 1 }),
    task('working', { parentId: 'plan', status: 'working', weight: 5 }),
    task('waiting', { parentId: 'plan', status: 'waits-on-other', weight: 2 }),
    task('queued', { parentId: 'plan', status: 'queued', weight: 4 }),
  ]
  const page = timelineData(tree, { total: 14, done: 3, working: 5, stalled: 0, waiting: 2, queued: 4 }, {}, [], now)

  expect(page.progressCard).toMatchObject({
    statusLabel: 'In progress',
    percentLabel: '21.43%',
    leavesDone: 2,
    leavesTotal: 5,
    elapsed: '1m',
  })
  expect(page.rows[0]?.percent).toBe('21.43%')
  expect(page.rows.find(row => row.task.id === 'done-a')).toMatchObject({
    percent: '100.00%',
    statusLabel: 'Completed',
    tone: 'done',
  })
  expect(page.rows.find(row => row.task.id === 'waiting')).toMatchObject({
    statusLabel: 'Waiting',
    tone: 'error',
    mark: '✕',
  })
})

test('Timeline counts open tasks without counting completed or dropped tasks', () => {
  const tree: TaskTree = [
    task('working', { status: 'working' }),
    task('queued', { status: 'queued' }),
    task('done', { status: 'done' }),
    task('dropped', { status: 'dropped' }),
  ]

  expect(timelineData(tree, segments, {}, [], now).openTasks).toBe(2)
  expect(timelineData([], segments, {}, [], now).openTasks).toBe(0)
})

test('Timeline formats history times in the shared plan', () => {
  const updatedAt = now - 15 * 60_000
  const page = timelineData(
    [
      task('history', {
        updatedAt,
        history: [{ at: updatedAt, source: 'claude', kind: 'updated', detail: 'Started implementation' }],
      }),
    ],
    segments,
    {},
    [],
    now,
  )
  const displayedTask = page.rows[0]!.task

  expect(displayedTask.history).toEqual([
    { source: 'claude', kind: 'updated', detail: 'Started implementation', time: '15m' },
  ])
  expect('updatedAt' in displayedTask).toBe(false)
  expect('createdAt' in displayedTask).toBe(false)
  expect('at' in displayedTask.history[0]!).toBe(false)
})

test('the selected task plan orders labeled details and link actions', () => {
  const detail = timelinePage(
    timelineData(
      [
        task('plan', {
          detail: 'Build the review flow',
          updatedAt: now - 19 * 60_000,
          history: [
            { at: now - 5 * 60_000, source: 'claude', kind: 'updated', detail: 'Added the pane' },
            { at: now - 2 * 60_000, source: 'status', kind: 'created' },
          ],
          links: { pr: 'https://git.example.org/a/b/pull/1' },
        }),
      ],
      segments,
      {},
      [],
      now,
    ),
    'plan',
    [],
    {},
    true,
  ).selected?.details

  expect(detail?.slice(0, 2)).toEqual([
    { label: 'Detail', text: 'Build the review flow' },
    { label: 'History', text: '5m · claude · Added the pane\n2m · status · Task created' },
  ])
  expect(detail?.at(-1)).toMatchObject({ label: 'Links', actions: [{ label: 'Open PR' }] })
})

test('Timeline rows show the newest task text, while selected details retain the full detail and every note', () => {
  const current = task('plan', {
    detail: 'The original plan',
    notes: ['First update', 'Latest update'],
    history: [
      { at: now - 30_000, source: 'agent', kind: 'created' },
      { at: now - 20_000, source: 'agent', kind: 'note', detail: 'First update' },
      { at: now - 10_000, source: 'agent', kind: 'note', detail: 'Latest update' },
    ],
  })
  const page = timelinePage(timelineData([current], segments, {}, [], now), 'plan', [])

  expect(page.selected?.details).toContainEqual({ label: 'Detail', text: 'The original plan' })
  expect(page.selected?.details.filter(line => line.label === 'Note')).toEqual([
    { label: 'Note', text: 'First update' },
    { label: 'Note', text: 'Latest update' },
  ])
})

test('Timeline folds completed roots after open roots and restores selection when expanded', () => {
  expect(upgradedTimelineFolded(['\0inbox:timeline-completed-fold'])).toEqual([])
  const roots: TaskTree = [
    task('one', { status: 'done', streamId: 's1' }),
    task('one-child', { parentId: 'one', status: 'dropped' }),
    task('two', { status: 'working', streamId: 's2' }),
    task('two-child', { parentId: 'two', status: 'done' }),
    task('three', { status: 'waits-on-other', streamId: 's3' }),
  ]
  const data = timelineData(roots, segments, {}, [], now)
  const page = timelinePage(data, 'one', upgradedTimelineFolded(undefined), {}, false, true)

  expect(page.rows.map(row => row.task.id)).toEqual(['two', 'two-child', 'three', COMPLETED_FOLD_ID])
  expect([page.mode, page.selected?.row.task.id]).toEqual(['tree', COMPLETED_FOLD_ID])
  const expanded = timelinePage(data, 'one', [COMPLETED_FOLD_ID], {}, false, true)
  expect(expanded.rows.slice(-3).map(row => row.task.id)).toEqual([COMPLETED_FOLD_ID, 'one', 'one-child'])
  expect(expanded.selected?.row.task.id).toBe('one')
  expect(moveTimelineSelection(page.rows, 'three', 1)).toBe(COMPLETED_FOLD_ID)
  expect(toggleTimelineBranch([], 'one')).toEqual(['one'])
  expect(toggleTimelineBranch(['one'], 'one')).toEqual([])
})

test('Timeline keeps the whole tree and uses the first row for unknown selection moves', () => {
  const roots: TaskTree = [
    task('one', { status: 'done', streamId: 's1' }),
    task('two', { status: 'working', streamId: 's2' }),
    task('three', { status: 'waits-on-other', streamId: 's3' }),
  ]
  const page = timelinePage(timelineData(roots, segments, {}, [], now), 'missing', [])

  expect(page.mode).toBe('tree')
  expect(page.rows.map(row => row.task.id)).toEqual(['one', 'two', 'three'])
  expect(page.selected?.row.task.id).toBe('one')
  expect(moveTimelineSelection(page.rows, 'three', 1)).toBe('one')
  expect(moveTimelineSelection(page.rows, 'missing', 1)).toBe('two')
  expect(moveTimelineSelection(page.rows, 'missing', -1)).toBe('three')
})

test('Timeline hides no open roots and shows one row when all roots are finished', () => {
  const page = (tree: TaskTree) =>
    timelinePage(timelineData(tree, segments, {}, [], now), null, upgradedTimelineFolded(undefined), {}, false, true)
  expect(page([task('open')]).rows.some(row => row.isCompletedFold)).toBe(false)
  const finished = page([task('done', { status: 'done' }), task('dropped', { status: 'dropped' })])
  expect(finished.rows.map(row => row.task.id)).toEqual([COMPLETED_FOLD_ID])
})

test('Timeline keeps finished roots inline unless the completed fold is enabled', () => {
  const tree = [task('open')]
  const data = timelineData(
    [task('open'), task('done', { status: 'done' }), task('dropped', { status: 'dropped' })],
    segments,
    {},
    [],
    now,
  )
  const page = timelinePage(data, null, upgradedTimelineFolded(undefined))
  const mainRows = timelineData(tree, segments, {}, [], now).rows
  const mainRowsWithoutFoldOption = mainRows.map(({ isCompletedFold: _isCompletedFold, ...row }) => ({
    ...row,
    hasVisibleChildren: false,
    treeLead: '     ',
    detailLead: '     ',
    actions: [
      {
        action: 'detail',
        id: 'open',
        label: 'Open details',
        hotkey: 'enter',
        kind: 'view',
        emphasis: 'normal',
      },
    ],
  }))

  expect(page.rows.map(row => row.task.id)).toEqual(['open', 'done', 'dropped'])
  expect(page.rows.some(row => row.isCompletedFold)).toBe(false)
  expect(page.completedRootIds).toEqual([])
  expect(timelinePage(timelineData(tree, segments, {}, [], now), null, []).rows).toEqual(mainRowsWithoutFoldOption)
})

test('folding a selected parent hides its children and keeps the parent selected', () => {
  const tree = [task('root'), task('child', { parentId: 'root' }), task('leaf', { parentId: 'child' })]
  const data = timelineData(tree, segments, {}, [], now)
  const page = timelinePage(data, 'leaf', ['root'])

  expect(page.rows.map(row => row.task.id)).toEqual(['root'])
  expect(page.rows[0]).toMatchObject({ hasChildren: true, hasVisibleChildren: false })
  expect(page.selected?.row.task.id).toBe('root')
})

test('top-level Timeline tasks do not add guide columns to each other or their children', () => {
  const tree = [
    task('first-root'),
    task('first-child', { parentId: 'first-root' }),
    task('last-child', { parentId: 'first-root' }),
    task('second-root'),
  ]
  const rows = timelineData(tree, segments, {}, [], now).rows

  expect(rows.map(row => [row.task.id, row.depth, row.guides, row.prefix])).toEqual([
    ['first-root', 0, [], ''],
    ['first-child', 1, [], '├─ '],
    ['last-child', 1, [], '└─ '],
    ['second-root', 0, [], ''],
  ])
  const rootDetail = timelinePage(timelineData(tree, segments, {}, [], now), 'second-root', [], {}, true).selected
  expect(rootDetail?.row.detailLead).not.toMatch(/[│├└]/)
  const page = timelinePage(timelineData(tree, segments, {}, [], now), 'first-root', [])
  expect(page.rows.map(row => [row.task.id, row.treeLead])).toEqual([
    ['first-root', '  │  '],
    ['first-child', '     '],
    ['last-child', '     '],
    ['second-root', '     '],
  ])
})

test('Timeline preserves long Japanese titles and guide paths across deep, wide trees', () => {
  const title = '日本語の長いタイトルを狭い画面で折り返して状態表示とツリーガイドを保つ確認用タスク'
  const tree: TaskTree = [
    task('root'),
    ...Array.from({ length: 7 }, (_, index) =>
      task(`sibling-${index}`, { parentId: 'root', title: `兄弟タスク ${index}` }),
    ),
    task('deep-one', { parentId: 'sibling-0' }),
    task('deep-two', { parentId: 'deep-one' }),
    task('deep-three', { parentId: 'deep-two', title }),
  ]
  const page = timelinePage(timelineData(tree, segments, {}, [], now), 'deep-three', [])
  const row = page.rows.find(item => item.task.id === 'deep-three')!

  expect(page.rows).toHaveLength(11)
  expect(row.task.title).toBe(title)
  expect(row.depth).toBe(4)
  expect(row.guides).toHaveLength(3)
  expect(row.prefix).toContain('│')
  expect(row.prefix.endsWith('└─ ')).toBe(true)
  expect(page.selected?.row.task.id).toBe('deep-three')
})

test('Timeline plans joined guides through deep branches and aligns both detail examples', () => {
  const tree = [
    task('root', { detail: 'Coordinate the review.' }),
    task('first', { parentId: 'root', status: 'done', detail: 'Draw the task plan header.' }),
    task('middle', { parentId: 'root', status: 'working', detail: '選択した項目を復元する。' }),
    task('leaf-one', { parentId: 'middle', status: 'done' }),
    task('leaf-two', { parentId: 'middle', status: 'queued' }),
    task('last', { parentId: 'root', status: 'queued' }),
  ]
  const data = timelineData(tree, segments, {}, [], now)
  const root = timelinePage(data, 'root', [])
  const child = timelinePage(data, 'first', [])

  expect(root.rows.map(row => [row.task.id, row.guides, row.prefix])).toEqual([
    ['root', [], ''],
    ['first', [], '├─ '],
    ['middle', [], '├─ '],
    ['leaf-one', ['│  '], '│  ├─ '],
    ['leaf-two', ['│  '], '│  └─ '],
    ['last', [], '└─ '],
  ])
  expect(child.rows.map(row => [row.task.id, row.prefix])).toEqual(root.rows.map(row => [row.task.id, row.prefix]))
  expect(root.selected?.row.detailLead).toBe('  │  ')
  expect(child.selected?.row.detailLead).toBe('  │     ')
  expect(timelinePage(data, 'middle', []).selected?.row.detailLead).toBe('  │  │  ')
  expect(timelinePage(data, 'root', ['middle']).rows.map(row => [row.task.id, row.detailLead])).toEqual([
    ['root', '  │  '],
    ['first', '  │     '],
    ['middle', '  │     '],
    ['last', '        '],
  ])
})

test('Timeline plans detail and branch actions in tree order and a back action in detail', () => {
  const tree = [task('root'), task('branch', { parentId: 'root' }), task('leaf', { parentId: 'branch' })]
  const page = timelinePage(timelineData(tree, segments, {}, [], now), 'root', [])

  expect(page.rows.find(row => row.task.id === 'root')?.actions.map(action => action.action)).toEqual([
    'detail',
    'toggle-branch',
  ])
  expect(page.rows.find(row => row.task.id === 'branch')?.actions.map(action => action.action)).toEqual(['select'])
  expect(page.rows.find(row => row.task.id === 'leaf')?.actions.map(action => action.action)).toEqual(['select'])
  const detail = timelinePage(timelineData(tree, segments, {}, [], now), 'root', [], {}, true)
  expect(detail.mode).toBe('detail')
  expect(detail.selected?.row.actions.map(action => action.action)).toEqual(['back'])
  expect(detail.selected?.stats).toEqual({ progress: '0.00%', weight: '1', completedUnits: '0 / 1' })
})
