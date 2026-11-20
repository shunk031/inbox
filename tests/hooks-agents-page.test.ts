import { expect, mock, test } from 'claude-code/testing'
import { agentsAttentionCount, agentsPage, type AgentsPageInput } from '../hooks/agents-page'
import { cellWidth } from '../hooks/text'
import { tabBadge } from '../hooks/tabs'
import type { Finding, TaskNode, TaskProgressSegments, TaskTree } from '../types'
import { w, world } from './hooks-world'
import { PANE } from './hooks-helpers'

const now = 1_000_000
const progress: TaskProgressSegments = { total: 2, done: 0, working: 1, stalled: 1, waiting: 0, queued: 0 }
const task = (change: Partial<TaskNode> = {}): TaskNode => ({
  id: 'review',
  parentId: null,
  status: 'working',
  weight: 1,
  title: '日本語の長いレビュー作業を続ける',
  detail: '',
  notes: [],
  createdAt: now - 60_000,
  updatedAt: now,
  history: [],
  ...change,
})
const feed = (change: Partial<Finding> = {}): Finding => ({
  id: 'root-row',
  kind: 'progress',
  title: 'Meta root',
  detail: 'Working',
  path: null,
  at: now - 60_000,
  feedKey: 'herdr/linux/meta',
  feedOwned: true,
  ...change,
})

test('Agents plan covers each row kind, weighted progress, owner links, and stalled owners', () => {
  const tree: TaskTree = [task({ links: { owner: { machine: 'linux', agent: 'reviewer' } } })]
  const page = agentsPage(
    {
      feedRows: [feed(), feed({ id: 'feed-progress', feedKey: 'subagent/build', title: 'Build', detail: 'Started' })],
      taskTree: tree,
      ownerFacts: { '["linux","reviewer"]': { state: 'idle', since: now - 15 * 60_000 } },
      progress,
      localAgents: [
        { machine: 'linux', name: 'reviewer', status: 'working' },
        { machine: 'linux', name: 'idle-agent', status: 'idle' },
      ],
      now,
    },
    100,
  )

  expect(page.groups.map(group => group.row.text)).toEqual(['Orchestrators', 'Meta tasks', 'Local agents'])
  expect(page.groups[0]?.rows.map(row => row.text)).toEqual([
    expect.stringContaining('linux/meta'),
    expect.stringContaining('Build'),
  ])
  expect(page.groups[0]?.rows[0]).toMatchObject({
    kind: 'root',
    depth: 1,
    hasLaterSibling: true,
    owner: { machine: 'linux', agent: 'meta' },
  })
  const meta = page.groups[1]!.rows
  const review = meta.find(row => row.key === 'review')!
  const reviewer = meta.find(row => row.kind === 'agent')!
  expect(meta[0]?.text).toContain('This session · meta ·')
  expect(review).toMatchObject({ status: 'stalled', depth: 2, owner: { machine: 'linux', agent: 'reviewer' } })
  expect(review.text).toContain('idle 15m+')
  expect(reviewer).toMatchObject({ status: 'working', depth: 3, owner: { machine: 'linux', agent: 'reviewer' } })
  expect(reviewer.text).toBe('reviewer')
  expect(page.groups[2]?.rows[0]?.text).toBe('idle-agent')
})

test('Agents plan links a local agent only to the task with the same machine and name', () => {
  const page = agentsPage(
    {
      feedRows: [],
      taskTree: [
        task({
          id: 'other-machine',
          title: 'Remote assignment',
          links: { owner: { machine: 'remote', agent: 'reviewer' } },
        }),
        task({
          id: 'local-machine',
          status: 'queued',
          updatedAt: now - 60_000,
          title: 'Local assignment',
          links: { owner: { machine: 'linux', agent: 'reviewer' } },
        }),
      ],
      ownerFacts: {},
      progress,
      localAgents: [{ machine: 'linux', name: 'reviewer', status: 'idle' }],
      now,
    },
    120,
  )

  const localTask = page.groups[1]?.rows.find(row => row.key === 'local-machine')
  const remoteTask = page.groups[1]?.rows.find(row => row.key === 'other-machine')
  const agent = page.groups[1]?.rows.find(row => row.kind === 'agent')
  expect(agent?.depth).toBe(localTask!.depth + 1)
  expect(agent?.owner).toEqual({ machine: 'linux', agent: 'reviewer' })
  expect(remoteTask).toMatchObject({ hasLaterSibling: true })
  expect(localTask?.text).toContain('Local assignment')
})

test('Agents tree keeps feed, task-tree, and Herdr order without duplicating rows', () => {
  const page = agentsPage(
    {
      feedRows: [feed({ id: 'feed-first' }), feed({ id: 'feed-second', feedKey: 'herdr/linux/worker' })],
      taskTree: [
        task({ id: 'task-first', title: 'First task' }),
        task({ id: 'task-child', parentId: 'task-first', title: 'Child task' }),
        task({ id: 'task-second', title: 'Second task' }),
      ],
      ownerFacts: {},
      progress,
      localAgents: [
        { machine: 'local', name: 'agent-first', status: 'idle' },
        { machine: 'local', name: 'agent-second', status: 'working' },
      ],
      now,
    },
    120,
  )
  const ids = page.groups.flatMap(group => group.rows.map(row => `${row.kind}:${row.key}`))
  expect(new Set(ids).size).toBe(ids.length)
  expect(page.groups[0]?.rows.map(row => row.key)).toEqual(['feed-first', 'feed-second'])
  expect(page.groups[1]?.rows.filter(row => row.kind === 'root' || row.kind === 'task').map(row => row.key)).toEqual([
    'meta-root',
    'task-first',
    'task-child',
    'task-second',
  ])
  expect(page.groups[1]?.rows.find(row => row.key === 'task-child')?.depth).toBe(
    page.groups[1]?.rows.find(row => row.key === 'task-first')?.depth! + 1,
  )
  expect(page.groups[2]?.rows.map(row => row.key)).toEqual(['["local","agent-first"]', '["local","agent-second"]'])
})

test('Agents root rows show a two-hour-old patrol as stale before the feed expires', () => {
  const page = agentsPage(
    {
      feedRows: [feed({ at: now - 2 * 60 * 60_000, ownerFact: { state: 'working', since: now - 2 * 60 * 60_000 } })],
      taskTree: [],
      ownerFacts: {},
      progress: { total: 0, done: 0, working: 0, stalled: 0, waiting: 0, queued: 0 },
      localAgents: [],
      now,
    },
    18,
  )

  expect(page.groups[0]?.rows[0]).toMatchObject({ kind: 'root', status: 'stale' })
  expect(page.groups[0]?.rows[0]?.text).toContain('2h')
  expect(cellWidth(page.groups[0]!.rows[0]!.text)).toBeLessThanOrEqual(18)
  expect(page.groups[0]?.rows[0]?.text).not.toContain('working')
})

test('Agents tab badge counts stalled, blocked, and stale rows and hides zero', () => {
  const input = {
    feedRows: [
      feed({ at: now - 16 * 60_000, ownerFact: { state: 'working', since: now - 16 * 60_000 } }),
      feed({
        id: 'blocked-root',
        feedKey: 'herdr/linux/blocked',
        at: now - 60_000,
        ownerFact: { state: 'blocked', since: now },
      }),
    ],
    taskTree: [task({ id: 'stalled', links: { owner: { machine: 'linux', agent: 'stalled-agent' } } })],
    ownerFacts: { '["linux","stalled-agent"]': { state: 'idle', since: now - 15 * 60_000 } },
    progress,
    localAgents: [{ machine: 'linux', name: 'blocked-agent', status: 'blocked' }],
    now,
  } satisfies AgentsPageInput
  const counts = { needsYou: 0, findings: 0, prs: 0 }
  const attentionCount = agentsAttentionCount(input)

  expect(attentionCount).toBe(4)
  expect(tabBadge('agents', counts, attentionCount)).toBe('4')
  expect(tabBadge('agents', counts)).toBeNull()
})

test('Agents plan clips long Japanese titles by terminal cell width and reports an empty tree', () => {
  const page = agentsPage(
    {
      feedRows: [],
      taskTree: [task()],
      ownerFacts: {},
      progress,
      localAgents: [],
      now,
    },
    18,
  )
  const taskRow = page.groups[1]!.rows.find(row => row.key === 'review')!
  expect(taskRow.text.endsWith('…')).toBe(true)
  expect(cellWidth(taskRow.text)).toBeLessThanOrEqual(18)

  const empty = agentsPage(
    {
      feedRows: [],
      taskTree: [],
      ownerFacts: {},
      progress: { total: 0, done: 0, working: 0, stalled: 0, waiting: 0, queued: 0 },
      localAgents: [],
      now,
    },
    20,
  )
  expect(empty.empty).toContain('No roots')
})

test('terminal pane draws the demo Agents page and keeps other host tabs out', async ($, on) => {
  const clock = mock.clock(on, { now })
  world($, on, [])
  w.files = ['/.next-build']
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inbox', args: 'demo' } as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-key-agents' })
  await clock.settle()
  expect(await pane.find({ text: /workstation\/meta/ })).toBeDefined()
  expect(await pane.find({ text: /Review the Japanese copy/ })).toBeDefined()
  expect(await pane.find({ text: /reviewer/ })).toBeDefined()
})
