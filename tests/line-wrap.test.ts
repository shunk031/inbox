import { describe, expect, test } from 'claude-code/testing'
import { cellWidth } from '../hooks/text'
import { wrapErrors, wrapText } from '../hooks/line-wrap'

const examples = [
  'A mixed ASCII/Japanese sentence 日本語の続き。',
  'a deliberatelylongasciiwordthatmustfit',
  '- 親の項目が続く説明です。\n  - 子の項目も長い日本語で続きます、最後まで確認する。「引用の続き」',
].join('\n')
describe('wrapText', () => {
  test('fits Japanese, mixed text, long ASCII words and nested lists at each width', () => {
    for (const width of [12, 20, 75]) {
      const lines = wrapText(examples, width, cellWidth)
      expect(wrapErrors(lines, width, cellWidth)).toEqual([])
    }
  })
  test('hangs top-level and nested list continuations under their item text', () => {
    const text = '- 1 体目と同じ方法で判定する。\n  - 約 13 件を手元の 3 モデルで確認した。'
    const lines = wrapText(text, 12, cellWidth)
    const nestedAt = text.indexOf('  - 約')
    const topLines = lines.filter(line => line.sourceStart < nestedAt)
    const nestedLines = lines.filter(line => line.sourceStart >= nestedAt)
    expect(topLines[0]?.prefix).toBe('')
    expect(topLines.slice(1).every(line => line.prefix === '  ')).toBe(true)
    expect(nestedLines[0]?.prefix).toBe('')
    expect(nestedLines.slice(1).every(line => line.prefix === '    ')).toBe(true)
  })
  test('the last-space mutation fails when the next allowed break unit still fits', () => {
    const text = '手元の 3 モデルで判定した。'
    const lastSpace = text.lastIndexOf(' ', text.indexOf('モデル'))
    const line = {
      text: text.slice(0, lastSpace).trimEnd(),
      sourceStart: 0,
      sourceEnd: lastSpace,
      prefix: '',
      wrapped: true,
      nextUnit: 'モ',
    }

    expect(wrapErrors([line], 12, cellWidth)).not.toEqual([])
  })
})
