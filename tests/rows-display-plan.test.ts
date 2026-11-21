import { expect, test } from 'claude-code/testing'
import * as rows from '../hooks/rows'
import { cellWidth } from '../hooks/text'
import { EMPTY } from '../hooks/ledger'
import { closeByAgent } from '../hooks/ledger-close'
import { inboxText, screenText } from '../hooks/inbox-text'
import { CLAUDE_CODE } from '../hooks/model-text'
import { emptySession } from '../hooks/session-files'
import { sessionView } from '../hooks/session-view'
import type { Item } from '../types'

const answer = (option: string) => ({ press: { action: 'answer', option }, isFolded: false }) as rows.ActionView
const effect = (notes: Record<string, string>, option: string) =>
  rows.optionEffectsOf({ optionDescriptions: notes }, [answer(option)])[0]?.description
// prettier-ignore
const item: Item = {
  id: 'i1', kind: 'question', label: '1', ask: 'Use Node or Python?', context: 'Invented event.',
  options: ['Node', 'Python'], rec: 'Node', helps: [], turn: 1, at: 0, from: 'record',
}
test('context, blank values and inherited option names use missing markers', () => {
  expect(rows.questionContextOf({ context: 'Invented event.' })).toBe('Invented event.')
  expect(rows.contextLineOf('question', null)).toBeNull()
  const cases = ['', '  ', undefined] as const
  for (const value of cases) {
    const item = value === undefined ? null : { context: value }
    const optionDescriptions: Record<string, string> = value === undefined ? {} : { Try: value }
    const effectLine = rows.optionDescriptionLine(rows.optionEffectsOf({ optionDescriptions }, [answer('Try')])[0]!)
    expect(rows.contextDisplayLineOf('question', item)).toBe(rows.NO_BACKGROUND_GIVEN)
    expect(effectLine).toEqual({ label: 'Try', suffix: ': No effect given', suffixTone: 'muted' })
  }
  const optionCases = { Keep: 'Keeps it.', toString: rows.NO_EFFECT_GIVEN }
  for (const [option, expected] of Object.entries(optionCases))
    expect(effect({ Keep: 'Keeps it.' }, option)).toBe(expected)

  for (const type of ['task', 'finding'] as const) expect(rows.contextDisplayLineOf(type, null)).toBeNull()
  expect(rows.optionDescriptionsOf({}, [answer('Try')])).toEqual([])
})
test('a held question has no selected-row context line', () => {
  const { ledger } = closeByAgent(CLAUDE_CODE, { ...EMPTY, items: [item] }, item.id, { reason: 'later' }, 1)
  const holds = { replies: { [item.id]: 0 }, discarded: {}, shownSince: 0, listInput: null }
  const row = sessionView({ ...emptySession(), ledger }, 2, 30_000, holds).needsYou.questions[0]!
  expect(row.state.is).toBe('held')
  expect(row.contextLine).toBeNull()
})
test('missing effect is one muted suffix, and the label shrinks first when it does not fit', () => {
  const line = rows.optionDescriptionLine(
    rows.optionEffectsOf({}, [answer('Shorten the labels')])[0]!,
    text => cellWidth(text) <= 23,
  )
  expect(line).toEqual({ label: 'Short…', suffix: ': No effect given', suffixTone: 'muted' })
  expect(cellWidth(`${line.label}${line.suffix}`)).toBeLessThanOrEqual(23)
})
test('question context does not change screenText or inbox text sent to the model', () => {
  const modelText = (context?: string) => {
    const ledger = { ...EMPTY, turn: 1, items: [{ ...item, ...(context ? { context } : {}) }] }
    return `${screenText(CLAUDE_CODE, true, { label: 'Asks', isPage: false })}\n${inboxText(CLAUDE_CODE, ledger, true)}`
  }
  const expected =
    'The /inbox pane is open beside the conversation, on its Asks tab, listing every open item.\ninbox: what waits on the user, as of your last reply. Anything not listed here is closed. A close id is only for the close tool. Never write one in a reply.\nWaiting on the user:\n- (1) "Use Node or Python?"; options: Node / Python; recommended: Node (close id: i1)\nThe user has the /inbox pane open beside the conversation.'
  expect(modelText()).toBe(expected)
  expect(modelText('Invented prior event.')).toBe(expected)
})
