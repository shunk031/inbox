type SourceRange = { sourceStart: number; sourceEnd: number }
type WrapLine = SourceRange & { text: string; prefix: string; wrapped: boolean; nextUnit: string | null }
const CJK = /^[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3fffd}]$/u
const NO_START =
  /^[’”）〕］｝〉》」』】〗⦆｠〙»〟)\]\}‐〜゠–!！?？‼⁇⁈⁉・:：;；。．.,、，ヽヾゝゞ々〻ーぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿｧｨｩｪｫｬｭｮｯ｡｣､･ｰﾞﾟ]$/u
const NO_END = /^[‘“（〔［｛〈《「『【⦅｟〘〖«〝｢({\[]$/u // JLReq character classes: https://www.w3.org/TR/jlreq/#character_classes
const blocked = (left: string, right: string) => NO_START.test(right) || NO_END.test(left)
function kinsokuCluster(left: string, right: string): string {
  const [before, after] = [Array.from(left), Array.from(right)]
  let start = before.length - Number(!NO_END.test(before.at(-1) ?? '')),
    end = NO_START.test(after[0] ?? '') ? 0 : Math.min(1, after.length)
  while (start && NO_END.test(before[start - 1]!)) start--
  while (end < after.length && NO_START.test(after[end]!)) end++
  return [...before.slice(start), ...after.slice(0, end)].join('')
}
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
  { keepCjkSpaces = false }: { keepCjkSpaces?: boolean } = {},
): WrapLine[] {
  const parts = text.split('\n'),
    max = Math.max(1, width)
  const output: WrapLine[] = []
  let offset = 0
  for (const [paragraphIndex, paragraph] of parts.entries()) {
    const keepParagraphSpaces = keepCjkSpaces && Array.from(paragraph).some(character => CJK.test(character))
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
        nextUnit: next === null ? null : `${line.slice(kept.length)}${next}`,
      })
      line = ''
      prefix = hanging
      firstLine = false
      start = end
    }
    const measureLine = (next: string) => measure(prefix + (line + next).trimEnd())
    const units: { text: string; start: number }[] = []
    let part = '',
      partStart = offset + marker.length,
      at = partStart,
      previous = ''
    for (const current of Array.from(paragraph.slice(marker.length))) {
      if (
        part &&
        current !== ' ' &&
        !blocked(previous, current) &&
        ((previous === ' ' && !keepParagraphSpaces) || CJK.test(previous) || CJK.test(current)) &&
        !(keepParagraphSpaces && previous === ' ' && CJK.test(current))
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
      if (line.length > (firstLine ? marker.length : 0) && measureLine(rest) > max) {
        const skipped = rest.length - rest.trimStart().length
        emit(rest)
        rest = rest.trimStart()
        start = restStart = unit.start + skipped
      }
      while (rest && measureLine(rest) > max) {
        const chars = Array.from(rest)
        let count = chars.length
        while (count && measureLine(chars.slice(0, count).join('')) > max) count--
        if (!count) {
          if (!line.trim()) throw new RangeError('wrap width cannot fit the next character')
          const skipped = rest.length - rest.trimStart().length
          emit(rest)
          rest = rest.trimStart()
          start = restStart += skipped
          continue
        }
        const fitsKinsoku = (at: number) =>
          blocked(chars[at - 1]!, chars[at]!) &&
          measure(kinsokuCluster(chars.slice(0, at).join(''), chars.slice(at).join(''))) <= max
        while (count > 1 && count < chars.length && fitsKinsoku(count)) count--
        const take = chars.slice(0, count).join(''),
          next = chars.slice(count).join('')
        line += take
        end = restStart + take.length
        const skipped = next.length - next.trimStart().length
        rest = next.trimStart()
        if (rest) emit(next)
        restStart = end + skipped
      }
      if (rest) {
        if (!line) start = restStart
        line += rest
        end = restStart + rest.length
      }
    }
    if (line || !paragraph) emit(null)
    offset += paragraph.length + (paragraphIndex < parts.length - 1 ? 1 : 0)
  }
  return output
}
export function wrapErrors(
  plans: WrapLine[],
  width: number,
  measure: (text: string) => number,
  shown = plans.map(l => l.text),
): string[] {
  const errors: string[] = []
  plans.forEach((plan, i) => {
    const text = shown[i] ?? '',
      content = text.slice(plan.prefix.length),
      line = `line ${i + 1}`
    if (measure(text) > width) errors.push(`${line} exceeds width`)
    if (plan.prefix && !text.startsWith(plan.prefix)) errors.push(`${line} loses its hanging indent`)
    const prior = plans[i - 1]
    const previous = prior?.wrapped ? (shown[i - 1] ?? '').slice(prior.prefix.length).trimEnd() : ''
    const next = (shown[i + 1] ?? '').slice(plans[i + 1]?.prefix.length ?? 0)
    if (NO_START.test(Array.from(content)[0] ?? '') && measure(kinsokuCluster(previous, content)) <= width)
      errors.push(`${line} starts with blocked punctuation`)
    if (plan.wrapped && NO_END.test(content.at(-1) ?? '') && measure(kinsokuCluster(content.trimEnd(), next)) <= width)
      errors.push(`${line} ends after an opening character`)
    if (plan.wrapped && measure(text + (plan.nextUnit ?? '')) <= width) errors.push(`${line} could fit its next unit`)
  })
  return errors
}
