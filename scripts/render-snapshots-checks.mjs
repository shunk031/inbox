import { cellWidth } from '../hooks/text.ts'
import { registry } from './render-snapshots-fixtures.mjs'

const checks = {
  marker: ({ view, scenario }) =>
    ({
      asks: scenario === 'empty' ? 'Nothing needed' : 'Snapshot question',
      timeline: scenario === 'empty' ? 'No tasks have been recorded' : 'Snapshot root',
      agents: scenario === 'empty' ? 'Orchestrators' : 'Meta tasks',
      prs: scenario === 'empty' ? 'No PRs' : 'Snapshot pull request',
      'timeline-detail': 'Snapshot',
      'asks-detail': 'Snapshot',
      help: 'Keys',
    })[view],
  pageMarker: (frame, text) => frame.replace(/\s+/gu, ' ').includes(text),
  col: (line, index) => cellWidth(line.slice(0, index)),
  failure: (e, row, expected, actual, reason) =>
    `FAIL view=${e.view} scenario=${e.scenario} width=${e.width} row=${row} expected-column=${expected} actual-column=${actual} ${reason}`,
  checkFrame(entry, frame, width) {
    const errors = [],
      lines = frame.split('\n'),
      add = (...args) => errors.push(checks.failure(entry, ...args))
    lines.forEach((line, i) => {
      const cells = cellWidth(line)
      if (cells > width) add(`line-${i + 1}`, `<=${width}`, cells, 'row exceeds pane width')
    })
    const required =
      entry.view === 'timeline'
        ? ['Progress', checks.marker(entry)]
        : entry.view === 'help'
          ? ['Keys', 'Tabs']
          : [checks.marker(entry)]
    for (const text of required)
      if (!checks.pageMarker(frame, text)) add(`required:${text}`, 0, 'missing', 'required label absent')
    const tree = entry.view === 'timeline'
    lines.forEach((line, row) => {
      for (const match of line.matchAll(/│/g)) {
        const at = checks.col(line, match.index)
        if (
          tree
            ? at !== 1 && at !== cellWidth(line) - 1 && (at < 4 || at > 14)
            : !(
                (['asks', 'agents'].includes(entry.view) && at === 3) ||
                (['prs', 'timeline-detail'].includes(entry.view) && (at === 1 || at === width - 1)) ||
                at !== 0
              )
        )
          add(
            `line-${row + 1}`,
            tree ? 'tree gutter columns 4–14' : 'no tree guide',
            at,
            tree ? 'tree guide outside fixture gutter' : 'stray │ outside tree gutter',
          )
      }
    })
    if (entry.view === 'timeline' && entry.scenario === 'busy') {
      const root = lines.find(line => line.includes('Snapshot root')),
        titleCol = root ? checks.col(root, root.indexOf('Snapshot root')) : 6
      const status = lines.slice(lines.indexOf(root) + 1).find(line => /^\s+│\s+In progress\s*$/u.test(line))
      if (!root) add('snapshot-root title', 6, 'missing', 'required title row absent')
      else if (titleCol !== 6) add('snapshot-root title', 6, titleCol, 'title starts outside fixture column')
      if (entry.width === 200 && root && (!/[━─]/u.test(root) || !root.includes('50.00%')))
        add('snapshot-root bar', 'title line', 'next line or missing', 'bar and percentage must share the title line')
      if (!status) add('snapshot-root chip', titleCol, 'missing', 'required chip absent')
      else {
        const chip = checks.col(status, status.indexOf('In progress') - 1)
        if (chip !== titleCol) add('snapshot-root chip', titleCol, chip, 'chip does not start on its title column')
      }
      if (entry.width === 200) {
        const long = lines.find(line => line.includes('Snapshot long')),
          ellipsis = long?.indexOf('…') ?? -1
        const barAt = ellipsis < 0 ? -1 : long.slice(ellipsis + 1).search(/[━─]/u)
        if (barAt < 0)
          add('snapshot-long bar', 'title line after ellipsis', 'next line or missing', 'bar is not on the title line')
        else {
          const gap = checks.col(long, ellipsis + 1 + barAt) - checks.col(long, ellipsis) - cellWidth('…')
          if (gap < 2)
            add(
              'snapshot-long ellipsis gap',
              'ellipsis end + 2',
              checks.col(long, ellipsis + 1 + barAt),
              `bar gap is ${gap} cells`,
            )
        }
      }
    }
    if (entry.view === 'timeline-detail') {
      const header = lines.find(line => line.includes('Back') && line.includes('Snapshot'))
      if (!header) add('detail header', 'Back + title', 'missing', 'detail header absent')
      else {
        const back = header.indexOf('Back'),
          title = header.indexOf('Snapshot'),
          gap = checks.col(header, title) - checks.col(header, back) - cellWidth('Back')
        if (gap !== 1)
          add('Back control gap', 'Back end + 1', checks.col(header, title), `observed gap is ${gap} cells`)
      }
    }
    return errors
  },
  inventoryErrors(expected, actual) {
    const errors = [],
      describe = name => {
        const e = registry.find(item => item.file === name),
          m = name.match(/^([a-z-]+)-(empty|busy)-(\d+)\.txt$/u)
        return (
          e ??
          (m
            ? { view: m[1], scenario: m[2], width: Number(m[3]) }
            : { view: name.split('-')[0], scenario: 'unknown', width: Number(name.match(/-(\d+)\.txt$/u)?.[1] ?? 0) })
        )
      }
    for (const name of expected)
      if (!actual.has(name))
        errors.push(checks.failure(describe(name), 'snapshot inventory', name, 'missing', 'baseline missing'))
    for (const name of actual)
      if (!expected.has(name))
        errors.push(
          checks.failure(describe(name), 'snapshot inventory', 'no extra baseline', name, 'unreferenced baseline'),
        )
    return errors
  },
  lineDiff(expected, actual) {
    const a = expected.split('\n'),
      b = actual.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++
    return `line ${i + 1}: expected ${JSON.stringify(a[i] ?? '<eof>')}; actual ${JSON.stringify(b[i] ?? '<eof>')}`
  },
  runMutationProofs(frames) {
    const t = frames.get('timeline-busy-200.txt'),
      check = frame => checks.checkFrame(t.entry, frame, t.paneWidth)
    const lines = t.frame.split('\n'),
      chip = lines.findIndex(line => /^\s+│\s+In progress\s*$/u.test(line))
    if (chip >= 0) lines[chip] = lines[chip].replace(/^ /u, '')
    const long = t.frame.split('\n').find(line => line.includes('Snapshot long')),
      asks = frames.get('asks-empty-110.txt'),
      names = new Set(registry.map(e => e.file)),
      missing = new Set(names)
    missing.delete('timeline-busy-200.txt')
    const extra = new Set(names)
    extra.add('timeline-busy-201.txt')
    const proofs = [
      ['chip moved one cell', chip < 0 ? null : check(lines.join('\n')).find(e => e.includes('chip does not start'))],
      [
        'required label removed',
        check(t.frame.replace('Progress', '         ')).find(e => e.includes('required label absent')),
      ],
      [
        'gap after ellipsis removed',
        long && check(t.frame.replace(long, long.replace(/… {2,}(?=[━─])/u, '…'))).find(e => e.includes('bar gap')),
      ],
      [
        'stray tree guide inserted',
        checks.checkFrame(asks.entry, `│${asks.frame}`, asks.paneWidth).find(e => e.includes('stray │')),
      ],
      ['baseline deleted', checks.inventoryErrors(names, missing).find(e => e.includes('timeline-busy-200.txt'))],
      ['extra baseline added', checks.inventoryErrors(names, extra).find(e => e.includes('unreferenced baseline'))],
    ]
    for (const [name, line] of proofs) {
      if (!line) throw Error(`mutation proof did not fail: ${name}`)
      process.stdout.write(`PROOF ${name}: ${line}\n`)
    }
  },
}
export const { marker, pageMarker, failure, checkFrame, inventoryErrors, lineDiff, runMutationProofs } = checks
