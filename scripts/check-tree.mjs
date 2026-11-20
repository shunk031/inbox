import { readFileSync } from 'node:fs'
import { cellWidth, cutToCells } from '../hooks/text.ts'

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu
const AGENT_HEADINGS = /^(?:Orchestrators|Meta tasks|Local agents)\b/u
const ASKS_HEADINGS = /^(?:Questions|Tasks|Findings|Legacy findings|Potential issues|Ideas|Opportunities)\b/u
const GLYPHS = /├─|└─/gu

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
  if (!divider || count < 20) return lines
  return lines.flatMap(line => {
    const prefix = cutToCells(line, divider + 1)
    return cellWidth(prefix) === divider + 1 && prefix.endsWith('│') ? [line.slice(prefix.length).trimEnd()] : []
  })
}

const glyphColumns = (line, pattern) =>
  [...line.matchAll(pattern)].map(match => ({ text: match[0], column: cellWidth(line.slice(0, match.index)) }))
const hasTrunkAt = (line, column) =>
  [...line.matchAll(/│/gu)].some(match => cellWidth(line.slice(0, match.index)) === column)

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
  return starts.length
    ? starts.map((start, index) => ({
        start,
        end: starts[index + 1] ?? lines.length,
        name: lines[start].trim().split(/[·  ]/u, 1)[0] || view,
      }))
    : [{ start: 0, end: lines.length, name: view }]
}

/** Returns structural diagnostics only; it never includes the captured row text. */
export function checkTreeText(text, { view = 'auto', source = 'frame', requireTree = false } = {}) {
  const lines = paneLines(text)
  const kind = viewOf(lines, view)
  const errors = []
  let trees = 0
  const fail = (block, line, detail) => errors.push(`FAIL ${source} tree=${block} line=${line + 1} ${detail}`)

  for (const block of blocks(lines, kind)) {
    const rows = []
    for (let index = block.start; index < block.end; index++) {
      for (const glyph of glyphColumns(lines[index] ?? '', GLYPHS)) rows.push({ ...glyph, line: index })
    }
    if (!rows.length) continue
    trees++
    const first = rows[0]
    const headerTrunks =
      kind === 'timeline'
        ? []
        : lines.slice(block.start + 1, first.line).flatMap(line => glyphColumns(line, /│/gu).map(glyph => glyph.column))
    const expectedBase =
      kind === 'timeline'
        ? Math.min(...rows.map(row => row.column))
        : (headerTrunks.find(column => column <= first.column && (first.column - column) % 3 === 0) ?? 3)
    const lastTreeColumn = expectedBase + Math.ceil((Math.max(...rows.map(row => row.column)) - expectedBase) / 3) * 3
    for (const row of rows) {
      if (row.column < expectedBase || (row.column - expectedBase) % 3 !== 0)
        fail(block.name, row.line, `connector-column=${row.column} expected=${expectedBase}+3n`)
    }

    if (kind !== 'timeline') {
      if (!headerTrunks.includes(expectedBase))
        fail(block.name, first.line, `missing-heading-trunk-column=${expectedBase}`)
      if (first.line > block.start + 1 && !(lines[first.line - 1] ?? '').trim())
        fail(block.name, first.line - 1, 'blank-break-before-first-child')
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const column = expectedBase + Math.max(0, Math.round((row.column - expectedBase) / 3)) * 3
      const prior = rows
        .slice(0, index)
        .filter(candidate => candidate.column === row.column)
        .at(-1)
      if (!prior) continue
      const bridge = lines[row.line - 1] ?? ''
      if (!bridge.trim()) fail(block.name, row.line - 1, `blank-break-at-column=${column}`)
      else if (!hasTrunkAt(bridge, column)) fail(block.name, row.line - 1, `missing-bridge-column=${column}`)
    }

    for (let line = block.start; line < block.end; line++) {
      const row = lines[line] ?? ''
      const connectors = glyphColumns(row, GLYPHS)
      for (const { column } of glyphColumns(row, /│/gu)) {
        if (column < expectedBase || column > lastTreeColumn || (column - expectedBase) % 3 !== 0) continue
        if (rows.some(candidate => candidate.line > line && candidate.column === column)) continue
        if (connectors.some(candidate => candidate.column === column)) continue
        fail(block.name, line, `orphan-trunk-column=${column}`)
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
