import { cellWidth } from '../hooks/text.ts'
import { registry } from './render-snapshots-fixtures.mjs'

export const marker = entry =>
  ({
    asks: entry.scenario === 'empty' ? 'Nothing needed' : 'Snapshot question',
    timeline: entry.scenario === 'empty' ? 'No tasks have been recorded' : 'Snapshot root',
    agents: entry.scenario === 'empty' ? 'Orchestrators' : 'Meta tasks',
    prs: entry.scenario === 'empty' ? 'No PRs' : 'Snapshot pull request',
    'timeline-detail': 'Snapshot',
    'asks-detail': 'Snapshot',
    help: 'Keys',
  })[entry.view]

export const pageMarker = (frame, text) => frame.replace(/\s+/gu, ' ').includes(text)
const col = (line, index) => cellWidth(line.slice(0, index))
const detailColumns = { 110: [19, 21], 200: [27, 29, 52, 54] }
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
    const root = lines.find(line => line.includes('Snapshot root'))
    const titleCol = root ? col(root, root.indexOf('Snapshot root')) : 6
    const status = root && lines.slice(lines.indexOf(root) + 1).find(line => /^\s+│\s+In progress\s*$/u.test(line))
    if (!root) add('snapshot-root title', 6, 'missing', 'required title row absent')
    else if (titleCol !== 6) add('snapshot-root title', 6, titleCol, 'title starts outside fixture column')
    if (entry.width === 200 && root && (!/[━─]/u.test(root) || !root.includes('50.00%')))
      add('snapshot-root bar', 'title line', 'next line or missing', 'bar and percentage must share the title line')
    if (!status) add('snapshot-root chip', titleCol, 'missing', 'required chip absent')
    else {
      const chip = col(status, status.indexOf('In progress') - 1)
      if (chip !== titleCol) add('snapshot-root chip', titleCol, chip, 'chip does not start on its title column')
    }
    if (entry.width === 200) {
      const long = lines.find(line => line.includes('Snapshot long'))
      const ellipsis = long?.indexOf('…') ?? -1
      const bar = ellipsis < 0 ? -1 : long.slice(ellipsis + 1).search(/[━─]/u)
      if (bar < 0)
        add('snapshot-long bar', 'title line after ellipsis', 'next line or missing', 'bar is not on the title line')
      else {
        const gap = col(long, ellipsis + 1 + bar) - col(long, ellipsis) - cellWidth('…')
        if (gap < 2)
          add(
            'snapshot-long ellipsis gap',
            'ellipsis end + 2',
            col(long, ellipsis + 1 + bar),
            `bar gap is ${gap} cells`,
          )
      }
    }
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
  const chip = lines.findIndex(line => /^\s+│\s+In progress\s*$/u.test(line))
  if (chip >= 0) lines[chip] = lines[chip].replace(/^ /u, '')
  const long = timeline.frame.split('\n').find(line => line.includes('Snapshot long'))
  const asks = frames.get('asks-empty-110.txt')
  const names = new Set(registry.map(entry => entry.file))
  const missing = new Set(names)
  missing.delete('timeline-busy-200.txt')
  const extra = new Set(names)
  extra.add('timeline-busy-201.txt')
  const proofs = [
    [
      'chip moved one cell',
      chip < 0 ? null : check(lines.join('\n')).find(line => line.includes('chip does not start')),
    ],
    [
      'required label removed',
      check(timeline.frame.replace('Progress', '         ')).find(line => line.includes('required label absent')),
    ],
    [
      'gap after ellipsis removed',
      long &&
        check(timeline.frame.replace(long, long.replace(/… {2,}(?=[━─])/u, '…'))).find(line =>
          line.includes('bar gap'),
        ),
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
