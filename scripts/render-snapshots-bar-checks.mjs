import { cellWidth } from '../hooks/text.ts'
import { timelineRowBarWidth } from '../hooks/layout.ts'
export const taskMarkers = ['Snapshot root', '折り返し用', 'Snapshot long', '深い階層']
export const failure = (e, r, x, a, m) => `FAIL ${e.view}/${e.scenario}/${e.width} ${r} ${x}→${a} ${m}`
export const barTracks = line => [...line.matchAll(/[━─]+/gu)].map(([track]) => track)
const percent = line => line?.match(/(\d+(?:\.\d+)?)%/u)?.[1]
export function checkTimelineBars(entry, frame) {
  if (entry.view !== 'timeline') return []
  const lines = frame.split('\n'),
    errors = [],
    fail = (...args) => errors.push(failure(entry, ...args)),
    h = lines.findIndex(s => s.includes('Progress')),
    b = lines.findIndex((s, i) => i > h && barTracks(s).length),
    top = lines.slice(0, h).findLast(line => /[┌╭].*[┐╮]/u.test(line)) ?? '',
    card = cellWidth(top.slice(top.search(/[┌╭]/u), top.search(/[┐╮]/u) + 1)) - 4,
    width = timelineRowBarWidth(card),
    check = (row, track, value, size) => {
      const fill = [...track].filter(mark => mark === '━').length,
        expected = Math.round((Number(value) * track.length) / 100)
      if (track.length !== size) fail(row, size, track.length, 'track width')
      if (!/^━*─*$/u.test(track)) fail(row, '━*─*', track, 'bar fill must precede')
      if (value === undefined) fail(row, 'percent', 'missing', 'bar cannot be classified')
      else if (fill !== expected) fail(row, expected, fill, 'filled cells do not match')
    }
  if (h < 0 || b < 0 || card < 1 || barTracks(lines[b] ?? '').length !== 1)
    fail('header', 'track', 'missing', 'unclassifiable')
  else check('header', barTracks(lines[b])[0], percent(lines[b + 1]), card)
  const bottom = lines.findIndex((line, i) => i > b && /[└╰].*[┘╯]/u.test(line))
  lines.forEach((line, i) => {
    const value = percent(line),
      marker = taskMarkers.find(m => line.includes(m))
    if (i <= bottom || value === undefined) return
    const rows = barTracks(marker ? line.slice(line.indexOf(marker)) : '')
    if (!marker || rows.length !== (width ? 1 : 0)) fail(`row:${i + 1}`, width ? 1 : 0, rows.length, 'row bar presence')
    if (width && rows.length === 1) check(`row-bar:${i + 1}`, rows[0], value, 10)
  })
  if (entry.scenario === 'busy')
    taskMarkers
      .filter(marker => !lines.some(line => line.includes(marker) && percent(line) !== undefined))
      .forEach(marker => fail(marker, 'title-line percent', 'missing', 'row cannot be classified'))
  return errors
}
