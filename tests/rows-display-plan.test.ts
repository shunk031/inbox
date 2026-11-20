import { expect, test } from 'claude-code/testing'
import {
  NO_BACKGROUND_GIVEN,
  NO_EFFECT_GIVEN,
  contextDisplayLineOf,
  contextLineOf,
  optionDescriptionLine,
  optionDescriptionsOf,
  optionEffectsOf,
  questionContextOf,
} from '../hooks/rows'
import type { ActionView } from '../hooks/rows'
import { cellWidth } from '../hooks/text'
import { EMPTY } from '../hooks/ledger'
import { inboxText, screenText } from '../hooks/inbox-text'
import { CLAUDE_CODE } from '../hooks/model-text'

const answer = (option: string) => ({ press: { action: 'answer', option }, isFolded: false }) as ActionView
const effect = (notes: Record<string, string>, option: string) =>
  optionEffectsOf({ optionDescriptions: notes }, [answer(option)])[0]?.description

test('context', () => expect(questionContextOf({ context: 'Invented event.' })).toBe('Invented event.'))
test('missing context stays separate from the row marker', () => {
  expect(contextLineOf('question', null)).toBeNull()
  expect(contextDisplayLineOf('question', null)).toBe(NO_BACKGROUND_GIVEN)
  expect(contextDisplayLineOf('task', null)).toBeNull()
  expect(contextDisplayLineOf('finding', null)).toBeNull()
})
test('option effect', () => expect(effect({ Keep: 'Keeps it.' }, 'Keep')).toBe('Keeps it.'))
test('missing option effect', () => expect(effect({}, 'Try')).toBe(NO_EFFECT_GIVEN))
test('looks without marker drawing keep missing option effects out of their descriptions', () => {
  expect(optionDescriptionsOf({}, [answer('Try')])).toEqual([])
})
test('missing effect is one muted suffix, and the label shrinks first when it does not fit', () => {
  const missing = optionEffectsOf({}, [answer('Shorten the labels')])[0]!
  const line = optionDescriptionLine(missing, text => cellWidth(text) <= 23)

  expect(line).toEqual({ label: 'Short…', suffix: ': No effect given', suffixTone: 'muted' })
  expect(cellWidth(`${line.label}${line.suffix}`)).toBeLessThanOrEqual(23)
})

test('question context does not change screenText or inbox text sent to the model', () => {
  const item = {
    id: 'i1',
    kind: 'question' as const,
    label: '1',
    ask: 'Use Node or Python?',
    options: ['Node', 'Python'],
    rec: 'Node',
    helps: [],
    turn: 1,
    at: 0,
    from: 'record' as const,
  }
  const modelText = (context?: string) => {
    const ledger = { ...EMPTY, turn: 1, items: [{ ...item, ...(context ? { context } : {}) }] }

    return [screenText(CLAUDE_CODE, true, { label: 'Asks', isPage: false }), inboxText(CLAUDE_CODE, ledger, true)].join(
      '\n',
    )
  }
  const expected = [
    'The /inbox pane is open beside the conversation, on its Asks tab, listing every open item.',
    'inbox: what waits on the user, as of your last reply. Anything not listed here is closed. A close id is only for the close tool. Never write one in a reply.',
    'Waiting on the user:',
    '- (1) "Use Node or Python?"; options: Node / Python; recommended: Node (close id: i1)',
    'The user has the /inbox pane open beside the conversation.',
  ].join('\n')

  expect(modelText()).toBe(expected)
  expect(modelText('Invented prior event.')).toBe(expected)
})
