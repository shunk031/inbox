import { expect, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { wrapErrors, wrapText } from '../hooks/line-wrap'
const checked = (text: string, width: number) => {
  const plan = wrapText(text, width, cellWidth)
  expect(wrapErrors(plan, width, cellWidth)).toEqual([])
  return plan
}
test('seeded mixed wrapping', () => {
  let state = 0xc1c0ffee
  const random = (n: number) => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n
  expect(checked('「猫」', 4).map(({ text }) => text)).toEqual(['「猫', '」'])
  for (let i = 0; i < 2000; i++) {
    const width = 1 + (i % 20),
      a = ['alpha', 'beta', 'foo'][random(3)]!
    const spaces = ' '.repeat(1 + (i % 6)),
      list = width < 3 ? '- ' : `${width >= 5 && random(2) ? '  ' : ''}- ${a}`
    const input = `${list}\n${width === 1 ? `${a}${spaces}${a} (${a})!` : `${a}${spaces}${a}日本語${spaces}かな「𠀀」、${a}`}`
    const errors = wrapErrors(wrapText(input, width, cellWidth), width, cellWidth)
    expect(errors, `seed=c1c0ffee input=${input}`).toEqual([])
  }
})
const noStartChars = `’”）〕］｝〉》」』】〗⦆｠〙»〟)]}‐〜゠–!！?？‼⁇⁈⁉・:：;；。．.,、，ヽヾゝゞ々〻ーぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿｧｨｩｪｫｬｭｮｯ｡｣､･ｰﾞﾟ`
test('JLReq no-start characters', () => [...noStartChars].forEach(char => checked(`日本語${char}`, 4)))
