import { cellWidth } from '../hooks/text.ts'
import { wrapText } from '../hooks/line-wrap.ts'
import { JAPANESE_TIMELINE_NOTE, JAPANESE_TIMELINE_REPORT } from './render-snapshots-fixtures.mjs'
import { failure } from './render-snapshots-bar-checks.mjs'

const headings = new Set(['Detail', 'Updated', 'Latest report', 'Note', 'History', 'Links'])

export function checkJapaneseTimelineDetailWrap(entry, frame, paneWidth) {
  if (entry.fixture !== 'timeline-detail-japanese') return []
  const lines = frame.split('\n')
  return [
    ['Latest report', `${JAPANESE_TIMELINE_REPORT} · 10m`],
    ['Note', JAPANESE_TIMELINE_NOTE],
  ].flatMap(([label, source]) => {
    const start = lines.findIndex(line => line.trim() === label)
    const next = lines.findIndex((line, index) => index > start && headings.has(line.trim()))
    const actual = lines
      .slice(start + 1, next < 0 ? undefined : next)
      .filter(line => line.trim())
      .map(line => line.trimStart())
    const width = Math.max(1, paneWidth - 2)
    const expected = wrapText(source, width, cellWidth, { keepCjkSpaces: true }).map(line => line.text)
    return actual.join('\n') === expected.join('\n') ? [] : [failure(entry, label, width, 'different', 'wrap')]
  })
}
