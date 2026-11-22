import { cellWidth } from '../hooks/text.ts'
import { TEXT_COLUMN } from '../hooks/layout.ts'
import { failure } from './render-snapshots-bar-checks.mjs'

const BOX_BORDERS = new Set('╭╮╰╯┌┐└┘├┤┬┴┼─│')
const tabBarBottom = line => /^[─▀]+$/u.test(line.trim())

export function checkTextColumn(entry, frame) {
  const lines = frame.split('\n')
  const bottom = lines.findIndex(tabBarBottom)
  const errors = []

  for (let row = bottom < 0 ? 0 : bottom + 1; row < lines.length; row++) {
    let column = 0
    let badColumn = null
    for (const glyph of lines[row]) {
      if (column < TEXT_COLUMN && !/\s/u.test(glyph) && !BOX_BORDERS.has(glyph)) {
        badColumn = column
        break
      }
      column += cellWidth(glyph)
      if (column >= TEXT_COLUMN) break
    }
    if (badColumn !== null)
      errors.push(
        failure(
          entry,
          `line-${row + 1}`,
          `text at column ${TEXT_COLUMN} or a box border`,
          `glyph at column ${badColumn}`,
          'text starts left of the shared text column',
        ),
      )
  }

  return errors
}
