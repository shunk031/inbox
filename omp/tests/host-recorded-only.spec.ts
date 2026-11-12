import { afterEach, beforeEach, expect, test } from 'bun:test'

import { createInbox } from '../src/host'
import { deps, endAgent, endWorld, pi, prompt, settle, startWorld, state } from './host-harness'

beforeEach(startWorld)
afterEach(endWorld)

test('with INBOX_RECORDED_ITEMS_ONLY=1, a reply whose question the agent did not record adds no ask', async () => {
  createInbox(pi(), { ...deps(), recordedItemsOnly: '1' })
  await prompt('Add a greeting CLI')
  await endAgent('Plan written. Which runtime?')
  await settle()
  expect(state().pending).toEqual([])
  expect(state().ledger.items).toEqual([])
})
