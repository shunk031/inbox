import { readFileSync } from 'node:fs'
import { cellWidth, cutToCells } from '../hooks/text.ts'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu
const HEADINGS = {
  agents: /\b(?:Orchestrators|Meta tasks|Local agents)\b/u,
  asks: /\b(?:Questions|Tasks|Findings|Legacy findings|Potential issues|Ideas|Opportunities)\b/u,
}
const CONNECTORS = /├─|└─/gu
const glyphs = (line, pattern) =>
  [...line.matchAll(pattern)].map(match => ({ text: match[0], column: cellWidth(line.slice(0, match.index)) }))
const atCell = (line, column) => {
  const cell = cutToCells(line, column + 1)
  return cellWidth(cell) === column + 1 && cell.endsWith('│')
}
function paneLines(text) {
  const lines = text.replace(ANSI, '').replace(/\r/gu, '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const width = Math.max(0, ...lines.map(cellWidth))
  const dividers = new Map()
  for (const line of lines)
    for (const { column } of glyphs(line, /│/gu))
      if (column >= width / 3 && column < width - 20) dividers.set(column, (dividers.get(column) ?? 0) + 1)
  const [divider, count] = [...dividers].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? []
  if (!divider || count < 20) return { lines, lineNumbers: lines.map((_, i) => i + 1), unclassified: [] }
  const first = lines.findIndex(line => atCell(line, divider)),
    last = lines.findLastIndex(line => atCell(line, divider)),
    footer = lines.findIndex((line, i) => i > last && cellWidth(line) >= width * 0.7 && /^[\s─━]+$/u.test(line))
  const pane = { lines: [], lineNumbers: [], unclassified: [] }
  lines.forEach((line, index) => {
    if (atCell(line, divider)) {
      const prefix = cutToCells(line, divider + 1)
      pane.lines.push(line.slice(prefix.length).trimEnd())
      pane.lineNumbers.push(index + 1)
    } else if (index >= first && index <= last) pane.unclassified.push(index + 1)
    else if (index < first && line.slice(cutToCells(line, divider).length).trim()) pane.unclassified.push(index + 1)
    else if (index > last && (footer < 0 || index < footer)) pane.unclassified.push(index + 1)
  })
  return pane
}

function boxBorders(lines) {
  const tops = [],
    rows = new Set(),
    edges = new Set()
  lines.forEach((text, line) => {
    const left = text.indexOf('┌'),
      right = text.indexOf('┐'),
      bottomLeft = text.indexOf('└'),
      bottomRight = text.indexOf('┘')
    if (left >= 0 && right > left)
      tops.push({ line, left: cellWidth(text.slice(0, left)), right: cellWidth(text.slice(0, right)) })
    if (bottomLeft < 0 || bottomRight < 0) return
    const l = cellWidth(text.slice(0, bottomLeft)),
      r = cellWidth(text.slice(0, bottomRight))
    const index = tops.findLastIndex(top => top.line < line && top.left === l && top.right === r)
    if (index < 0) return
    const [top] = tops.splice(index, 1)
    rows.add(top.line).add(line)
    for (let row = top.line + 1; row < line; row++) edges.add(`${row}:${l}`).add(`${row}:${r}`)
  })
  return { edges, rows }
}
const viewOf = (lines, requested) => {
  const text = lines.join('\n')
  return requested !== 'auto'
    ? requested
    : /\b(?:Orchestrators|Meta tasks|Local agents)\b/u.test(text)
      ? 'agents'
      : /Progress.*(?:leaf tasks|complete)|Elapsed:/u.test(text)
        ? 'timeline'
        : 'asks'
}
function headingsOf(lines, view, connectors) {
  if (view === 'timeline') return []
  const headings = lines.flatMap((line, index) => {
    const match = line.match(HEADINGS[view])
    return match ? [{ line: index, name: match[0] }] : []
  })
  if (view === 'asks' && connectors.length) {
    const first = connectors.find(row => !headings.some(heading => heading.line < row.line))
    const title =
      first && lines.findLastIndex((line, index) => index < first.line && line.trim() && !/[│├└]/u.test(line))
    if (first && title >= 0) headings.push({ line: title, name: 'asks', trunk: first.column })
  }
  return headings.sort((a, b) => a.line - b.line)
}

export function checkTreeText(text, { view = 'auto', source = 'frame', requireTree = false } = {}) {
  const { lines, lineNumbers, unclassified } = paneLines(text)
  const kind = viewOf(lines, view)
  const errors = unclassified.map(line => `FAIL ${source} line=${line} unclassified line`)
  const borders = kind === 'timeline' ? boxBorders(lines) : { edges: new Set(), rows: new Set() }
  const fail = (line, detail, tree = kind) =>
    errors.push(`FAIL ${source} tree=${tree} line=${lineNumbers[line] ?? line + 1} ${detail}`)
  const connectors = lines.flatMap((line, row) =>
    borders.rows.has(row)
      ? []
      : glyphs(line, CONNECTORS).map(glyph => ({ ...glyph, line: row, mark: glyph.column + 3 })),
  )
  const guides = lines.flatMap((line, row) =>
    glyphs(line, /│/gu)
      .filter(glyph => !borders.edges.has(`${row}:${glyph.column}`))
      .map(glyph => ({ ...glyph, line: row })),
  )
  const headings = headingsOf(lines, kind, connectors)
  for (const heading of headings) {
    const next = headings.find(row => row.line > heading.line)?.line ?? lines.length
    const children = (heading.roots = connectors.filter(row => row.line > heading.line && row.line < next))
    if (!children.length) continue
    const first = children[0]
    heading.trunk ??= guides.find(row => row.line > heading.line && row.line < first.line)?.column
    if (heading.trunk === undefined) fail(first.line, 'missing-heading-trunk-column')
  }
  let timelineRoot
  if (kind === 'timeline' && connectors.length) {
    const first = connectors[0]
    const trunk = guides.findLast(row => row.line < first.line && row.column === first.column)
    if (trunk) {
      timelineRoot = { line: trunk.line, trunk: trunk.column, name: 'Timeline' }
      timelineRoot.roots = connectors
    } else fail(first.line, 'missing-heading-trunk-column', 'Timeline')
  }
  for (const row of connectors) {
    const heading = headings.findLast(item => item.line < row.line)
    const section = kind === 'timeline' ? timelineRoot : heading
    const previous = section?.roots?.findLast(item => item.line < row.line)
    const prior = section?.roots?.findLast(item => item.line < row.line && item.mark === row.column)
    row.parent = prior ?? (section?.trunk === row.column ? section : undefined)
    if (row.parent) (row.parent.nodes ??= []).push(row)
    else
      fail(
        row.line,
        `connector-parent-column=${previous?.mark ?? section?.trunk ?? 'missing'} actual=${row.column}`,
        section?.name ?? kind,
      )
  }
  const expectedGuides = new Set()
  const span = (from, to, column, detail, tree) => {
    for (let line = from + 1; line < to; line++) {
      if (guides.some(row => row.line === line && row.column === column)) expectedGuides.add(`${line}:${column}`)
      else fail(line, `${detail}=${column}`, tree)
    }
  }
  const parents = [...headings, ...connectors, ...(timelineRoot ? [timelineRoot] : [])]
  for (const heading of parents) {
    const rows = heading.roots ?? heading.nodes
    if (!rows) continue
    const first = rows[0]
    if (heading.trunk !== undefined)
      span(heading.line, first.line, heading.trunk, 'missing-heading-trunk-column', heading.name)
    if (heading === timelineRoot) expectedGuides.add(`${heading.line}:${heading.trunk}`)
  }
  for (const parent of parents) {
    const rows = parent.nodes
    if (!rows) continue
    rows.sort((a, b) => a.line - b.line)
    if (parent.mark !== undefined) span(parent.line, rows[0].line, parent.mark, 'missing-continuity-column', kind)
    for (let index = 1; index < rows.length; index++) {
      const before = rows[index - 1],
        after = rows[index]
      span(before.line, after.line, before.column, 'missing-continuity-column', parent.name ?? kind)
    }
  }
  for (const guide of guides)
    if (!expectedGuides.has(`${guide.line}:${guide.column}`)) fail(guide.line, `orphan-trunk-column=${guide.column}`)
  if (requireTree && !connectors.some(row => row.parent)) errors.push(`FAIL ${source} no-tree-found`)
  return errors
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('usage: node scripts/check-tree.mjs <capture-file>\n')
    process.exitCode = 2
  } else {
    const errors = checkTreeText(readFileSync(file, 'utf8'), { source: file, requireTree: true })
    if (errors.length) errors.forEach(error => process.stderr.write(`${error}\n`))
    else process.stdout.write(`PASS ${file}\n`)
    if (errors.length) process.exitCode = 1
  }
}
