import { readFileSync } from 'node:fs'
import { cellWidth, cutToCells } from '../hooks/text.ts'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu
const HEADING_PREFIX = /^\s*(?:(?:Asks|Timeline|Agents|PRs)(?:\s+\d+)?\s+)?(?:▸|▲|✦|↻)?\s*/u
const HEADINGS = {
  agents: /^(Orchestrators|Meta tasks|Local agents)(?:\s*·\s*\d+)?\s*$/u,
  asks: /^(Questions|Tasks|Issues|Findings|Legacy findings|Opportunities|Progress)(?:\s*·\s*\d+)?\s*$/u,
}
const CONNECTORS = /├─|└─/gu
const TIMELINE_ROOT = /^(?: {4}| {2}> )([●◐✕○▸▾]) \S/u
const heading = (line, view) => line.replace(HEADING_PREFIX, '').match(HEADINGS[view])
const glyphs = (line, pattern) =>
  [...line.matchAll(pattern)].map(match => ({ column: cellWidth(line.slice(0, match.index)) }))
const atCell = (line, column) => glyphs(line, /│/gu).some(glyph => glyph.column === column)
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
      pane.lines.push(line.slice(cutToCells(line, divider + 1).length).trimEnd())
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
    const left = text.search(/[┌╭]/u),
      right = text.search(/[┐╮]/u),
      bottomLeft = text.search(/[└╰]/u),
      bottomRight = text.search(/[┘╯]/u)
    const col = index => cellWidth(text.slice(0, index))
    if (left >= 0 && right > left) tops.push({ line, left: col(left), right: col(right), round: text[left] === '╭' })
    if (bottomLeft < 0 || bottomRight < 0) return
    const l = col(bottomLeft),
      r = col(bottomRight)
    const index = tops.findLastIndex(
      top => top.line < line && top.left === l && top.right === r && top.round === (text[bottomLeft] === '╰'),
    )
    if (index < 0) return
    const [top] = tops.splice(index, 1)
    rows.add(top.line).add(line)
    for (let row = top.line + 1; row < line; row++) edges.add(`${row}:${l}`).add(`${row}:${r}`)
  })
  return { edges, rows }
}
function viewOf(lines, requested) {
  if (requested !== 'auto') return requested
  const matches = ['agents', 'asks', 'timeline'].filter(view =>
    lines.some(line => (view === 'timeline' ? /\bElapsed:|\bProgress\b.*leaf tasks/u.test(line) : heading(line, view))),
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function checkTreeText(text, { view = 'auto', source = 'frame', requireTree = false } = {}) {
  const { lines, lineNumbers, unclassified } = paneLines(text)
  const kind = viewOf(lines, view)
  const errors = unclassified.map(line => `FAIL ${source} line=${line} unclassified line`)
  if (!kind) return [...errors, `FAIL ${source} tree=auto line=1 unclassified view`]
  const borders = boxBorders(lines)
  const fail = (line, detail, tree = kind) =>
    errors.push(`FAIL ${source} tree=${tree} line=${lineNumbers[line] ?? line + 1} ${detail}`)
  const connectors = lines.flatMap((line, row) =>
    borders.rows.has(row)
      ? []
      : glyphs(line, CONNECTORS).map(glyph => ({ ...glyph, line: row, mark: glyph.column + 3, children: [] })),
  )
  const guides = lines.flatMap((line, row) =>
    glyphs(line, /│/gu)
      .filter(glyph => !borders.edges.has(`${row}:${glyph.column}`))
      .map(glyph => ({ ...glyph, line: row })),
  )
  const sections = lines.flatMap((line, index) => {
    const match = kind === 'timeline' ? line.match(TIMELINE_ROOT) : heading(line, kind)
    return match
      ? [
          {
            line: index,
            name: kind === 'timeline' ? 'Timeline root' : match[1],
            column: kind === 'timeline' ? cellWidth(line.slice(0, line.indexOf(match[1]))) : undefined,
            children: [],
          },
        ]
      : []
  })
  for (const section of sections) {
    const next = sections.find(row => row.line > section.line)?.line ?? lines.length
    const children = connectors.filter(row => row.line > section.line && row.line < next)
    const first = children[0]
    if (first && kind !== 'timeline') {
      const trunk = guides.find(row => row.line > section.line && row.line < first.line)
      section.column = trunk?.column
      if (!trunk) fail(first.line, 'heading-requires-trunk-before-connectors', section.name)
    }
  }
  for (const row of connectors) {
    const section = sections.findLast(item => item.line < row.line)
    const prior = connectors.findLast(
      item => item.line > (section?.line ?? row.line) && item.line < row.line && item.mark === row.column,
    )
    row.parent = prior ?? (section?.column === row.column ? section : undefined)
    if (row.parent) row.parent.children.push(row)
    else if (!section)
      fail(row.line, kind === 'timeline' ? 'connector-without-timeline-root' : 'connector-without-recognized-heading')
    else {
      fail(
        row.line,
        `connector-parent-column=${connectors.findLast(item => item.line > section.line && item.line < row.line)?.mark ?? section.column ?? 'missing'} actual=${row.column}`,
        section.name,
      )
    }
  }
  const expectedGuides = new Set()
  const span = (from, to, column, detail, tree, required = false) => {
    if (required && !guides.some(row => row.line > from && row.line < to && row.column === column))
      fail(to, `${detail}=${column}`, tree)
    for (let line = from + 1; line < to; line++) {
      if (guides.some(row => row.line === line && row.column === column)) expectedGuides.add(`${line}:${column}`)
      else fail(line, `${detail}=${column}`, tree)
    }
  }
  const parents = [...sections, ...connectors]
  for (const parent of parents) {
    const rows = parent.children
    if (!rows.length) continue
    rows.sort((a, b) => a.line - b.line)
    const column = parent.mark ?? parent.column
    span(
      parent.line,
      rows[0].line,
      column,
      parent.name === 'Timeline root' ? 'missing-timeline-root-guide' : 'missing-continuity-column',
      parent.name,
      parent.name !== undefined,
    )
    for (let index = 1; index < rows.length; index++) {
      const before = rows[index - 1],
        after = rows[index]
      span(before.line, after.line, before.column, 'missing-continuity-column', parent.name ?? kind)
    }
  }
  for (const guide of guides)
    if (!expectedGuides.has(`${guide.line}:${guide.column}`)) fail(guide.line, `orphan-trunk-column=${guide.column}`)
  if (requireTree && !(kind === 'timeline' ? sections.length : connectors.some(row => row.parent)))
    errors.push(`FAIL ${source} no-tree-found`)
  return errors
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('usage: node scripts/check-tree.mjs <capture-file>\n')
    process.exitCode = 2
  } else {
    const errors = checkTreeText(readFileSync(file, 'utf8'), { source: file, requireTree: true })
    process[errors.length ? 'stderr' : 'stdout'].write(errors.length ? `${errors.join('\n')}\n` : `PASS ${file}\n`)
    if (errors.length) process.exitCode = 1
  }
}
