export const COMPLETED_FOLD_ID = '\0inbox:timeline-completed-fold'

export const timelineCompletedFolded = (folded: readonly string[]): boolean => !folded.includes(COMPLETED_FOLD_ID)

export function upgradedTimelineSelection(id: unknown): string | null {
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function upgradedTimelineDetailOpen(open: unknown): boolean {
  return open === true
}

export function upgradedTimelineFolded(folded: unknown): string[] {
  return Array.isArray(folded)
    ? [...new Set(folded.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : []
}
