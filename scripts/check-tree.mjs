import { readFileSync } from 'node:fs'
import { cellWidth, cutToCells } from '../hooks/text.ts'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu
const AGENT_HEADINGS = /^(?:Orchestrators|Meta tasks|Local agents)\b/u
const ASKS_HEADINGS = /^(?:Questions|Tasks|Findings|Legacy findings|Potential issues|Ideas|Opportunities)\b/u
const GLYPHS = /├─|└─/gu
const treeLine = line => /[│├└]/u.test(line) || AGENT_HEADINGS.test(line.trim()) || ASKS_HEADINGS.test(line.trim())

function paneLines(text) {
  const lines = text.replace(ANSI, '').replace(/\r/gu, '').split('\n')
  const width = Math.max(0, ...lines.map(cellWidth))
  const dividers = new Map()
  for (const line of lines)
    for (let at = line.indexOf('│'); at >= 0; at = line.indexOf('│', at + 1)) {
      const column = cellWidth(line.slice(0, at))
      if (column >= Math.floor(width / 3) && column < width - 20) dividers.set(column, (dividers.get(column) ?? 0) + 1)
    }
  const [divider, count] = [...dividers].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? []
  if (!divider || count < 20) return { lines, lineNumbers: lines.map((_, i) => i + 1), unclassified: [] }
  const at = line => {
    const prefix = cutToCells(line, divider + 1)
    return cellWidth(prefix) === divider + 1 && prefix.endsWith('│')
  }
  const [first, last] = [lines.findIndex(at), lines.findLastIndex(at)]
  const result = { lines: [], lineNumbers: [], unclassified: [] }
  lines.forEach((line, index) => {
    if (at(line)) {
      const prefix = cutToCells(line, divider + 1)
      result.lines.push(line.slice(prefix.length).trimEnd())
      result.lineNumbers.push(index + 1)
    } else if (
      (index >= first && index <= last) ||
      (index < first && line.slice(cutToCells(line, divider).length).trim()) ||
      (index > last && treeLine(line))
    )
      result.unclassified.push(index + 1) // Missing divider inside the pane or on a tree-shaped row.
  })
  return result
}
const glyphColumns = (line, pattern) =>
  [...line.matchAll(pattern)].map(match => ({ text: match[0], column: cellWidth(line.slice(0, match.index)) }))
const hasTreeAt = (line, column) =>
  [...line.matchAll(/│|├─|└─/gu)].some(match => cellWidth(line.slice(0, match.index)) === column)

function boxBorders(lines) {
  const tops = []
  const bottoms = []
  const rows = new Set()
  lines.forEach((line, index) => {
    const corners = glyphColumns(line, /[┌┐└┘]/gu)
    const topLeft = corners.find(({ text }) => text === '┌')
    const topRight = corners.find(({ text }) => text === '┐')
    const bottomLeft = corners.find(({ text }) => text === '└')
    const bottomRight = corners.find(({ text }) => text === '┘')
    if (topLeft && topRight) tops.push({ line: index, left: topLeft.column, right: topRight.column })
    if (bottomLeft && bottomRight) bottoms.push({ line: index, left: bottomLeft.column, right: bottomRight.column })
  })
  const edges = new Set(),
    pairedBottoms = new Set()
  for (const top of tops) {
    const bottom = bottoms.find(
      candidate =>
        candidate.line > top.line &&
        candidate.left === top.left &&
        candidate.right === top.right &&
        !pairedBottoms.has(candidate.line),
    )
    if (bottom) {
      pairedBottoms.add(bottom.line)
      rows.add(top.line)
      rows.add(bottom.line)
      for (let line = top.line + 1; line < bottom.line; line++) {
        edges.add(`${line}:${top.left}`)
        edges.add(`${line}:${top.right}`)
      }
    }
  }
  return { edges, rows }
}
const viewOf = (lines, requested) =>
  requested !== 'auto'
    ? requested
    : /\b(?:Orchestrators|Meta tasks|Local agents)\b/u.test(lines.join('\n'))
      ? 'agents'
      : /Progress.*(?:leaf tasks|complete)|Elapsed:/u.test(lines.join('\n'))
        ? 'timeline'
        : 'asks'

function blocks(lines, view) {
  if (view === 'timeline') return [{ start: 0, end: lines.length, name: 'Timeline' }]
  const heading = view === 'agents' ? AGENT_HEADINGS : ASKS_HEADINGS
  const starts = lines.flatMap((line, index) => (heading.test(line.trim()) ? [index] : []))
  if (!starts.length) return [{ start: 0, end: lines.length, name: view }]
  return [
    ...(starts[0] > 0 ? [{ start: 0, end: starts[0], name: view }] : []),
    ...starts.map((start, index) => ({
      start,
      end: starts[index + 1] ?? lines.length,
      name: lines[start].trim().split(/[·  ]/u, 1)[0] || view,
    })),
  ]
}

/** Returns structural diagnostics only; it never includes the captured row text. */
export function checkTreeText(text, { view = 'auto', source = 'frame', requireTree = false } = {}) {
  const { lines, lineNumbers, unclassified } = paneLines(text)
  const kind = viewOf(lines, view)
  const errors = unclassified.map(line => `FAIL ${source} line=${line} unclassified line`)
  let trees = 0
  const timelineBorders = kind === 'timeline' ? boxBorders(lines) : { edges: new Set(), rows: new Set() }
  const fail = (block, line, detail) =>
    errors.push(`FAIL ${source} tree=${block} line=${lineNumbers[line] ?? line + 1} ${detail}`)

  for (const block of blocks(lines, kind)) {
    const rows = []
    for (let index = block.start; index < block.end; index++) {
      if (!timelineBorders.rows.has(index))
        for (const glyph of glyphColumns(lines[index] ?? '', GLYPHS)) rows.push({ ...glyph, line: index })
    }
    const headerTrunks =
      kind === 'timeline'
        ? []
        : lines
            .slice(block.start + 1, rows[0]?.line ?? block.end)
            .flatMap(line => glyphColumns(line, /│/gu).map(glyph => glyph.column))
    if (rows.length) {
      trees++
      const first = rows[0]
      const expectedBase =
        kind === 'timeline'
          ? Math.min(...rows.map(row => row.column))
          : (headerTrunks.find(column => column <= first.column && (first.column - column) % 3 === 0) ?? 3)
      for (const row of rows) {
        if (row.column < expectedBase || (row.column - expectedBase) % 3 !== 0)
          fail(block.name, row.line, `connector-column=${row.column} expected=${expectedBase}+3n`)
      }

      if (kind !== 'timeline') {
        if (!headerTrunks.includes(expectedBase))
          fail(block.name, first.line, `missing-heading-trunk-column=${expectedBase}`)
        if (block.name === 'Local agents' && headerTrunks.filter(column => column === expectedBase).length > 1)
          fail(block.name, block.start + 1, `duplicate-heading-trunk-column=${expectedBase}`)
        if (first.line > block.start + 1 && !(lines[first.line - 1] ?? '').trim())
          fail(block.name, first.line - 1, 'blank-break-before-first-child')
      }

      for (const row of rows) {
        const later = rows.find(candidate => candidate.line > row.line && candidate.column === row.column)
        for (let line = row.line + 1; later && line <= later.line; line++)
          if (!hasTreeAt(lines[line] ?? '', row.column))
            fail(block.name, line, `missing-continuity-column=${row.column}`)
      }

      for (let line = block.start; line < block.end; line++) {
        for (const { column } of glyphColumns(lines[line] ?? '', /│/gu)) {
          const pairedBoxEdge = kind === 'timeline' && timelineBorders.edges.has(`${line}:${column}`)
          const hasLaterConnector = rows.some(candidate => candidate.line > line && candidate.column === column)
          if (!pairedBoxEdge && !hasLaterConnector) fail(block.name, line, `orphan-trunk-column=${column}`)
        }
      }
    } else {
      for (let line = block.start; line < block.end; line++) {
        for (const { column } of glyphColumns(lines[line] ?? '', /│/gu)) {
          const pairedBoxEdge = kind === 'timeline' && timelineBorders.edges.has(`${line}:${column}`)
          if (!pairedBoxEdge) fail(block.name, line, `orphan-trunk-column=${column}`)
        }
      }
    }
  }

  if (requireTree && trees === 0) errors.push(`FAIL ${source} no-tree-found`)
  return errors
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('usage: node scripts/check-tree.mjs <capture-file>\n')
    process.exitCode = 2
  } else {
    const errors = checkTreeText(readFileSync(file, 'utf8'), { source: file, requireTree: true })
    if (errors.length) {
      errors.forEach(error => process.stderr.write(`${error}\n`))
      process.exitCode = 1
    } else process.stdout.write(`PASS ${file}\n`)
  }
}
