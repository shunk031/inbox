import { expect, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { wrapErrors, wrapText } from '../hooks/line-wrap'

const measure = cellWidth
const sample =
  'A mixed ASCII/Japanese sentence 日本語の続き。\na deliberatelylongasciiwordthatmustfit\n- 1 体目と同じ方法で判定する。\n  - 約 13 件を手元の 3 モデルで確認した。'

test('CJK wrapping fits, hangs nested lists and avoids illegal breaks', () => {
  for (const width of [12, 20, 75]) expect(wrapErrors(wrapText(sample, width, measure), width, measure)).toEqual([])
  expect(wrapText('「猫」', 4, measure).map(({ text }) => text)).toEqual(['「猫」'])
  const punctuation = wrapText('日本、', 4, measure)
  expect(punctuation.map(({ text }) => text)).toEqual(['日', '本、'])
  expect(wrapErrors(punctuation, 4, measure)).toEqual([])
  expect(wrapErrors(wrapText('foo bar', 6, measure), 6, measure)).toEqual([])
  const list = '- 1 体目と同じ方法で判定する。\n  - 約 13 件を手元の 3 モデルで確認した。'
  const nestedAt = list.indexOf('  - 約')
  const plan = wrapText(list, 12, measure)
  const top = plan.filter(line => line.sourceStart < nestedAt)
  const lines = plan.filter(line => line.sourceStart >= nestedAt)
  expect(top.slice(1).every(line => line.prefix === '  ')).toBe(true)
  expect(lines.slice(1).every(line => line.prefix === '    ')).toBe(true)
  const line = wrapText('手元の 3 モデルで判定した。', 12, measure)[0]!
  expect(wrapErrors([{ ...line, text: '手元の 3', wrapped: true, nextUnit: 'モ' }], 12, measure)).not.toEqual([])
})
