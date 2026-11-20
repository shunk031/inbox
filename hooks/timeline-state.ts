export const COMPLETED_FOLD_ID = 'inbox:timeline:completed-fold'.padEnd(101, '-')

export const timelineCompletedFolded = (folded: readonly string[]): boolean => !folded.includes(COMPLETED_FOLD_ID)

export function upgradedTimelineSelection(id: unknown): string | null {
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function upgradedTimelineDetailOpen(open: unknown): boolean {
  return open === true
}

const isFoldId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id !== '\0inbox:timeline-completed-fold'

export function upgradedTimelineFolded(folded: unknown): string[] {
  return Array.isArray(folded) ? [...new Set(folded.filter(isFoldId))] : []
}
