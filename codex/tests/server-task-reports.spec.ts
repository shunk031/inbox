import assert from 'node:assert/strict'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { taskReportPage, readTaskReportQueue } from '../../hooks/task-report'
import { timelinePage } from '../../hooks/timeline-page'
import type { TabView } from '../src/core'
import { updateState } from '../src/state'
import { setup } from './server-fixtures'
import { tempDir } from './helpers'

test('Codex Timeline shows a DONE owner report, its PR facts, and the no-report state', async () => {
  const stateDir = join(tempDir(), 'meta-patrol')
  mkdirSync(stateDir)
  const queuePath = join(stateDir, 'queue.jsonl')
  writeFileSync(queuePath, `${JSON.stringify({ seq: 3, t: 100, from: 'worker', text: 'DONE Release is ready' })}\n`)
  const { dir, call } = await setup(
    0,
    () => 100,
    async () => 'codex',
    false,
    undefined,
    undefined,
    () => readTaskReportQueue({ HERDR_META_PATROL_STATE_DIR: stateDir }, path => readFile(path, 'utf8')),
  )
  const pr = 'https://github.com/example/repo/pull/12'
  await updateState(dir, 's1', s => ({
    ...s,
    taskTree: [
      {
        id: 'release',
        parentId: null,
        status: 'working',
        weight: 1,
        title: 'Ship the release',
        detail: '',
        notes: [],
        createdAt: 1,
        updatedAt: 1,
        history: [],
        links: { owner: { agent: 'worker', machine: 'local' }, pr },
      },
    ],
    taskPrStates: { [pr]: 'OPEN' },
    taskPrCiStates: { [pr]: 'passing' },
  }))

  const request = () => call('inbox_view', {}, { thread_id: 's1' })
  const response = (await request()) as unknown as { result: { structuredContent: TabView } }
  const view = response.result.structuredContent
  assert.equal(view.timeline.rows[0]?.task.status, 'done')
  const makePage = () =>
    taskReportPage(
      timelinePage(view.timeline, 'release', [], view.lastActions, true),
      view.timeline.rows.map(row => row.task),
      view.taskReportQueue ?? '',
      { taskPrStates: view.taskPrStates ?? {}, taskPrCiStates: view.taskPrCiStates ?? {} },
      view.at,
    )
  const page = makePage()
  assert.equal(page.rows[0]?.statusLabel, 'Completed')
  assert.match(page.rows[0]?.reportLine ?? '', /DONE Release is ready · now · PR open · CI passing/)
  const report = page.selected?.details[0]
  assert.ok(report?.label === 'Latest report')
  assert.match(report.text, /DONE Release is ready/)

  unlinkSync(queuePath)
  const missing = (await request()) as unknown as { result: { structuredContent: TabView } }
  const missingView = missing.result.structuredContent
  const missingPage = taskReportPage(
    timelinePage(missingView.timeline, 'release', [], missingView.lastActions, true),
    missingView.timeline.rows.map(row => row.task),
    missingView.taskReportQueue ?? '',
    { taskPrStates: missingView.taskPrStates ?? {}, taskPrCiStates: missingView.taskPrCiStates ?? {} },
    missingView.at,
  )
  assert.match(missingPage.rows[0]?.reportLine ?? '', /No report yet · PR open · CI passing/)
})
