import { cellWidth } from '../hooks/text.ts'
import { registry } from './render-snapshots-fixtures.mjs'

export const marker = entry =>
  ({
    asks: entry.scenario === 'empty' ? 'Nothing needed' : 'Snapshot question',
    timeline: entry.scenario === 'empty' ? 'No tasks have been recorded' : 'Snapshot',
    agents: entry.scenario === 'empty' ? 'Orchestrators' : 'Meta tasks',
    prs: entry.scenario === 'empty' ? 'No PRs' : 'Snapshot pull request',
    'timeline-detail': 'Snapshot',
    'asks-detail': 'Snapshot',
    help: 'Keys',
  })[entry.view]

export const pageMarker = (frame, text) => frame.replace(/\s+/gu, ' ').includes(text)
const col = (line, index) => cellWidth(line.slice(0, index))
const detailColumns = { 110: [19, 21], 200: [27, 29, 52, 54] }
const TREE_STATUS_LABELS = ['In progress', 'Not started', 'Completed', 'Waiting', 'Stalled', 'Dropped']
const TREE_STATUS_LABEL_CELLS = Math.max(...TREE_STATUS_LABELS.map(label => label.length))
const TREE_STATUS_CHIP_CELLS = TREE_STATUS_LABEL_CELLS + 2
const taskLabel = line => TREE_STATUS_LABELS.find(label => line.includes(label))
const isTaskLine = line => taskLabel(line) && /\d+\.\d{2}%/u.test(line)
export const failure = (entry, row, expected, actual, reason) =>
  `FAIL view=${entry.view} scenario=${entry.scenario} width=${entry.width} row=${row} ` +
  `expected-column=${expected} actual-column=${actual} ${reason}`

export function checkFrame(entry, frame, width) {
  const errors = []
  const lines = frame.split('\n')
  const add = (...args) => errors.push(failure(entry, ...args))

  lines.forEach((line, i) => {
    const cells = cellWidth(line)
    if (cells > width) add(`line-${i + 1}`, `<=${width}`, cells, 'row exceeds pane width')
  })

  const required =
    entry.view === 'timeline' ? ['Progress', marker(entry)] : entry.view === 'help' ? ['Keys', 'Tabs'] : [marker(entry)]
  for (const text of required)
    if (!pageMarker(frame, text)) add(`required:${text}`, 0, 'missing', 'required label absent')

  const tree = entry.view === 'timeline'
  lines.forEach((line, row) => {
    for (const match of line.matchAll(/│/g)) {
      const at = col(line, match.index)
      const border = at === 1 || at === cellWidth(line) - 1
      const inTree = at >= 4 && at <= 14
      const listGuide = ['asks', 'agents'].includes(entry.view) && at === 3
      const statsRow = entry.view === 'timeline-detail' && /Progress|Weight|Completed units|%/u.test(line)
      const statsDivider = statsRow && detailColumns[entry.width].includes(at)
      const allowed = tree ? border || inTree : border || listGuide || statsDivider
      if (!allowed)
        add(
          `line-${row + 1}`,
          tree ? 'tree gutter columns 4–14' : 'no tree guide',
          at,
          tree ? 'tree guide outside fixture gutter' : 'stray │ outside tree gutter',
        )
    }
  })

  if (entry.view === 'timeline' && entry.scenario === 'busy') {
    const taskRows = lines.filter(isTaskLine)
    if (taskRows.length !== 4) add('task rows', 4, taskRows.length, 'expected every fixture task in the tree')
    const titleColumns = new Map()
    const percentColumns = []
    const barColumns = []
    taskRows.forEach((line, index) => {
      const label = taskLabel(line)
      const labelIndex = line.indexOf(label)
      const chipStart = col(line, labelIndex - 1)
      const chipEnd = col(line, labelIndex + TREE_STATUS_LABEL_CELLS + 1)
      if (chipEnd - chipStart !== TREE_STATUS_CHIP_CELLS)
        add(`task-${index + 1} chip`, TREE_STATUS_CHIP_CELLS, chipEnd - chipStart, 'status chip width is not fixed')
      const titleIndex = labelIndex + TREE_STATUS_LABEL_CELLS + 2
      const titleColumn = col(line, titleIndex)
      if (line[titleIndex] === undefined || line[titleIndex] === ' ')
        add(`task-${index + 1} title`, 'immediately after the fixed chip', 'blank', 'title does not follow the chip')
      const connectorIndex = line.search(/[├└]─/u)
      const depth = connectorIndex < 0 ? 0 : Math.floor(col(line, connectorIndex) / 3)
      const priorTitleColumn = titleColumns.get(depth)
      if (priorTitleColumn !== undefined && titleColumn !== priorTitleColumn)
        add(`depth-${depth} titles`, priorTitleColumn, titleColumn, 'titles at this tree depth do not share a column')
      else titleColumns.set(depth, titleColumn)

      const percent = line.match(/\d+\.\d{2}%/u)
      if (percent) percentColumns.push(col(line, line.indexOf(percent[0]) + percent[0].length))
      const barOffset = line.slice(titleIndex).search(/[━─]/u)
      if (barOffset >= 0) {
        const barIndex = titleIndex + barOffset
        barColumns.push(col(line, barIndex))
        const ellipsisIndex = line.indexOf('…', titleIndex)
        if (ellipsisIndex >= 0) {
          const gap = col(line, barIndex) - col(line, ellipsisIndex + 1)
          if (gap < 2)
            add(`task-${index + 1} ellipsis gap`, 'ellipsis end + 2', col(line, barIndex), `bar gap is ${gap} cells`)
        }
      }
    })
    if (new Set(percentColumns).size > 1)
      add(
        'task percent columns',
        percentColumns[0],
        percentColumns.at(-1),
        'task percentages do not share an ending column',
      )
    if (new Set(barColumns).size > 1)
      add('task bar columns', barColumns[0], barColumns.at(-1), 'task bars do not share a starting column')
  }

  if (entry.view === 'timeline-detail') {
    const header = lines.find(line => line.includes('Back') && line.includes('Snapshot'))
    if (!header) add('detail header', 'Back + title', 'missing', 'detail header absent')
    else {
      const back = header.indexOf('Back')
      const title = header.indexOf('Snapshot')
      const gap = col(header, title) - col(header, back) - cellWidth('Back')
      if (gap !== 1) add('Back control gap', 'Back end + 1', col(header, title), `observed gap is ${gap} cells`)
    }
  }
  return errors
}

const describe = name => {
  const entry = registry.find(item => item.file === name)
  if (entry) return entry
  const match = name.match(/^([a-z-]+)-(empty|busy)-(\d+)\.txt$/u)
  return match
    ? { view: match[1], scenario: match[2], width: Number(match[3]) }
    : { view: name.split('-')[0], scenario: 'unknown', width: Number(name.match(/-(\d+)\.txt$/u)?.[1] ?? 0) }
}

export function inventoryErrors(expected, actual) {
  const errors = []
  for (const name of expected)
    if (!actual.has(name))
      errors.push(failure(describe(name), 'snapshot inventory', name, 'missing', 'baseline missing'))
  for (const name of actual)
    if (!expected.has(name))
      errors.push(failure(describe(name), 'snapshot inventory', 'no extra baseline', name, 'unreferenced baseline'))
  return errors
}

export function runMutationProofs(frames) {
  const timeline = frames.get('timeline-busy-200.txt')
  const check = frame => checkFrame(timeline.entry, frame, timeline.paneWidth)
  const lines = timeline.frame.split('\n')
  const rootIndex = lines.findIndex(line => line.includes('Snapshot') && isTaskLine(line))
  const root = rootIndex < 0 ? '' : lines[rootIndex]
  const rootLabel = taskLabel(root)
  const titleIndex = rootLabel ? root.indexOf(rootLabel) + TREE_STATUS_LABEL_CELLS + 2 : -1
  if (rootIndex >= 0 && titleIndex >= 0) lines[rootIndex] = `${root.slice(0, titleIndex)} ${root.slice(titleIndex)}`
  const asks = frames.get('asks-empty-110.txt')
  const names = new Set(registry.map(entry => entry.file))
  const missing = new Set(names)
  missing.delete('timeline-busy-200.txt')
  const extra = new Set(names)
  extra.add('timeline-busy-201.txt')
  const row = (prefix, label, title, percent, isLong = false) => {
    const chip = ` ${label.padEnd(TREE_STATUS_LABEL_CELLS)} `
    const titleText = isLong ? `${title}…` : title
    const barColumn = 75
    const head = `${prefix}${chip} ${titleText}`.padEnd(barColumn - 2)
    return `${head}  ━━━━━━━━━━`.padEnd(90) + percent.padStart(7)
  }
  const wideFrame = [
    'Progress · Snapshot',
    row('  > ◐ ', 'In progress', 'Snapshot root', '50.00%'),
    row('    ├─ ● ', 'Completed', 'Wrap', '100.00%'),
    row('    └─ ◐ ', 'In progress', 'Snapshot long', '0.00%', true),
    row('       └─ ✕ ', 'Waiting', 'Deep', '0.00%'),
  ].join('\n')
  const checkWide = frame => checkFrame(timeline.entry, frame, 100)
  const proofs = [
    [
      'chip moved one cell',
      rootIndex < 0 ? null : check(lines.join('\n')).find(line => line.includes('title does not follow the chip')),
    ],
    [
      'required label removed',
      check(timeline.frame.replace('Progress', '         ')).find(line => line.includes('required label absent')),
    ],
    [
      'gap after ellipsis removed',
      checkWide(wideFrame.replace(/… +(?=[━─])/u, '…')).find(line => line.includes('bar gap')),
    ],
    [
      'stray tree guide inserted',
      checkFrame(asks.entry, `│${asks.frame}`, asks.paneWidth).find(line => line.includes('stray │')),
    ],
    ['baseline deleted', inventoryErrors(names, missing).find(line => line.includes('timeline-busy-200.txt'))],
    ['extra baseline added', inventoryErrors(names, extra).find(line => line.includes('unreferenced baseline'))],
  ]
  for (const [name, line] of proofs) {
    if (!line) throw Error(`mutation proof did not fail: ${name}`)
    process.stdout.write(`PROOF ${name}: ${line}\n`)
  }
}
