import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { test } from 'node:test'

import { RECORDED_ITEMS_ONLY } from '../../hooks/session-host'
import { readState, updateState } from '../src/state'
import { runUpdates } from '../src/update'
import { ledgerOnly, tempDir } from './helpers'
import { ex, LEDGER_ANSWER } from './update-fixtures'

for (const [value, asks] of [
  ['1', []],
  [undefined, ['Deploy now?']],
] as const) {
  test(`with ${RECORDED_ITEMS_ONLY} ${value ?? 'unset'}, an update adds ${asks.length === 0 ? 'no ask' : 'the ask it found'}`, async t => {
    const dir = tempDir()
    const before = process.env[RECORDED_ITEMS_ONLY]
    if (value === undefined) delete process.env[RECORDED_ITEMS_ONLY]
    else process.env[RECORDED_ITEMS_ONLY] = value
    t.after(async () => {
      if (before === undefined) delete process.env[RECORDED_ITEMS_ONLY]
      else process.env[RECORDED_ITEMS_ONLY] = before
      await rm(dir, { recursive: true, force: true })
    })
    await updateState(dir, 's1', s => ({ ...s, pending: [{ ex: ex(1, 'Should I deploy?'), turnsStarted: 1 }] }))

    await runUpdates(
      dir,
      's1',
      ledgerOnly(async () => LEDGER_ANSWER),
      () => 5,
    )

    const s = await readState(dir, 's1')
    assert.deepEqual(s.pending, [])
    assert.deepEqual(
      s.ledger.items.map(i => i.ask),
      asks,
    )
  })
}
