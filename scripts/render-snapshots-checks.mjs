import { cellWidth } from '../hooks/text.ts'
import { registry } from './render-snapshots-fixtures.mjs'

const stripAnsi = text => text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
export const marker = entry =>
  ({
    asks: entry.scenario === 'empty' ? 'Nothing needed' : 'Snapshot question',
    timeline: entry.scenario === 'empty' ? 'No tasks have been recorded' : 'Snapshot root',
    prs: entry.scenario === 'empty' ? 'No PRs' : 'Snapshot pull request',
    'timeline-detail': 'Snapshot',
    'asks-detail': 'Snapshot',
    help: 'Keys',
  })[entry.view]

export const pageMarker = (frame, text) => frame.replace(/\s+/gu, ' ').includes(text)
const TERMINAL_ROWS = [
  /^(?:⚠ Remote managed settings failed|policy applied|for details|runs first|event on past it|Claude Code v\d+(?:\.\d+)+)$/u,
  /^(?:(?:Opus|Sonnet|Haiku) [\d.]+(?: \([^)]*\))? · API Usage Billing|▝▝|❯|⏺ inbox:|⎿ +inbox:|◐ medium · \/effort|⏸ manual mode on · gh auth login for PR status · ← for agents|Nothing needed +\[ Open inbox \])$/u,
  /^🤖 [^|]+ \| 💰\$[\d,.]+ session \/ \$[\d,.]+ today \/ \$[\d,.]+ block \([^)]*\) \| 🔥\$[\d,.]+\/hr \| 🧠[\d,]+ \(\d+%\) \| Account: [^|]+ \| Weekly: [\d.]+% \| Weekly Fable: [\d.]+%$/u,
  /^⬇️? +In: [\d,.]+[kM]? \| ⬆️? Out: [\d,.]+[kM]? \| 💾 Cached: [\d,.]+[kM]? \| 📊 Total: [\d,.]+[kM]? \| 🧠 Ctx: [\d,.]+[kM]? \| 📈 Ctx Used: [\d.]+% \| 👤 Ctx\(u\) Used: [\d.]+%$/u,
  /^🟢 GenAI GW \$[\d.]+\/10m · 📅 \d+% \([^)]*\) · ⏳ [^·]+ · 👤 \$[\d.]+\/10m · \d+% \([^)]*\)$/u,
  /^⏵⏵ [a-z -]+ on · \d+ shells? · ← \d+ agents?$/u,
]
export const isTerminalChrome = (line, width) =>
  !/[│├└]/u.test(line) &&
  ((cellWidth(line) === width && /^─+$/u.test(line)) ||
    /^(?:╭─+╮|╰─+╯)$/u.test(line.trim()) ||
    TERMINAL_ROWS.some(pattern => pattern.test(line.trim())))
const taskMarkers = ['Snapshot root', '折り返し用', 'Snapshot long', '深い階層']
const inverseVideo = line => {
  let inverse = false
  for (const match of line.matchAll(/\x1b\[([\d;]*)m|([^\x1b])/gu)) {
    if (match[1] !== undefined) {
      for (const code of match[1].split(';').map(Number)) {
        if (code === 0 || code === 27) inverse = false
        if (code === 7) inverse = true
      }
    } else if (inverse) return true
  }
  return false
}
export function checkTimelineFocus(entry, frame, ansiFrame) {
  if (entry.view !== 'timeline' || entry.scenario !== 'busy') return []
  const errors = []
  for (const marker of taskMarkers) {
    const row = frame.split('\n').find(line => line.includes(marker))
    const ansiRow = ansiFrame.split('\n').find(line => stripAnsi(line).includes(marker))
    if (!row || !ansiRow) continue
    if (!row.slice(0, row.indexOf(marker)).includes('>') && inverseVideo(ansiRow))
      errors.push(
        failure(
          entry,
          `focus:${marker}`,
          'cursor row or no inverse',
          'inverse',
          'inverse-video focus remains on a task row after the cursor moved',
        ),
      )
  }
  return errors
}
const col = (line, index) => cellWidth(line.slice(0, index))
const detailColumns = { 87: [26, 28, 51, 53], 110: [19, 21], 200: [27, 29, 52, 54] }
export const failure = (entry, row, expected, actual, reason) =>
  `FAIL view=${entry.view} scenario=${entry.scenario} width=${entry.width} row=${row} ` +
  `expected-column=${expected} actual-column=${actual} ${reason}`

const detailHeadings = new Set(['Detail', 'Updated', 'Note', 'History', 'Links'])
export function checkLeftEdges(entry, frame) {
  if (entry.view !== 'timeline-detail') return []
  const lines = frame.split('\n')
  const header = lines.find(line => line.includes('Back Snapshot')),
    box = lines.find(line => line.includes('┌'))
  if (!header || !box) return ['left-edge reference row absent']

  const edge = col(box, box.indexOf('┌')),
    errors = []
  const check = (row, line, index) =>
    col(line, index) === edge || errors.push(failure(entry, row, edge, col(line, index), 'left edge mismatch'))
  check('detail header', header, header.indexOf('b: ‹ Back'))

  let section = false
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row],
      text = line.trim()
    if (detailHeadings.has(text)) section = true
    else if (!text) section = false
    if (section) check(`line-${row + 1}`, line, line.search(/\S/u))
  }
  return errors
}

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

  if (entry.view === 'asks' && entry.scenario === 'busy')
    for (const text of [entry.width <= 87 ? marker(entry) : 'Questions', 'No background given', 'No effect given'])
      if (!pageMarker(frame, text)) add(`required:${text}`, 0, 'missing', 'required question label absent')

  const tree = entry.view === 'timeline'
  const listBase = 3
  lines.forEach((line, row) => {
    for (const match of line.matchAll(/│/g)) {
      const at = col(line, match.index)
      const border = at === 1 || at === cellWidth(line) - 1
      const inTree = at >= 4 && at <= 14
      const listGuide = entry.view === 'asks' && at >= listBase && (at - listBase) % 3 === 0 && at <= listBase + 12
      const statsRow = entry.view === 'timeline-detail' && /Progress|Weight|Completed units|%/u.test(line)
      const statsDivider = statsRow && (detailColumns[entry.width]?.includes(at) ?? false)
      const narrowAsksDivider = entry.view === 'asks' && entry.width <= 87 && at === 20
      const allowed = tree ? border || inTree : border || listGuide || statsDivider || narrowAsksDivider
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
    const status =
      root && lines.slice(lines.indexOf(root) + 1).find(line => /^\s+│\s+(In progress|No report yet)\s*$/u.test(line))
    if (!root) add('snapshot-root title', 6, 'missing', 'required title row absent')
    else if (titleCol !== 6) add('snapshot-root title', 6, titleCol, 'title starts outside fixture column')
    if (entry.width === 200 && root && (!/[━─]/u.test(root) || !root.includes('50.00%')))
      add('snapshot-root bar', 'title line', 'next line or missing', 'bar and percentage must share the title line')
    if (!status) add('snapshot-root chip', titleCol, 'missing', 'required chip absent')
    else {
      const label = status.match(/In progress|No report yet/u)?.[0] ?? ''
      const chip = col(status, status.indexOf(label) - 1)
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

function styledCells(line) {
  const cells = []
  const style = { foreground: null, background: null, inverse: false }
  const tokens = line.match(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|[^\x1b]+/gu) ?? []
  let offset = 0
  for (const token of tokens) {
    if (token.startsWith('\x1b[')) {
      if (token.endsWith('m')) {
        const codes = token
          .slice(2, -1)
          .split(';')
          .map(value => Number(value || 0))
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i]
          if (code === 0) Object.assign(style, { foreground: null, background: null, inverse: false })
          else if (code === 7) style.inverse = true
          else if (code === 27) style.inverse = false
          else if (code === 39) style.foreground = null
          else if (code === 49) style.background = null
          else if (code === 38 || code === 48) {
            const mode = codes[i + 1]
            const color =
              mode === 5
                ? `${code};5;${codes[i + 2]}`
                : mode === 2
                  ? `${code};2;${codes.slice(i + 2, i + 5).join(';')}`
                  : `${code}`
            if (code === 38) style.foreground = color
            else style.background = color
            i += mode === 5 ? 2 : mode === 2 ? 4 : 0
          } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) style.foreground = `${code}`
          else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) style.background = `${code}`
        }
      }
      offset += token.length
      continue
    }
    for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token)) {
      const width = cellWidth(part.segment)
      for (let i = 0; i < width; i++)
        cells.push({
          char: part.segment,
          foreground: style.foreground,
          background: style.background,
          inverse: style.inverse,
          start: offset + part.index,
          end: offset + part.index + part.segment.length,
        })
    }
    offset += token.length
  }
  return cells
}

function chipBoxes(entry, ansiFrame, paneWidth) {
  const lines = ansiFrame.split('\n')
  const first = entry.width - paneWidth
  const after = first + paneWidth
  const boxes = []
  lines.forEach((line, row) => {
    const cells = styledCells(line)
    for (let at = first; at < Math.min(after, cells.length); at++) {
      const label = cells[at]
      if (!label?.background || (!label.inverse && label.foreground !== '38;5;16') || !/[A-Za-z]/u.test(label.char))
        continue
      const labelStyle = cell =>
        cell?.background === label.background && (label.inverse ? cell.inverse : cell.foreground === label.foreground)
      let start = at
      let end = at
      while (start > first && labelStyle(cells[start - 1])) start--
      while (end + 1 < after && labelStyle(cells[end + 1])) end++
      const text = cells
        .slice(start, end + 1)
        .map(cell => cell.char)
        .join('')
        .trim()
      if (!/^[A-Za-z][A-Za-z ]{0,15}$/u.test(text)) continue
      let boxStart = start
      let boxEnd = end
      while (boxStart > first && cells[boxStart - 1]?.background === label.background) boxStart--
      while (boxEnd + 1 < cells.length && cells[boxEnd + 1]?.background === label.background) boxEnd++
      let left = 0
      let right = 0
      for (let i = boxStart; i < start && cells[i]?.char === ' '; i++) left++
      for (let i = boxEnd; i > end && cells[i]?.char === ' '; i--) right++
      boxes.push({ row, cells, start: boxStart, end: boxEnd, labelStart: start, labelEnd: end, text, left, right })
      at = end
    }
  })
  return boxes
}

export function checkChipBoxes(entry, ansiFrame, paneWidth) {
  const errors = []
  for (const box of chipBoxes(entry, ansiFrame, paneWidth)) {
    const row = `line-${box.row + 1}:${box.text}`
    const add = (...args) => errors.push(failure(entry, row, ...args))
    if (box.left !== 1 || box.right !== 1)
      add('1 cell on each side', `left=${box.left} right=${box.right}`, 'chip box padding')
    const after = box.cells[box.end + 1]
    if (box.end + 1 >= entry.width || after?.char !== ' ' || after.background === box.cells[box.labelStart]?.background)
      add('1 clear cell before pane edge', after?.char === ' ' ? 1 : 0, 'chip box right margin')
    if (box.end >= entry.width)
      add(
        `<${entry.width - (entry.width - paneWidth)}`,
        box.end - (entry.width - paneWidth),
        'chip runs past pane right edge',
      )
  }
  return errors
}

export function stripChipRightPadding(ansiFrame, entry, paneWidth, label) {
  const box = chipBoxes(entry, ansiFrame, paneWidth).find(item => item.text === label && item.right === 1)
  if (!box) throw Error(`chip mutation target not found: ${label}`)
  const pad = box.cells[box.labelEnd + 1]
  const lines = ansiFrame.split('\n')
  const line = lines[box.row]
  lines[box.row] =
    line.slice(0, pad.start) +
    '\x1b[49m' +
    line.slice(pad.start, pad.end) +
    `\x1b[${pad.background}m` +
    line.slice(pad.end)
  return lines.join('\n')
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
  const chip = lines.findIndex(line => /^\s+│\s+(In progress|No report yet)\s*$/u.test(line))
  const chipLabel = chip < 0 ? '' : (lines[chip].match(/In progress|No report yet/u)?.[0] ?? '')
  if (chip >= 0) lines[chip] = lines[chip].replace(/^ /u, '')
  const long = timeline.frame.split('\n').find(line => line.includes('Snapshot long'))
  const focusMutation = timeline.ansiFrame.replace('Snapshot long', '\x1b[7mSnapshot long\x1b[27m')
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
    ['focus left on another task', checkTimelineFocus(timeline.entry, timeline.frame, focusMutation)[0]],
  ]
  for (const [name, line] of proofs) {
    if (!line) throw Error(`mutation proof did not fail: ${name}`)
    process.stdout.write(`PROOF ${name}: ${line}\n`)
  }
  for (const [name, file, label] of [['Timeline', 'timeline-busy-200.txt', chipLabel]]) {
    const item = frames.get(file)
    const mutated = stripChipRightPadding(item.ansiFrame, item.entry, item.paneWidth, label)
    const line = checkChipBoxes(item.entry, mutated, item.paneWidth).find(error => error.includes('chip box padding'))
    if (!line) throw Error(`mutation proof did not fail: ${name} chip right padding`)
    process.stdout.write(`PROOF ${name} chip right padding removed: ${line}\n`)
  }
}
