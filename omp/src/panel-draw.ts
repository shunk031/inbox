import type { BannerTone } from '../../hooks/tones'
import { ago } from '../../hooks/text'
import { actionLabel, replyHint } from '../../hooks/rows'
import { actionLines } from '../../hooks/action-plan'
import { isStatusUnderActions } from '../../hooks/feedback'
import { resultGlyph, runningMark } from '../../hooks/timing'
import { HELD_MARK, UNDO_KEY } from '../../hooks/help'
import { textMark } from '../../hooks/marks'
import type { BannerView } from '../../hooks/banners'
import type { ResultMark } from '../../hooks/rows'
import { focusOf } from './panel-keys'
import { AGENT, INDENT, UNLED_INDENT, isShut } from './panel-lines'
import type { ButtonFace, Lead, Line } from './panel-lines'
import { cutTitle, fit, indentedLinks, linkedText, spread, visibleLength, wrapText } from './panel-text'
import type { PanelScreen, PanelUi, Style, Tone } from './panel'
import type { TimelineLinePlan } from './panel-lines'
import type { TimelinePage } from '../../hooks/timeline-page'
import { wrapText as wrapSharedText } from '../../hooks/line-wrap'

export type Draw = { screen: PanelScreen; ui: PanelUi; width: number; now: number; style: Style }

export const wrapTimelineDetailText = (text: string, width: number) =>
  wrapSharedText(text, width, visibleLength, { keepCjkSpaces: true }).map(line => line.text)

function takeTimelineCells(text: string, width: number): { shown: string; rest: string } {
  const chars = Array.from(text)
  let used = 0
  let count = 0
  while (count < chars.length) {
    const cells = visibleLength(chars[count]!)
    if (count > 0 && used + cells > width) break
    if (used + cells > width) return { shown: chars[count]!, rest: chars.slice(count + 1).join('') }
    used += cells
    count++
  }
  return { shown: chars.slice(0, count).join(''), rest: chars.slice(count).join('') }
}

function wrapTimelineText(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let rest = paragraph
    while (visibleLength(rest) > width) {
      const { shown, rest: tail } = takeTimelineCells(rest, width)
      const split = shown.lastIndexOf(' ')
      if (split > 0) {
        lines.push(shown.slice(0, split))
        rest = `${shown.slice(split + 1)}${tail}`
      } else {
        lines.push(shown)
        rest = tail
      }
    }
    lines.push(rest)
  }
  return lines
}

function timelineBox(lines: string[], width: number, s: Style): string[] {
  const room = Math.max(1, width - 4)
  const border = (text: string) => s.tone('muted', text)
  const line = (text: string) => {
    const fitted = fit(text, room)
    return `${border('│')} ${fitted}${' '.repeat(Math.max(0, room - visibleLength(fitted)))} ${border('│')}`
  }
  return [
    border(`╭${'─'.repeat(Math.max(0, width - 2))}╮`),
    ...lines.map(line),
    border(`╰${'─'.repeat(Math.max(0, width - 2))}╯`),
  ]
}

export function timelineProgressLines(progress: TimelinePage['progressCard'], width: number, s: Style): string[] {
  const room = Math.max(1, width - 6)
  const bar =
    progress.bar.map(part => s.tone(part.tone, part.mark.repeat(part.count))).join('') ||
    s.tone('muted', '─'.repeat(10))
  const head = `${s.bold('Progress')}  ${s.timelineChip(progress.tone, progress.statusLabel)}`
  const percent = s.bold(progress.percentLabel)
  const barLine =
    visibleLength(bar) + visibleLength(percent) + 2 <= room ? [spread(bar, percent, room)] : [bar, percent]
  const meta = `${progress.leavesDone}/${progress.leavesTotal} leaf tasks completed   Elapsed: ${progress.elapsed}`
  return timelineBox([head, ...barLine, s.dim(meta)], width, s)
}

function timelineStatsLines(
  stats: { progress: string; weight: string; completedUnitsLabel: string; completedUnits: string },
  width: number,
  s: Style,
): string[] {
  const values: [string, string][] = [
    ['Progress', stats.progress],
    ['Weight', stats.weight],
    [stats.completedUnitsLabel, stats.completedUnits],
  ]
  const cardWidth = Math.floor((width - 6) / values.length)
  if (cardWidth < 14) return values.flatMap(([label, value]) => timelineBox([s.dim(label), s.bold(value)], width, s))
  const cards = values.map(([label, value]) => timelineBox([s.dim(label), s.bold(value)], cardWidth, s))
  return cards[0]!.map((_, row) => cards.map(card => card[row]).join('  '))
}

function timelineLine(line: Line, plan: TimelineLinePlan, isSelected: boolean, d: Draw): string[] {
  const { ui, width, style: s } = d
  if (plan.kind === 'tree') {
    const row = plan.row
    const bar =
      row.progressBar.map(part => s.tone(part.tone, part.mark.repeat(part.count))).join('') ||
      s.tone('muted', '─'.repeat(10))
    const lead = ` ${isSelected ? s.tone('accent', '❯') : ' '} ${row.prefix}${s.tone(row.tone, row.mark)} `
    const metrics = `${bar} ${s.tone(row.tone, row.percent)}`
    const firstRoom = Math.max(1, width - visibleLength(lead) - visibleLength(metrics) - 2)
    const firstTitle = takeTimelineCells(row.task.title, firstRoom)
    const continuationRoom = Math.max(1, width - visibleLength(lead))
    const titleLines = [firstTitle.shown]
    let remaining = firstTitle.rest
    while (remaining) {
      const next = takeTimelineCells(remaining, continuationRoom)
      titleLines.push(next.shown)
      remaining = next.rest
    }
    const first = spread(`${lead}${s.tone(row.tone, s.bold(titleLines[0]!))}`, metrics, width)
    const toggle = line.buttons.find(button => button.press.action === 'timeline-toggle')
    const second = `     ${s.timelineChip(row.tone, row.statusLabel)}${toggle ? `  ${s.dim(`${toggle.key ?? ''} ${toggle.label}`)}` : ''}`
    const titleRest = titleLines
      .slice(1)
      .map(text => `${' '.repeat(visibleLength(lead))}${s.tone(row.tone, s.bold(text))}`)
    const warnings = row.warnings.flatMap(warning =>
      wrapTimelineText(warning, Math.max(1, width - 8)).map(
        (text, index) => `${' '.repeat(index === 0 ? 5 : 8)}${index === 0 ? `${s.tone('error', '⚠')} ` : ''}${text}`,
      ),
    )
    return [first, ...titleRest, second, ...warnings].map(text => s.timelineRow(fit(text, width), row.alternate))
  }

  const { selected } = plan
  const row = selected.row
  const back = line.buttons[0]
  const backText = back ? buttonCell(back, isSelected && focusOf(line, ui) === 0, s) : ''
  const status = s.timelineChip(row.tone, row.statusLabel)
  const detailIndent = visibleLength(row.detailLead)
  const titleWidth = Math.max(1, width - visibleLength(backText) - visibleLength(status) - 2)
  const title = wrapTimelineText(row.task.title, titleWidth)
  const head = `${backText} ${s.bold(title[0] ?? '')} ${status}`
  const out = [
    fit(head, width),
    ...title.slice(1).map(text => `${' '.repeat(visibleLength(backText) + 1)}${s.bold(text)}`),
    ...timelineStatsLines(selected.stats, width, s),
  ]
  for (const detail of selected.details) {
    if (detail.label === 'Links') {
      out.push(`${row.detailLead}${s.dim('Links')}`)
      const start = line.buttons.findIndex(button => button.press.action === 'pr-open')
      for (let index = start; index >= 0 && index < line.buttons.length; index++)
        out.push(`${row.detailLead}${buttonCell(line.buttons[index]!, isSelected && focusOf(line, ui) === index, s)}`)
    } else {
      out.push(`${row.detailLead}${s.dim(detail.label)}`)
      const indent = detailIndent + 2
      for (const text of detail.text.split('\n'))
        out.push(...wrapTimelineDetailText(text, Math.max(1, width - indent)).map(line => ' '.repeat(indent) + line))
    }
  }
  return out
}

/** `inner` in a rounded box in the tone, filled with its tint. Each inner line fits `width - 4` cells. */
export function boxed(inner: string[], tone: BannerTone, width: number, s: Style): string[] {
  const room = width - 4
  const fill = (l: string) => s.banner(tone, 'fill', ` ${l}${' '.repeat(Math.max(0, room - visibleLength(l)))} `)
  const side = s.banner(tone, 'line', '│')

  return [
    s.banner(tone, 'line', `╭${'─'.repeat(width - 2)}╮`),
    ...inner.map(l => `${side}${fill(l)}${side}`),
    s.banner(tone, 'line', `╰${'─'.repeat(width - 2)}╯`),
  ]
}

/** The most lines a selected review thread's comment takes. */
const BODY_LINES = 8

const LEAD_TONES: Record<BannerTone, Tone> = { error: 'error', warning: 'needsYou', notice: 'key', ask: 'key' }

/** A banner's lines: its lead in bold, in the tone's color, then its body, wrapped inside the box. */
export function bannerLines(b: BannerView, width: number, s: Style): string[] {
  const text = b.body ? `${b.lead} ${b.body}` : b.lead
  const lead = (w: string) => s.tone(LEAD_TONES[b.tone], s.bold(w))
  let leadWords = b.lead.split(/\s+/).length
  const lines = wrapText(text, width - 4).map(line =>
    line
      .split(' ')
      .map(w => (leadWords-- > 0 ? lead(w) : w))
      .join(' '),
  )

  return boxed(lines, b.tone, width, s)
}

function buttonCell(b: ButtonFace, isFocused: boolean, s: Style, mark = ''): string {
  const result =
    b.result?.state === 'done'
      ? s.tone('done', ' ✓ Opened')
      : b.result?.state === 'failed'
        ? s.tone('error', b.result.parts.find(part => part.error)?.error ?? '')
        : ''
  if (isFocused) return s.inverse(b.isOut ? s.dim(` ↵ ${b.label}${mark} `) : s.bold(` ↵ ${b.label}${mark} `)) + result
  if (b.isOut && !b.isFollowUp) return s.dim(b.key ? ` ${b.key} ${b.label}${mark} ` : ` ${b.label}${mark} `) + result
  if (b.isFollowUp || b.isQuiet) return s.dim(b.key ? ` ${b.key} ${b.label} ` : ` ${b.label} `) + result
  const label = (b.isRecommended ? s.underline(b.label) : b.label) + mark

  return (b.key ? ` ${s.bold(b.key)} ${label} ` : ` ${label} `) + result
}

/** What `actionLabel` adds to the label, measured on the focused cell, the widest form, alone on a line. */
function labelMark(b: ButtonFace, room: number, s: Style): string {
  const fits = (label: string) => visibleLength(buttonCell({ ...b, label }, true, s)) <= room

  return actionLabel({ label: b.label, isPrimary: b.isRecommended }, fits).slice(b.label.length)
}

function buttonLines(line: Line, ui: PanelUi, indent: number, width: number, s: Style): string[] {
  return faceLines(line.buttons, focusOf(line, ui), indent, width, s)
}

function timelineDetailLines(line: Line, ui: PanelUi, indent: number, width: number, s: Style): string[] {
  const linkStart = line.buttons.findIndex(button => button.press.action === 'pr-open')
  return (line.body ?? '').split('\n').flatMap(detail => {
    const head = line.timelineDetailLead ?? `${' '.repeat(indent)}└─ `
    if (detail === 'Links ·' && linkStart >= 0) {
      const label = `${head}${detail} `
      const buttons = faceLines(
        line.buttons.slice(linkStart),
        focusOf(line, ui) - linkStart,
        0,
        width - visibleLength(label),
        s,
      )
      return [
        fit(`${label}${buttons[0] ?? ''}`, width),
        ...buttons.slice(1).map(row => `${' '.repeat(visibleLength(label))}${row}`),
      ]
    }
    const headLength = visibleLength(head)
    const lines = indentedLinks(detail, headLength, width, Infinity, s.dim, s.link)
    return lines.map((text, index) => (index === 0 ? `${head}${text.slice(headLength)}` : text))
  })
}

/** Buttons laid out in lines from `indent`, the one at `focused` drawn focused. -1 focuses none. */
export function faceLines(
  buttons: ButtonFace[],
  focused: number,
  indent: number,
  width: number,
  s: Style,
  between = '',
): string[] {
  const cells = buttons.map((b, i) => buttonCell(b, i === focused, s, labelMark(b, width - indent, s)))
  const sizes = cells.map(visibleLength)
  const firstFollowUp = buttons.findIndex(b => b.isFollowUp)
  const keyCount = firstFollowUp < 0 ? cells.length : firstFollowUp
  const { lines } = actionLines(sizes.slice(0, keyCount), sizes.slice(keyCount), {
    width: width - indent,
    gap: visibleLength(between),
    separator: 0,
  })

  return lines.map(at => ' '.repeat(indent) + at.map(i => cells[i]).join(between))
}

/** `text` in a lead's tone. */
export function leadPaint(lead: Lead, text: string, s: Style): string {
  return lead.tone === 'dim' ? s.dim(text) : lead.tone ? s.tone(lead.tone, text) : text
}

/** A lead and the space after it, or nothing for a line with no lead. */
function leadText(lead: Lead | null, s: Style): string {
  return lead === null ? '' : `${leadPaint(lead, lead.padMark === false ? lead.text : lead.text.padEnd(2), s)} `
}

/** A result mark and the space after it. */
function markText(mark: ResultMark | null, now: number, s: Style): string {
  if (mark === null) return ''

  return `${feedbackPaint(mark.tone ?? null, s)(resultGlyph(mark, now))} `
}

export function feedbackPaint(tone: Tone | null, s: Style) {
  return (text: string) => (tone ? s.tone(tone, text) : s.dim(text))
}

/** A Status row's or legend entry's mark. A running mark draws the frame at `now`. */
export function paintMark(m: { mark: string; tone: Tone | null; isRunning: boolean }, now: number, s: Style): string {
  return feedbackPaint(m.tone, s)(m.isRunning ? runningMark(now) : textMark(m.mark))
}

export function drawLine(line: Line, isSelected: boolean, d: Draw): string[] {
  const { ui, width, now, style: s } = d
  if (line.timeline) return timelineLine(line, line.timeline, isSelected, d)
  if (line.isTabButtons) {
    const cursor = isSelected ? s.tone('accent', '❯') : ' '
    const cells = line.buttons.map((b, i) => buttonCell(b, isSelected && i === focusOf(line, ui), s))
    const title = line.title ? `${line.title}  ` : ''
    const head = ` ${cursor} `
    const buttons = `${head}${title}${cells.join('')}`
    const status = line.feedback ? `  ${feedbackPaint(line.feedback.tone, s)(line.feedback.text)}` : ''
    if (!status) return [fit(buttons, width)]
    const together = `${buttons}${status}`

    return visibleLength(together) <= width
      ? [together]
      : [fit(buttons, width), fit(`${' '.repeat(visibleLength(head))}${status}`, width)]
  }
  const pad = line.depth * 2
  const out: string[] = []
  const status = line.status
    ? `${line.status.separator ?? '  '}${line.status.tone ? s.tone(line.status.tone, line.status.text) : s.dim(line.status.text)}${s.dim(line.status.rest)}`
    : ''
  const statusUnder =
    line.feedback &&
    line.settled === null &&
    !isShut(line, ui) &&
    isStatusUnderActions(line.feedback.source, isSelected)
      ? line.feedback
      : null
  const mark = markText(line.mark, now, s)
  const after = line.settled
    ? `  ${mark}${line.settled.tone === 'done' ? s.tone('done', linkedText(line.settled.label, s.link)) : s.dim(linkedText(line.settled.label, s.link))}${line.settled.undo ? `  ${s.dim(`${UNDO_KEY} Undo`)}` : ''}`
    : line.feedback && !statusUnder
      ? `  ${mark}${feedbackPaint(line.feedback.tone, s)(linkedText(line.feedback.text, s.link))}`
      : ''
  // omp marks a selected item with ❯ by default and keeps ▸ and ▾ for expand and collapse.
  const cursor = isSelected ? s.tone('accent', line.selectionMark ?? '❯') : ' '
  const head = ` ${' '.repeat(pad)}${cursor} ${line.rank ? s.dim(line.rank) : ''}${leadText(line.lead, s)}`
  const titleText = linkedText(line.title, s.link)
  const age = line.age !== null && line.settled === null ? s.dim(ago(now - line.age)) : ''
  const besideAge = age ? width - visibleLength(`  ${age} `) : width
  const shownTitle = line.mark
    ? cutTitle(titleText, besideAge - visibleLength(head) - visibleLength(status) - visibleLength(after))
    : titleText
  const title = line.isDim
    ? s.dim(shownTitle)
    : line.titleTone
      ? s.tone(line.titleTone, s.bold(shownTitle))
      : isSelected
        ? s.bold(shownTitle)
        : shownTitle
  out.push(spread(fit(`${head}${title}${status}${after}`, besideAge), `${age} `, width))
  if (line.settled || isShut(line, ui)) return out
  const indent = (line.lead === null ? UNLED_INDENT : INDENT) + pad
  const contextLine = isSelected ? line.row?.contextLine : null
  if (contextLine) out.push(...indentedLinks(contextLine, indent, width, Infinity, s.dim, s.link))
  // A next build draws the Status, so only it names the subject an ask holds up.
  const holdsUp = d.screen.isNextBuild === true ? line.row?.holdsUpLine : null
  if (holdsUp) out.push(fit(`${' '.repeat(indent)}${s.tone(HELD_MARK.tone, HELD_MARK.mark)} ${s.dim(holdsUp)}`, width))
  const recLine = line.row?.recLine
  if (recLine)
    out.push(
      ...(isSelected
        ? indentedLinks(recLine, indent, width, 3, s.dim, s.link)
        : [fit(`${' '.repeat(indent)}${s.dim(linkedText(recLine, s.link))}`, width)]),
    )
  if (line.body && isSelected)
    out.push(
      ...(line.selectionMark === '>'
        ? timelineDetailLines(line, ui, indent, width, s)
        : indentedLinks(line.body, indent, width, BODY_LINES, t => t, s.link)),
    )
  if (line.detail && (isSelected || line.isDetailShown))
    out.push(
      ...indentedLinks(
        line.detail,
        indent,
        width,
        isSelected && line.row?.type !== 'finding' ? Infinity : 4,
        s.dim,
        s.link,
      ),
    )
  if (!isSelected) return out
  if (line.file) out.push(' '.repeat(indent) + s.tone('accent', line.file))
  for (const o of line.row?.optionDescriptions ?? [])
    out.push(fit(' '.repeat(indent) + o.label + s.dim(`: ${o.description}`), width))
  // As in the terminal, an open reply field replaces the row's buttons: Enter sends, so no button reads as focused.
  const hasInlineLinks = line.selectionMark === '>' && line.body?.includes('Links ·') === true
  const linkStart = hasInlineLinks ? line.buttons.findIndex(button => button.press.action === 'pr-open') : -1
  if (line.buttons.length > 0 && ui.typing !== line.id)
    out.push(
      ...(linkStart < 0
        ? buttonLines(line, ui, indent - 1, width, s)
        : faceLines(line.buttons.slice(0, linkStart), focusOf(line, ui), indent - 1, width, s)),
    )
  if (ui.typing === line.id) {
    const hint = line.row ? replyHint(line.row, AGENT) : 'Your reply'
    const text = ui.drafts[line.id]?.text ?? ''
    out.push(' '.repeat(indent) + s.dim(`${hint}:`))
    const field = wrapText(`${text}\u0000`, Math.max(10, width - indent - 1))
    out.push(...field.map(l => ' '.repeat(indent) + l.replace('\u0000', s.inverse(' '))))
  }
  if (statusUnder) {
    const markCells = mark ? 2 : 0
    const [first, ...rest] = indentedLinks(
      statusUnder.text,
      indent + markCells,
      width,
      4,
      feedbackPaint(statusUnder.tone, s),
      s.link,
    )
    if (first !== undefined) out.push(' '.repeat(indent) + mark + first.slice(indent + markCells), ...rest)
  }

  return out
}
