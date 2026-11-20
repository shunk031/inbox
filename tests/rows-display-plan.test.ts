import { expect, test } from 'claude-code/testing'
import { NO_BACKGROUND_GIVEN, NO_EFFECT_GIVEN, optionDescriptionsOf, questionContextOf } from '../hooks/rows'
import type { ActionView } from '../hooks/rows'

const answer = (option: string) => ({ press: { action: 'answer', option }, isFolded: false }) as ActionView
const effect = (notes: Record<string, string>, option: string) =>
  optionDescriptionsOf({ optionDescriptions: notes }, [answer(option)])[0]?.description

test('context', () => expect(questionContextOf({ context: 'Invented event.' })).toBe('Invented event.'))
test('missing context', () => expect(questionContextOf({})).toBe(NO_BACKGROUND_GIVEN))
test('option effect', () => expect(effect({ Keep: 'Keeps it.' }, 'Keep')).toBe('Keeps it.'))
test('missing option effect', () => expect(effect({}, 'Try')).toBe(NO_EFFECT_GIVEN))
