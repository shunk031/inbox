type WrapLine = {
  text: string
  sourceStart: number
  sourceEnd: number
  prefix: string
  wrapped: boolean
  nextUnit: string | null
}

const CJK = /^[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3fffd}]$/u
const NO_START = /^[、。，．・：；？！ー」』）］｝〕〉》ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]$/u
const NO_END = /^[「『（［｛〔〈《]$/u
const blocked = (left: string, right: string) => NO_START.test(right) || NO_END.test(left)
/** Wrap at spaces and CJK boundaries, keeping JLReq no-start and no-end characters with their neighbors. */
export function wrapText(text: string, width: number, measure: (text: string) => number): WrapLine[] {
  const output: WrapLine[] = []
  const limit = Math.max(1, width)
  const paragraphs = text.split('\n')
  let offset = 0
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const marker = /^( *)(- )/u.exec(paragraph)?.[0] ?? ''
    const hanging = marker ? ' '.repeat(marker.length) : ''
    let prefix = '',
      line = marker,
      firstLine = true,
      start = offset,
      end = offset + marker.length
    const emit = (next: string | null) => {
      const kept = line.trimEnd()
      output.push({
        text: prefix + kept,
        sourceStart: start,
        sourceEnd: end - (line.length - kept.length),
        prefix,
        wrapped: next !== null,
        nextUnit: next === null ? null : `${/ +$/u.test(line) ? ' ' : ''}${next}`,
      })
      line = ''
      prefix = hanging
      firstLine = false
      start = end
    }
    const chars = Array.from(paragraph.slice(marker.length))
    const units: { text: string; start: number }[] = []
    let part = '',
      partStart = offset + marker.length,
      at = partStart,
      previous = ''
    for (const current of chars) {
      if (
        part &&
        current !== ' ' &&
        !blocked(previous, current) &&
        (previous === ' ' || CJK.test(previous) || CJK.test(current))
      ) {
        units.push({ text: part, start: partStart })
        part = ''
        partStart = at
      }
      part += current
      previous = current
      at += current.length
    }
    if (part) units.push({ text: part, start: partStart })
    for (const unit of units) {
      let rest = unit.text,
        restStart = unit.start
      if (
        line.length > (firstLine ? marker.length : 0) &&
        measure(prefix + line.replace(/ +$/u, ' ') + rest.trimEnd()) > limit
      ) {
        const skipped = rest.length - rest.trimStart().length
        rest = rest.trimStart()
        emit(rest)
        restStart = unit.start + skipped
        start = restStart
      }
      while (rest && measure(prefix + line + rest) > limit) {
        const chars = Array.from(rest)
        let take = ''
        while (chars.length && measure(prefix + line + take + chars[0]) <= limit) take += chars.shift()
        if (!take) take = chars.shift() ?? rest
        let next = chars.join('')
        while (next && (NO_START.test(Array.from(next)[0]!) || NO_END.test(Array.from(take).at(-1) ?? ''))) {
          const moved = Array.from(take).pop()
          if (!moved) break
          take = take.slice(0, -moved.length)
          chars.unshift(moved)
          next = chars.join('')
        }
        if (!take) {
          take = rest
          chars.length = 0
          next = ''
        }
        line += take
        end = restStart + take.length
        const skipped = next.length - next.trimStart().length
        rest = next.trimStart()
        if (rest) emit(rest)
        restStart = end + skipped
      }
      if (rest) {
        if (!line) start = restStart
        line += rest
        end = restStart + rest.length
      }
    }
    if (line || !paragraph) emit(null)
    offset += paragraph.length + (paragraphIndex < paragraphs.length - 1 ? 1 : 0)
  }
  return output
}

export function wrapErrors(
  plans: WrapLine[],
  width: number,
  measure: (text: string) => number,
  shown = plans.map(line => line.text),
): string[] {
  const errors: string[] = []
  plans.forEach((plan, i) => {
    const text = shown[i] ?? ''
    const line = `line ${i + 1}`
    if (measure(text) > width) errors.push(`${line} exceeds width`)
    if (plan.prefix && !text.startsWith(plan.prefix)) errors.push(`${line} loses its hanging indent`)
    if (NO_START.test(text.slice(plan.prefix.length))) errors.push(`${line} starts with blocked punctuation`)
    if (plan.wrapped && NO_END.test(text.at(-1) ?? '')) errors.push(`${line} ends after an opening character`)
    if (plan.wrapped && measure(text + (plan.nextUnit ?? '')) <= width) errors.push(`${line} could fit its next unit`)
  })
  return errors
}
