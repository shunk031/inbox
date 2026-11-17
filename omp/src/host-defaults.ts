import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NEXT_BUILD_MARK } from '../../hooks/banners'
import type { FeedPathSetting } from '../../hooks/feed-path'
import { COMPARE_PAGE_FILE } from '../../hooks/press-messages'
import { SETTLED_MS } from '../../hooks/timing'
import { copyToClipboard } from './host-clipboard'

type DefaultDeps<TComplete, TUsage, TTarget> = {
  complete: TComplete
  isUsageLimit: TUsage
  herdrTarget: TTarget
  feedPath?: FeedPathSetting
}

/** Defaults that do not depend on omp's package types, so host.ts stays its only omp-specific adapter. */
export function defaultHostDeps<TComplete, TUsage, TTarget>(options: DefaultDeps<TComplete, TUsage, TTarget>) {
  return {
    stateDir: (pi: { pi: { getAgentDir(): string } }) => join(pi.pi.getAgentDir(), 'inbox'),
    configHome: process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    now: Date.now,
    newId: randomUUID,
    settleWindowMs: SETTLED_MS,
    home: homedir(),
    isNextBuild: existsSync(join(dirname(dirname(fileURLToPath(import.meta.url))), NEXT_BUILD_MARK)),
    comparePage: join(dirname(fileURLToPath(import.meta.url)), COMPARE_PAGE_FILE),
    complete: options.complete,
    copy: copyToClipboard,
    background: (work: Promise<unknown>) => void work.catch(() => undefined),
    after: (ms: number, fn: () => Promise<unknown>) => void setTimeout(fn, ms).unref(),
    isUsageLimit: options.isUsageLimit,
    herdrTarget: options.herdrTarget,
    herdrPane: process.env.HERDR_PANE_ID || null,
    recordedItemsOnly: process.env.INBOX_RECORDED_ITEMS_ONLY,
    taskProjectionPath: process.env.INBOX_TASK_PROJECTION_PATH,
    feedPath: options.feedPath ?? process.env.INBOX_FEED,
  }
}
