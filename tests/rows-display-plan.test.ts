import { expect, test } from 'claude-code/testing'
import {
  NO_BACKGROUND_GIVEN,
  NO_EFFECT_GIVEN,
  contextLineOf,
  optionDescriptionLine,
  optionDescriptionsOf,
  questionContextOf,
} from '../hooks/rows'
import type { ActionView } from '../hooks/rows'
import { cellWidth } from '../hooks/text'

const answer = (option: string) => ({ press: { action: 'answer', option }, isFolded: false }) as ActionView
const effect = (notes: Record<string, string>, option: string) =>
  optionDescriptionsOf({ optionDescriptions: notes }, [answer(option)])[0]?.description

test('context', () => expect(questionContextOf({ context: 'Invented event.' })).toBe('Invented event.'))
test('missing context', () => expect(questionContextOf({})).toBe(NO_BACKGROUND_GIVEN))
test('only a question gets the missing-background marker', () => {
  expect(contextLineOf('question', null)).toBe(NO_BACKGROUND_GIVEN)
  expect(contextLineOf('task', null)).toBeNull()
  expect(contextLineOf('finding', null)).toBeNull()
})
test('option effect', () => expect(effect({ Keep: 'Keeps it.' }, 'Keep')).toBe('Keeps it.'))
test('missing option effect', () => expect(effect({}, 'Try')).toBe(NO_EFFECT_GIVEN))
test('missing effect is one muted suffix, and the label shrinks first when it does not fit', () => {
  const missing = optionDescriptionsOf({}, [answer('Shorten the labels')])[0]!
  const line = optionDescriptionLine(missing, text => cellWidth(text) <= 23)

  expect(line).toEqual({ label: 'Short…', suffix: ': No effect given', suffixTone: 'muted' })
  expect(cellWidth(`${line.label}${line.suffix}`)).toBeLessThanOrEqual(23)
})
