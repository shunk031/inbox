import { readFile } from 'node:fs/promises'

import type { Session } from '../../types'
import { readTaskReportQueue, taskTextFacts } from '../../hooks/task-report'
import type { TaskTextFacts } from '../../hooks/task-report'

export function readOmpTaskReportQueue() {
  return readTaskReportQueue(
    { HOME: process.env.HOME, HERDR_META_PATROL_STATE_DIR: process.env.HERDR_META_PATROL_STATE_DIR },
    path => readFile(path, 'utf8'),
  )
}

export const ompTaskTextFacts = (session: Session, queue: string, now: number): TaskTextFacts =>
  taskTextFacts(session, queue, now)
