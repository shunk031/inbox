import type { Finding, Ledger } from '../types'
import { closeFinding } from './ledger-close'

export type FeedEntry = {
  key: string
  state: 'working' | 'blocked' | 'done'
  title: string
  detail: string
  at: number
}
export type Feed = { version: 1; source: string; writtenAt: number; entries: FeedEntry[] }
export type FeedFile = { path: string; feed: Feed | null | undefined }

export const FEED_TTL_MS = 6 * 60 * 60 * 1000
export const FEED_POLL_MS = 30_000
export const MAX_FEED_FILE_BYTES = 256 * 1024

export function parseFeed(text: string): Feed | null {
  try {
    const feed: unknown = JSON.parse(text)
    if (!feed || typeof feed !== 'object') return null
    const f = feed as Record<string, unknown>
    if (f.version !== 1 || !validSource(f.source) || !validTime(f.writtenAt) || !Array.isArray(f.entries)) return null
    if (f.entries.length > 40) return null
    const keys = new Set<string>()
    const entries: FeedEntry[] = []
    for (const value of f.entries) {
      if (!value || typeof value !== 'object') return null
      const e = value as Record<string, unknown>
      if (
        typeof e.key !== 'string' ||
        e.key.length === 0 ||
        e.key.length > 100 ||
        keys.has(e.key) ||
        !['working', 'blocked', 'done'].includes(e.state as string) ||
        typeof e.title !== 'string' ||
        e.title.length === 0 ||
        typeof e.detail !== 'string' ||
        !validTime(e.at)
      )
        return null
      keys.add(e.key)
      entries.push({ ...e, title: e.title.slice(0, 120), detail: e.detail.slice(0, 600) } as FeedEntry)
    }

    return { version: 1, source: f.source, writtenAt: f.writtenAt, entries }
  } catch {
    return null
  }
}

const validTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const validSource = (s: unknown): s is string => typeof s === 'string' && s.length > 0

export function applyFeed(ledger: Ledger, feed: Feed, now: number, source = ''): Ledger {
  const keys = new Set(feed.entries.map(e => e.key))
  const owns = (f: Finding) => f.feedKey !== undefined && f.feedSource === source
  const staleClosed = ledger.closedFindings.some(f => owns(f) && !keys.has(f.feedKey!))
  let next = staleClosed
    ? {
        ...ledger,
        closedFindings: ledger.closedFindings.map(f =>
          owns(f) && !keys.has(f.feedKey!) ? { ...f, feedKey: undefined, feedSource: undefined } : f,
        ),
      }
    : ledger

  for (const entry of feed.entries) {
    let finding = next.findings.find(f => owns(f) && f.feedKey === entry.key)
    const isClosed = next.closedFindings.some(f => owns(f) && f.feedKey === entry.key)
    if (!finding && (entry.state === 'done' || isClosed || now - entry.at >= FEED_TTL_MS)) continue
    const updated: Finding = {
      ...finding,
      id: finding?.id ?? `f${next.nextId}`,
      kind: 'progress',
      title: entry.title,
      detail: detailOf(entry),
      path: null,
      at: entry.at,
      feedKey: entry.key,
      feedSource: source,
    }
    if (!finding) next = { ...next, findings: [...next.findings, updated], nextId: next.nextId + 1 }
    else if (
      finding.kind !== updated.kind ||
      finding.title !== updated.title ||
      finding.detail !== updated.detail ||
      finding.path !== updated.path ||
      finding.at !== updated.at ||
      finding.feedKey !== updated.feedKey ||
      finding.feedSource !== updated.feedSource
    )
      next = { ...next, findings: next.findings.map(f => (f.id === finding!.id ? updated : f)) }
    if (entry.state === 'done')
      next = closeFinding(next, updated.id, { how: 'update', outcome: `done: ${entry.detail}` }, now)
  }

  for (const finding of next.findings)
    if (owns(finding) && !keys.has(finding.feedKey!))
      next = closeFinding(next, finding.id, { how: 'update', outcome: 'done: no longer reported' }, now)

  return next
}

export function applyFeedFiles(ledger: Ledger, root: string, files: FeedFile[], now: number): Ledger {
  const present = new Set(files.map(f => f.path))
  const sources = new Set([...ledger.findings, ...ledger.closedFindings].map(f => f.feedSource).filter(Boolean))
  let next = ledger
  for (const source of sources)
    if (sourceUnder(source!, root) && !present.has(source!)) next = applyFeed(next, emptyFeed, now, source)
  for (const file of files) if (file.feed) next = applyFeed(next, file.feed, now, file.path)
  for (const finding of next.findings)
    if (finding.feedKey && finding.feedSource && now - finding.at >= FEED_TTL_MS)
      next = closeFinding(next, finding.id, { how: 'update', outcome: 'done: feed entry expired' }, now)
  return next
}

const emptyFeed: Feed = { version: 1, source: '', writtenAt: 0, entries: [] }
const sourceUnder = (source: string, root: string) => {
  const base = root.replace(/[\\/]+$/, '')
  return source === base || source.startsWith(`${base}/`) || source.startsWith(`${base}\\`)
}

const detailOf = (entry: FeedEntry) => (entry.state === 'blocked' ? `Blocked: ${entry.detail}` : entry.detail)
