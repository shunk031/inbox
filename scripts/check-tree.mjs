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
function paneLines(text, inputMode, dividerColumn, paneWidth) {
  const lines = text.replace(ANSI, '').replace(/\r/gu, '').replace(/\n$/u, '').split('\n')
  if (inputMode === 'pane-only') return { lines, unclassified: [] }
  if (inputMode !== 'pane-in-terminal') throw Error(`unknown pane input mode: ${inputMode}`)
  const pane = { lines: [], unclassified: [] }
  lines.forEach((line, index) => {
    if (!Number.isInteger(dividerColumn) || !Number.isInteger(paneWidth) || !atCell(line, dividerColumn)) {
      pane.lines.push('')
      pane.unclassified.push(index + 1)
    } else {
      const prefix = cutToCells(line, dividerColumn + 1)
      pane.lines.push(cutToCells(line.slice(prefix.length), paneWidth).trimEnd())
    }
  })
  return pane
}

function boxBorders(lines) {
  const tops = [],
    edges = new Set(),
    corners = new Set()
  lines.forEach((text, line) => {
    const left = text.search(/[┌╭]/u),
      right = text.search(/[┐╮]/u),
      bottomLeft = text.search(/[└╰]/u),
      bottomRight = text.search(/[┘╯]/u)
    const col = index => (index < 0 ? -1 : cellWidth(text.slice(0, index)))
    if (left >= 0 && right > left) tops.push([line, col(left), col(right), text[left] === '╭'])
    if (bottomLeft >= 0 && bottomRight > bottomLeft) {
      const l = col(bottomLeft),
        r = col(bottomRight)
      const index = tops.findLastIndex(
        top => top[0] < line && top[1] === l && top[2] === r && top[3] === (text[bottomLeft] === '╰'),
      )
      if (index >= 0) {
        const [top] = tops.splice(index, 1)
        for (let row = top[0] + 1; row < line; row++) edges.add(`${row}:${l}`).add(`${row}:${r}`)
        if (text[bottomLeft] === '└') corners.add(`${line}:${l}`)
      }
    }
  })
  return { edges, corners }
}
export function checkTreeText(text, { view, source = 'frame', inputMode, dividerColumn, paneWidth } = {}) {
  const { lines, unclassified } = paneLines(text, inputMode, dividerColumn, paneWidth)
  const kind = view
  const errors = unclassified.map(line => `FAIL ${source} line=${line} unclassified line`)
  if (!['agents', 'asks', 'timeline'].includes(kind)) return [...errors, `FAIL ${source} line=1 unclassified view`]
  const borders = boxBorders(lines)
  const fail = (line, detail, tree = kind) => errors.push(`FAIL ${source} tree=${tree} line=${line + 1} ${detail}`)
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
  const sections = []
  lines.forEach((line, index) => {
    const match = kind === 'timeline' ? line.match(TIMELINE_ROOT) : heading(line, kind)
    if (match)
      sections.push({
        line: index,
        name: kind === 'timeline' ? 'Timeline root' : match[1],
        column: kind === 'timeline' ? cellWidth(line.slice(0, line.indexOf(match[1]))) : undefined,
        children: [],
      })
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
  return errors
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [file, view, inputMode, divider, width] = process.argv.slice(2)
  const errors = checkTreeText(readFileSync(file, 'utf8'), {
    view,
    inputMode,
    dividerColumn: Number(divider),
    paneWidth: Number(width),
    source: file,
  })
  process[errors.length ? 'stderr' : 'stdout'].write(errors.length ? `${errors.join('\n')}\n` : `PASS ${file}\n`)
  if (errors.length) process.exitCode = 1
}
