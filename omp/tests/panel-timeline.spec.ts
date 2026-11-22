import { expect, test } from 'bun:test'

import { prMarkId } from '../../hooks/pr-rows'
import { cellWidth } from '../../hooks/text'
import { entriesOf } from '../src/panel-entries'
import { INITIAL_UI } from '../src/panel'
import type { PanelUi } from '../src/panel'
import { handleKey } from '../src/panel-keys'
import { wrapTimelineDetailText } from '../src/panel-draw'
import { drawn, ESC, NOW, strip, taskNode, taskScreen, text } from './panel-harness'

test('Timeline draws the shared card and two-line rows, then opens and returns from task detail', () => {
  const empty = taskScreen([])
  const emptyText = text(empty, { ...INITIAL_UI, tab: 'timeline' })
  expect(emptyText).toContain('Progress')
  expect(emptyText).toContain('Not started')
  expect(emptyText).toContain('No tasks have been recorded for this session.')

  const root = taskNode('root', 'Build the view', 'working', NOW - 60_000, {
    detail: 'Keep the task-tree view compact.',
  })
  root.links = {
    pr: 'https://git.example.org/example/project/pull/4',
    issue: 'https://git.example.org/example/project/issues/7',
  }
  root.notes = ['Preserve the title.']
  root.history = [
    { at: NOW - 60_000, source: 'agent', kind: 'updated', detail: 'Added the panel view.' },
    { at: NOW, source: 'agent', kind: 'note', detail: 'Preserve the title.' },
  ]
  const first = taskNode('first', 'Read the design', 'done', NOW - 60_000, { parentId: 'root' })
  const second = taskNode('second', 'Draw the panel', 'queued', NOW, { parentId: 'root' })
  const screen = taskScreen([root, first, second])
  screen.view.timeline.rows[0]!.warnings.push('PR merged, task still open')
  const ui: PanelUi = { ...INITIAL_UI, tab: 'timeline', timelineSelection: 'root', selectedId: 'root', pageTop: 3 }
  const rootLine = entriesOf(screen, ui, 'timeline', NOW).find(
    entry => entry.kind === 'row' && entry.line.id === 'root',
  )
  expect(rootLine?.kind === 'row' ? rootLine.line.buttons.map(button => button.label) : []).toEqual([
    'Open details',
    'Close branch',
  ])
  const childLine = entriesOf(screen, ui, 'timeline', NOW).find(
    entry => entry.kind === 'row' && entry.line.id === 'first',
  )
  expect(childLine?.kind === 'row' ? childLine.line.buttons.map(button => button.label) : []).toEqual(['Select'])
  const tree = strip(text(screen, ui, 100))
  expect(tree).toContain('Progress')
  expect(tree).toContain('In progress')
  expect(tree).toContain('leaf tasks completed')
  expect(tree).toContain('Elapsed: 1m')
  expect(tree).toContain('Build the view')
  expect(tree).toContain('Completed')
  expect(tree).toContain('Not started')
  expect(tree).toContain('PR merged, task still open')
  expect(tree).not.toContain('Keep the task-tree view compact.')
  expect(tree).not.toContain('Open PR')
  expect(drawn(screen, ui, 100).some(line => line.includes(`${ESC}42m`) && line.includes('In progress'))).toBe(true)

  const opened = handleKey(screen, ui, 'enter', NOW).ui
  expect(opened.timelineDetailOpen).toBe(true)
  expect(opened.timelineTreeTop).toBe(3)
  expect(opened.pageTop).toBe(0)
  const detail = strip(text(screen, opened, 100))
  expect([detail.match(/History/g)?.length, detail.split('\n').includes('Current')]).toEqual([1, false])
  const labels = ['Progress', 'Weight', 'Leaf tasks completed', 'Detail', 'Note', 'History', 'Links']
  const positions = labels.map(label => detail.indexOf(label))
  expect(positions.every(position => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((left, right) => left - right))
  expect(detail).toContain('Build the view')
  expect(detail).toContain('Keep the task-tree view compact.')
  expect(detail).toContain('Preserve the title.')
  const noteEvent = detail.split('\n').find(line => line.includes('Note added')) ?? ''
  expect(noteEvent).toContain('Note added')
  expect(noteEvent).not.toContain('Preserve the title.')
  expect(detail.split('\n').filter(line => /Added the panel view\.|Note added/.test(line))).toHaveLength(2)
  expect(detail).toContain('Open PR')
  expect(detail).toContain('Open issue')
  expect(detail).not.toContain('Read the design')

  const backed = handleKey(screen, opened, 'b', NOW).ui
  expect(backed.timelineDetailOpen).toBe(false)
  expect(backed.timelineSelection).toBe('root')
  expect(backed.pageTop).toBe(3)
  expect(strip(text(screen, backed, 100))).toContain('Read the design')
  expect(handleKey(screen, ui, 'h', NOW).ui.timelineFolded).toEqual(['root'])
})

test('a selected child detail page draws its own title and stats without the tree', () => {
  const root = taskNode('root', 'Root', 'working')
  const child = taskNode('child', 'Child', 'queued', NOW, { parentId: 'root', detail: 'Child detail.' })
  const screen = taskScreen([root, child])
  const ui: PanelUi = {
    ...INITIAL_UI,
    tab: 'timeline',
    timelineSelection: 'child',
    selectedId: 'child',
    timelineDetailOpen: true,
  }
  const detail = strip(text(screen, ui, 120))
  expect(detail).toContain('Child')
  expect(detail).toContain('Not started')
  expect(detail).toContain('Child detail.')
  expect(detail).not.toContain('> ● Root')
})

test('Timeline keeps Japanese titles and detail, and wraps mixed Japanese/ASCII latest reports', () => {
  const longTitle = '日本語の長いタイトルを狭い画面でも状態と進捗を保ちながら読みやすく折り返す確認用のタスク'
  const longDetail =
    'この詳細は幅が狭くてもツリーガイドの内側で読みやすく折り返され、二行目も同じ字下げ位置から続きます。'.repeat(3)
  const root = taskNode('root', '親タスク', 'working', NOW, { detail: '親の詳細。' })
  const child = taskNode('child', longTitle, 'working', NOW, { parentId: 'root', detail: longDetail })
  const sibling = taskNode('sibling', '兄弟タスク', 'queued', NOW, { parentId: 'root' })
  const screen = taskScreen([root, child, sibling])
  const treeUi: PanelUi = { ...INITIAL_UI, tab: 'timeline', timelineSelection: 'child', selectedId: 'child' }
  const treeLines = text(screen, treeUi, 110).split('\n')

  expect(treeLines.every(line => cellWidth(line) <= 110)).toBe(true)
  expect(treeLines.some(line => line.includes(`├─ ◐ ${longTitle.slice(0, 8)}`))).toBe(true)
  expect(treeLines.some(line => line.includes('In progress'))).toBe(true)
  expect(treeLines.some(line => line.includes('0.00%'))).toBe(true)
  expect(treeLines.some(line => /^\s{8,}[^\s]/.test(line) && /[ぁ-んァ-ヶ一-龯]/.test(line))).toBe(true)

  const detailUi = { ...treeUi, timelineDetailOpen: true }
  const detailLines = text(screen, detailUi, 110).split('\n')
  expect(detailLines.every(line => cellWidth(line) <= 110)).toBe(true)
  const detailAt = detailLines.findIndex(line => line.includes(longDetail.slice(0, 8)))
  expect(detailAt).toBeGreaterThan(-1)
  expect(detailLines[detailAt + 1]?.startsWith('      ')).toBe(true)
  expect(wrapTimelineDetailText('誤検出 0、worker korch がユーザーに返す。', 24)).toContain('worker korch がユーザー')
})

test('Timeline j and k select the tasks they land on, and Enter opens the selected task', () => {
  const screen = taskScreen([taskNode('root', 'Root', 'working'), taskNode('child', 'Child', 'queued')])
  let ui: PanelUi = { ...INITIAL_UI, tab: 'timeline', selectedId: 'root', timelineSelection: 'root' }
  const plannedSelect = (id: string) => {
    const line = entriesOf(screen, ui, 'timeline', NOW).find(entry => entry.kind === 'row' && entry.line.id === id)
    return line?.kind === 'row'
      ? line.line.buttons.find(button => button.press.action === 'timeline-select' && button.press.id === id)
      : undefined
  }

  expect(plannedSelect('child')?.label).toBe('Select')
  ui = handleKey(screen, ui, 'j', NOW).ui
  expect(ui.timelineSelection).toBe('child')
  expect(plannedSelect('root')?.label).toBe('Select')
  ui = handleKey(screen, ui, 'k', NOW).ui
  expect(ui.timelineSelection).toBe('root')
  expect(handleKey(screen, ui, 'enter', NOW).ui.timelineDetailOpen).toBe(true)
})

test('Timeline link open results stay in task detail', () => {
  const root = taskNode('root', 'Root', 'working')
  const pr = 'https://git.example.org/example/project/pull/4'
  const issue = 'https://git.example.org/example/project/issues/7'
  root.links = { pr, issue }
  const screen = taskScreen([root])
  const ui: PanelUi = {
    ...INITIAL_UI,
    tab: 'timeline',
    selectedId: 'root',
    timelineSelection: 'root',
    timelineDetailOpen: true,
  }
  screen.view.lastActions[prMarkId(pr)] = {
    kind: 'local',
    action: 'pr-open',
    text: 'Open PR',
    at: NOW,
    result: { state: 'pending', at: NOW, parts: [{ kind: 'open', name: 'PR #4', error: null, isCommand: false }] },
  }
  expect(
    text(screen, ui)
      .split('\n')
      .some(line => line.includes('Opening…')),
  ).toBe(true)

  screen.view.lastActions[prMarkId(pr)] = {
    kind: 'local',
    action: 'pr-open',
    text: 'Open PR',
    at: NOW,
    result: { state: 'done', at: NOW, parts: [{ kind: 'open', name: 'PR #4', error: null, isCommand: false }] },
  }
  screen.view.lastActions[prMarkId(issue)] = {
    kind: 'local',
    action: 'pr-open',
    text: 'Open issue',
    at: NOW,
    result: {
      state: 'failed',
      at: NOW,
      parts: [{ kind: 'open', name: 'Issue #7', error: 'no browser', isCommand: false }],
    },
  }
  const lines = text(screen, ui).split('\n')
  expect(lines.some(line => line.includes('Open PR') && line.includes('✓ Opened'))).toBe(true)
  expect(lines.some(line => line.includes('Open issue') && line.includes('no browser'))).toBe(true)
  expect(lines.filter(line => line.includes('no browser'))).toHaveLength(1)
  const rawLines = drawn(screen, ui)
  expect(rawLines.some(line => line.includes(`${ESC}35m`) && line.includes('no browser'))).toBe(true)
})
