import { expect, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { wrapErrors, wrapText } from '../hooks/line-wrap'

const checked = (text: string, width: number) => {
  const plan = wrapText(text, width, cellWidth)
  expect(wrapErrors(plan, width, cellWidth)).toEqual([])
  return plan
}
const sample =
  'A mixed ASCII/Japanese sentence 日本語の続き。\na deliberatelylongasciiwordthatmustfit\n- 1 体目と同じ方法で判定する。\n  - 約 13 件を手元の 3 モデルで確認した。'
test('CJK wrapping fits, hangs nested lists and avoids illegal breaks', () => {
  for (const width of [12, 20, 75]) checked(sample, width)
  expect(checked('「猫」', 4).map(({ text }) => text)).toEqual(['「猫', '」'])
  expect(checked('あゕ', 2).map(({ text }) => text)).toEqual(['あ', 'ゕ'])
  expect(checked('日本、', 4).map(({ text }) => text)).toEqual(['日', '本、'])
  checked('foo bar', 6)
  const list = '- 1 体目と同じ方法で判定する。\n  - 約 13 件を手元の 3 モデルで確認した。'
  const plan = checked(list, 12)
  const top = plan.filter(line => line.sourceStart < list.indexOf('  - 約'))
  const lines = plan.filter(line => line.sourceStart >= list.indexOf('  - 約'))
  expect(top.slice(1).every(line => line.prefix === '  ')).toBe(true)
  expect(lines.slice(1).every(line => line.prefix === '    ')).toBe(true)
  const line = checked('手元の 3 モデルで判定した。', 12)[0]!
  expect(wrapErrors([{ ...line, text: '手元の 3', wrapped: true, nextUnit: 'モ' }], 12, cellWidth)).not.toEqual([])
})
