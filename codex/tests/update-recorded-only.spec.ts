import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { RECORDED_ITEMS_ONLY } from '../../hooks/session-host'
import { readState, updateState } from '../src/state'
import { tempDir } from './helpers'
import { ex, LEDGER_ANSWER } from './update-fixtures'

for (const [value, asks] of [
  ['1', []],
  ['true', []],
  ['TRUE', ['Deploy now?']],
  ['0', ['Deploy now?']],
  ['false', ['Deploy now?']],
  [undefined, ['Deploy now?']],
] as const) {
  test(`the update process reads ${RECORDED_ITEMS_ONLY}=${value ?? 'unset'}`, async t => {
    const dir = tempDir()
    t.after(() => rm(dir, { recursive: true, force: true }))

    const cli = join(dir, 'codex')
    await writeFile(
      cli,
      `#!/usr/bin/env node
const fs = require('node:fs')
const output = process.argv.indexOf('-o')
if (output < 0) process.exit(2)
fs.writeFileSync(process.argv[output + 1], ${JSON.stringify(LEDGER_ANSWER)})
`,
    )
    await chmod(cli, 0o755)
    await updateState(dir, 's1', s => ({
      ...s,
      cliPath: cli,
      pending: [{ ex: ex(1, 'Should I deploy?'), turnsStarted: 1 }],
    }))

    const env = {
      CODEX_HOME: join(dir, 'codex-home'),
      INBOX_DATA: dir,
      PATH: process.env.PATH ?? '',
      ...(value === undefined ? {} : { [RECORDED_ITEMS_ONLY]: value }),
    }
    const update = fileURLToPath(new URL('../plugin/dist/update.mjs', import.meta.url))
    const child = spawn(process.execPath, [update, 's1'], { env, stdio: 'ignore' })
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)

    const s = await readState(dir, 's1')
    assert.deepEqual(s.pending, [])
    assert.deepEqual(
      s.ledger.items.map(i => i.ask),
      asks,
    )
  })
}
