import { readFile } from 'node:fs/promises'

import { readTaskReportQueue } from '../../hooks/task-report'

export function readOmpTaskReportQueue() {
  return readTaskReportQueue(
    { HOME: process.env.HOME, HERDR_META_PATROL_STATE_DIR: process.env.HERDR_META_PATROL_STATE_DIR },
    path => readFile(path, 'utf8'),
  )
}
