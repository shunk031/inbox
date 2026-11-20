import { readFileSync } from 'node:fs'
import { cellWidth, cutToCells } from '../hooks/text.ts'
import { isTerminalChrome } from './render-snapshots-checks.mjs'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu
const HEADING_PREFIX = /^\s*(?:(?:Asks|Timeline)(?:\s+\d+)?\s+)?(?:▸|▲|✦|↻)?\s*/u
const HEADINGS = {
  asks: /^(Questions|Tasks|Issues|Findings|Legacy findings|Opportunities|Progress)(?:\s*·\s*\d+)?\s*$/u,
}
const CONNECTORS = /├─|└─/gu
const TIMELINE_ROOT_COLUMN = 4
const TIMELINE_ROOT = new RegExp(`^(?: {${TIMELINE_ROOT_COLUMN}}| {2}> )([●◐✕○▸▾]) \\S`, 'u')
const heading = (line, view) => line.replace(HEADING_PREFIX, '').match(HEADINGS[view])
const glyphs = (line, pattern) =>
  [...line.matchAll(pattern)].map(match => ({ column: cellWidth(line.slice(0, match.index)) }))
const atCell = (line, column) => glyphs(line, /│/gu).some(glyph => glyph.column === column)
const paneRow = (line, divider, width) =>
  divider === 0 && line.startsWith('│') && line.endsWith('│') && cellWidth(line) === width + 2
    ? cutToCells(line.slice(1), width).trimEnd()
    : atCell(line, divider)
      ? cutToCells(line.slice(cutToCells(line, divider + 1).length), width).trimEnd()
      : null
function paneLines(text, inputMode, dividerColumn, paneWidth) {
  const lines = text.replace(ANSI, '').replace(/\r/gu, '').replace(/\n+$/u, '').split('\n')
  if (inputMode === 'pane-only') return { lines, unclassified: [] }
  if (inputMode !== 'pane-in-terminal') throw Error(`unknown pane input mode: ${inputMode}`)
  const rows = lines.map(line => paneRow(line, dividerColumn, paneWidth))
  const first = rows.findIndex(row => row !== null)
  const last = rows.findLastIndex(row => row !== null)
  const pane = { lines: [], unclassified: [] }
  lines.forEach((line, index) => {
    const row = rows[index]
    const inside = index >= first && index <= last
    const connector = /├─|└─/u.test(line)
    const chrome =
      !inside &&
      !connector &&
      isTerminalChrome(line, dividerColumn === 0 ? paneWidth + 2 : dividerColumn + 1 + paneWidth)
    if (row === null && (connector || inside || (!chrome && line))) pane.unclassified.push(index + 1)
    pane.lines.push(row ?? '')
  })
  return pane
}

function boxBorders(lines) {
  const { tops, edges, corners } = { tops: [], edges: new Set(), corners: new Set() }
  lines.forEach((text, line) => {
    const [left, right, bottomLeft, bottomRight] = ['[┌╭]', '[┐╮]', '[└╰]', '[┘╯]'].map(glyph =>
      text.search(new RegExp(glyph, 'u')),
    )
    const col = index => (index < 0 ? -1 : cellWidth(text.slice(0, index)))
    if (left >= 0 && right > left) tops.push([line, col(left), col(right), text[left] === '╭'])
    if (bottomLeft < 0 || bottomRight <= bottomLeft) return
    const l = col(bottomLeft),
      r = col(bottomRight),
      rounded = text[bottomLeft] === '╰'
    const index = tops.findLastIndex(top => top[0] < line && top[1] === l && top[2] === r && top[3] === rounded)
    if (index < 0) return
    const [top] = tops.splice(index, 1)
    for (let row = top[0] + 1; row < line; row++) edges.add(`${row}:${l}`).add(`${row}:${r}`)
    if (!rounded) corners.add(`${line}:${l}`)
  })
  return { edges, corners }
}
export function checkTreeText(text, { view, source = 'frame', inputMode, dividerColumn, paneWidth } = {}) {
  const { lines, unclassified } = paneLines(text, inputMode, dividerColumn, paneWidth)
  const errors = unclassified.map(line => `FAIL ${source} line=${line} unclassified line`)
  if (!['asks', 'timeline'].includes(view)) return [...errors, `FAIL ${source} line=1 unclassified view`]
  const borders = boxBorders(lines)
  const fail = (line, detail, tree = view) => errors.push(`FAIL ${source} tree=${tree} line=${line + 1} ${detail}`)
  const connectors = lines.flatMap((line, row) =>
    glyphs(line, CONNECTORS)
      .filter(glyph => !borders.corners.has(`${row}:${glyph.column}`))
      .map(glyph => ({ ...glyph, line: row, mark: glyph.column + 3, children: [] })),
  )
  const guides = lines.flatMap((line, row) =>
    glyphs(line, /│/gu)
      .filter(glyph => !borders.edges.has(`${row}:${glyph.column}`))
      .map(glyph => ({ ...glyph, line: row })),
  )
  const sections = lines.flatMap((line, index) => {
    const match = view === 'timeline' ? line.match(TIMELINE_ROOT) : heading(line, view)
    return match
      ? [
          {
            line: index,
            name: view === 'timeline' ? 'Timeline root' : match[1],
            column: view === 'timeline' ? TIMELINE_ROOT_COLUMN : undefined,
            children: [],
          },
        ]
      : []
  })
  if (!sections.length) fail(0, view === 'timeline' ? 'missing-timeline-root' : 'missing-recognized-heading')
  else if (!connectors.length) fail(sections[0].line, 'recognized-heading-without-connectors', sections[0].name)
  for (const section of sections) {
    const next = sections.find(row => row.line > section.line)?.line ?? lines.length
    const first = connectors.find(row => row.line > section.line && row.line < next)
    if (first && view === 'asks') {
      const trunk = guides.find(row => row.line > section.line && row.line < first.line)
      section.column = 3
      if (!trunk) fail(first.line, 'heading-requires-trunk-before-connectors', section.name)
      else if (trunk.column !== section.column)
        fail(trunk.line, `asks-guide-column=${section.column} actual=${trunk.column}`, section.name)
    }
  }
  for (const row of connectors) {
    const section = sections.findLast(item => item.line < row.line)
    const prior = connectors.findLast(
      item => item.line > (section?.line ?? row.line) && item.line < row.line && item.mark === row.column,
    )
    row.parent = prior ?? (section?.column === row.column ? section : undefined)
    if (row.parent) row.parent.children.push(row)
    else
      fail(
        row.line,
        section
          ? `connector-parent-column=${connectors.findLast(item => item.line > section.line && item.line < row.line)?.mark ?? section.column ?? 'missing'} actual=${row.column}`
          : `connector-without-${view === 'timeline' ? 'timeline-root' : 'recognized-heading'}`,
        section?.name,
      )
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
    const detail = parent.name === 'Timeline root' ? 'missing-timeline-root-guide' : 'missing-continuity-column'
    span(parent.line, rows[0].line, column, detail, parent.name, parent.name !== undefined)
    for (let index = 1; index < rows.length; index++) {
      const before = rows[index - 1],
        after = rows[index]
      span(before.line, after.line, before.column, 'missing-continuity-column', parent.name ?? view)
    }
  }
  for (const guide of guides)
    if (!expectedGuides.has(`${guide.line}:${guide.column}`)) fail(guide.line, `orphan-trunk-column=${guide.column}`)
  return errors
}

if (process.argv[1]?.endsWith('/check-tree.mjs')) {
  const [file, view, inputMode, divider, width] = process.argv.slice(2)
  const options = { view, inputMode, dividerColumn: +divider, paneWidth: +width, source: file }
  const errors = checkTreeText(readFileSync(file, 'utf8'), options)
  process[errors.length ? 'stderr' : 'stdout'].write(errors.length ? `${errors.join('\n')}\n` : `PASS ${file}\n`)
  if (errors.length) process.exitCode = 1
}
