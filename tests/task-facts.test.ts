import { expect, test } from 'claude-code/testing'

import { applyTaskPrFacts } from '../hooks/task-facts'
import type { TaskNode, TaskTree } from '../types'

const PR = 'https://github.com/acme/app/pull/7'

function task(id: string, changes: Partial<TaskNode> = {}): TaskNode {
  return {
    id,
    parentId: null,
    status: 'working',
    weight: 1,
    title: id,
    detail: '',
    notes: [],
    createdAt: 1,
    updatedAt: 1,
    history: [],
    ...changes,
  }
}

const facts = (tree: TaskTree, state: 'OPEN' | 'CLOSED' | 'MERGED') => applyTaskPrFacts(tree, { [PR]: state }, 20)

test('a merged linked PR completes the task and records its source and URL', () => {
  const result = facts([task('parent', { links: { pr: PR } })], 'MERGED')

  expect(result.tree[0]).toMatchObject({
    status: 'done',
    updatedAt: 20,
    history: [{ at: 20, source: 'pr', kind: 'completed', detail: PR }],
  })
  expect(result.warnings).toEqual([])
})

test('a merged PR with an open child warns without changing either task', () => {
  const tree = [task('parent', { links: { pr: PR } }), task('child', { parentId: 'parent' })]
  const result = facts(tree, 'MERGED')

  expect(result.tree).toBe(tree)
  expect(result.warnings).toEqual([{ taskId: 'parent', pr: PR, message: 'PR merged, task still open' }])
})

test('a PR closed without merging warns without changing task status or history', () => {
  const tree = [task('parent', { links: { pr: PR } })]
  const result = facts(tree, 'CLOSED')

  expect(result.tree).toBe(tree)
  expect(result.warnings).toEqual([{ taskId: 'parent', pr: PR, message: 'PR closed without merge' }])
})

test('done, dropped and reopened nodes stay unchanged, and a second pass does not complete again', () => {
  const reopened = task('reopened', {
    links: { pr: PR },
    history: [{ at: 2, source: 'pr', kind: 'completed', detail: PR }],
  })
  const tree = [
    task('done', { status: 'done', links: { pr: PR } }),
    task('dropped', { status: 'dropped', links: { pr: PR } }),
    reopened,
  ]
  const skipped = facts(tree, 'MERGED')
  const first = facts([task('once', { links: { pr: PR } })], 'MERGED')
  const second = facts(first.tree, 'MERGED')

  expect(skipped.tree).toBe(tree)
  expect(skipped.warnings).toEqual([])
  expect(second.tree).toBe(first.tree)
  expect(second.warnings).toEqual([])
})
