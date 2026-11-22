import { expect, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { wrapErrors, wrapText } from '../hooks/line-wrap'
import { wrappedSpanLines as spans } from '../hooks/terminal-text'
const errors = (s: string, w: number) => wrapErrors(wrapText(s, w, cellWidth), w, cellWidth)
test('seeded mixed wrapping', () => {
  let s = 0xc1c0ffee,
    r = (n: number) => (s = (s * 16807) % 2147483647) % n
  const draw = (s: string, w: number) => spans([{ text: s }], w, cellWidth).map(l => l.map(x => x.text).join(''))
  expect(errors('「猫」', 4)).toEqual([])
  expect(wrapText('「猫」', 4, cellWidth).map(({ text }) => text)).toEqual(['「猫', '」'])
  expect(draw('foo   bar', 7)).toEqual(['foo', 'bar'])
  for (let i = 0; i < 2000; i++) {
    const w = (i % 20) + 1
    const sp = ' '.repeat((i % 6) + 1),
      p = w >= 5 && r(2) ? '  - foo' : w < 3 ? '- ' : '- foo'
    const input = `${p}\n${w === 1 ? `foo${sp}foo (foo)!` : `foo${sp}foo日本語${sp}かな「𠀀」、foo`}`
    const lines = draw(input, w),
      ctx = `seed=c1c0ffee input=${input}`
    expect(lines.filter(l => cellWidth(l) > w).length, ctx).toBe(0)
    expect(wrapErrors(wrapText(input, w, cellWidth), w, cellWidth, lines), ctx).toEqual([])
  }
})
test('mixed CJK text can keep ASCII spaces out of preferred wrap points', () => {
  const text = '配置確認用の文 sample 2 と結果を見ます。'
  const defaultLines = wrapText(text, 21, cellWidth).map(line => line.text)
  const plans = wrapText(text, 21, cellWidth, { keepCjkSpaces: true })
  const lines = plans.map(line => line.text)

  expect(defaultLines.some(line => line.endsWith('sample'))).toBe(true)
  expect(lines.some(line => line.endsWith('sample') || line.endsWith('sample 2'))).toBe(false)
  expect(wrapErrors(plans, 21, cellWidth)).toEqual([])
})
const noStartChars = `’”）〕］｝〉》」』】〗⦆｠〙»〟)]}‐〜゠–!！?？‼⁇⁈⁉・:：;；。．.,、，ヽヾゝゞ々〻ーぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿｧｨｩｪｫｬｭｮｯ｡｣､･ｰﾞﾟ`
test('JLReq no-start', () => [...noStartChars].forEach(c => expect(errors(`日本語${c}`, 4)).toEqual([])))
