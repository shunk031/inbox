const NOW = Date.now()
export const PLUGIN_STORE = 'inbox_inline-7e8589075f50.json'
export const HEIGHT = 50
export const SCENARIOS = ['empty', 'busy']
export const VIEWS = ['asks', 'timeline', 'prs', 'timeline-detail', 'asks-detail', 'help']
const widths = [200, 110]
const task = (id, parentId, title, status, detail = '', notes = []) => ({
  id,
  parentId,
  title,
  status,
  weight: 1,
  detail,
  notes,
  createdAt: NOW - 60_000,
  updatedAt: NOW - 10_000,
  history: [{ at: NOW - 60_000, source: 'fixture', kind: 'created' }],
})
const wrappedTitle = '折り返し用の日本語タイトルと子の説明'
const timelineDetailWidths = [87, ...widths]
const tasks = [
  [
    'snapshot-root',
    null,
    `Snapshot root ${'日本語のレイアウト確認 '.repeat(12)}`,
    'working',
    'An invented root task with a long CJK title.',
    ['The root task has a stable note.'],
  ],
  ['snapshot-wrap', 'snapshot-root', wrappedTitle, 'done', 'A completed child task.'],
  [
    'snapshot-long',
    'snapshot-root',
    `Snapshot long ${'表示幅とセル位置を確かめる '.repeat(12)}`,
    'working',
    'An invented long task for truncation.',
  ],
  ['snapshot-deep', 'snapshot-long', '深い階層の待機中タスク', 'waits-on-other', 'A nested waiting task.'],
].map(fields => task(...fields))
const ledger = () => ({
  ...Object.fromEntries(
    'items unrecordedDecisions closed findings closedFindings untrackedWork prs'.split(' ').map(key => [key, []]),
  ),
  overview: null,
  prOrder: null,
  nextId: 1,
  turn: 0,
  batchTurn: 0,
  updates: 0,
})
const question = {
  id: 'snapshot-question',
  kind: 'question',
  label: '1',
  ask: 'Snapshot question: should this invented panel keep its CJK labels?',
  context: 'A neutral fixture exercises a long, wrapped question.',
  detail: 'The report and question are invented test data.',
  options: ['Keep the labels', 'Shorten the labels'],
  optionDescriptions: { 'Keep the labels': 'Preserves the invented labels for this example.' },
  rec: 'Keep the labels',
  helps: [],
  turn: 1,
  at: NOW - 30_000,
  from: 'record',
}
const reportQuestion = empty => ({
  ...question,
  id: empty ? 'snapshot-empty-report' : 'snapshot-report-question',
  ask: empty ? 'Snapshot empty report' : 'Snapshot report question',
  document: `tests/render-snapshots/report-${empty ? 'empty' : 'busy'}.md`,
  documentPreview: empty ? undefined : '日本語の要約を表示するための作られた抜粋。',
})
const report = empty => ({
  id: empty ? 'snapshot-empty-report' : 'snapshot-report',
  kind: 'issue',
  title: empty ? 'Snapshot empty report' : 'Snapshot report with long Japanese content',
  detail: empty ? '' : 'An invented issue opens a neutral Markdown report.',
  path: null,
  document: `tests/render-snapshots/report-${empty ? 'empty' : 'busy'}.md`,
  documentPreview: empty ? undefined : '日本語の要約を表示するための作られた抜粋。',
  at: NOW - 30_000,
})
const pr = {
  ref: 'sample/repo#24',
  number: 24,
  title: 'Snapshot pull request with an invented CJK summary',
  url: 'https://github.com/sample/repo/pull/24',
  isDraft: false,
  state: 'OPEN',
  base: 'main',
  mergeable: 'MERGEABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  checks: [],
  threads: [],
  isYours: true,
  wasSeenOpen: true,
  error: null,
  fetchedAt: NOW,
}
const shift = (value, by) =>
  Array.isArray(value)
    ? value.map(item => shift(item, by))
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            typeof item === 'number' && (key === 'at' || key.endsWith('At')) ? item + by : shift(item, by),
          ]),
        )
      : value
export function fixtureState(fixture) {
  if (fixture.startsWith('help-')) fixture = `base-${fixture.slice(5)}`
  const state = {
    version: 1,
    savedAt: NOW,
    ledger: ledger(),
    taskTree: [],
    prViews: { views: {}, branchRef: null, isFetching: false, isGhMissing: true },
    isHelpShown: false,
  }
  const data = state.ledger
  if (fixture === 'base-busy' || fixture === 'fold-done' || fixture === 'asks-busy') {
    Object.assign(data, {
      items:
        fixture === 'asks-busy'
          ? [
              {
                ...question,
                id: 'snapshot-no-background',
                ask: 'Snapshot question without background',
                context: undefined,
                detail: undefined,
              },
              { ...question, detail: undefined },
            ]
          : [question],
      findings: [report(false)],
      prs: [pr.ref],
      updates: 1,
      turn: 1,
      batchTurn: 1,
      nextId: fixture === 'asks-busy' ? 3 : 2,
    })
    const finished = task('snapshot-finished-root', null, 'Snapshot finished root', 'done')
    state.taskTree = fixture === 'fold-done' ? [...tasks, finished] : tasks
    state.prViews = { ...state.prViews, views: { [pr.ref]: pr }, isGhMissing: false }
  } else if (fixture.startsWith('timeline-detail-layout')) {
    const detail = '狭い画面でも左端と折り返し位置を確認する中立的な説明です。'.repeat(3)
    const note = '配置確認用のメモです。'
    const split87 = fixture.endsWith('-87')
    const item = task('snapshot-detail-layout', null, 'Snapshot timeline detail', 'working', detail, [note])
    item.history.push(
      { at: NOW - (split87 ? 10_000 : 30_000), source: 'fixture', kind: 'note', detail: note },
      { at: NOW - (split87 ? 30_000 : 10_000), source: 'fixture', kind: 'detail' },
    )
    state.taskTree = [item]
  } else if (fixture === 'detail-empty' || fixture === 'detail-busy') {
    const empty = fixture === 'detail-empty'
    state.taskTree = empty ? [task('snapshot-detail-empty', null, 'Snapshot detail empty', 'working')] : tasks
    data.items = [reportQuestion(empty)]
  } else if (fixture !== 'base-empty') throw Error(`Unknown fixture: ${fixture}`)
  return shift(state, Date.now() - NOW)
}
export const registry = [
  ...VIEWS.flatMap(view =>
    SCENARIOS.flatMap(scenario => [
      ...widths.map(width => ({
        view,
        scenario,
        width,
        fixture:
          view === 'asks' && scenario === 'busy'
            ? 'asks-busy'
            : view === 'help'
              ? `help-${scenario}`
              : view.endsWith('-detail')
                ? `detail-${scenario}`
                : `base-${scenario}`,
        file: `${view}-${scenario}-${width}.txt`,
      })),
      ...(view === 'asks'
        ? [
            {
              view,
              scenario,
              width: 87,
              fixture: scenario === 'busy' ? 'asks-busy' : `base-${scenario}`,
              file: `asks-${scenario}-87.txt`,
            },
          ]
        : []),
    ]),
  ),
]
const foldDone = { view: 'timeline', scenario: 'fold-done', fixture: 'fold-done' }
registry.push(...widths.map(width => ({ ...foldDone, width, file: `timeline-fold-done-${width}.txt` })))
registry.push(
  ...timelineDetailWidths.map(width => ({
    view: 'timeline-detail',
    scenario: 'layout',
    fixture: width === 87 ? 'timeline-detail-layout-87' : 'timeline-detail-layout',
    width,
    ...(width === 87 ? { terminalWidth: 196 } : {}),
    file: `timeline-detail-layout-${width}.txt`,
  })),
)
