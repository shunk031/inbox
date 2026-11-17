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

  expect(page.rows.map(row => row.kind)).toEqual(['root', 'progress', 'root', 'task', 'agent', 'agent'])
  expect(page.rows[0]?.text).toContain('linux/meta')
  expect(page.rows[2]?.text).toContain('This session · meta ·')
  expect(page.rows[3]).toMatchObject({ status: 'stalled' })
  expect(page.rows[3]?.text).toContain('idle 15m+')
  expect(page.rows[4]).toMatchObject({ status: 'working' })
  expect(page.rows[4]?.text).toContain('reviewer · working ·')
  expect(page.rows[5]?.text).toContain('No task linked')
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

  const agent = page.rows.find(row => row.kind === 'agent')
  expect(agent?.text).toContain('Local assignment')
  expect(agent?.text).not.toContain('Remote assignment')
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

  expect(page.rows[0]).toMatchObject({ kind: 'root', status: 'stale' })
  expect(page.rows[0]?.text).toContain('2h')
  expect(cellWidth(page.rows[0]!.text)).toBeLessThanOrEqual(18)
  expect(page.rows[0]?.text).not.toContain('working')
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
  expect(page.rows[1]?.text.endsWith('…')).toBe(true)
  expect(cellWidth(page.rows[1]!.text)).toBeLessThanOrEqual(18)

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
  expect(await pane.find({ text: /reviewer · working/ })).toBeDefined()
})
