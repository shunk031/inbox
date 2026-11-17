import type { Tab, PageTab } from '../types'
import type { ScreenTab } from './inbox-text'
import type { ListedTab } from './arrivals'

/** Any tab a look can show: a row tab or a page tab. */
export type ShownTab = Tab | PageTab

/** The band and the inbox model always read a tab's words. A look draws its symbol in their place where the words do not fit. */
type TabName = { id: ShownTab; label: string; symbol: string }

/** A tab a build draws, with the number key that shows it. */
type DrawnTab = TabName & { hotkey: string }

const TAB_NAMES: readonly TabName[] = [
  { id: 'overview', label: 'Status', symbol: '\u{1F9ED}' },
  { id: 'needsYou', label: 'Asks', symbol: '\u{1F64B}' },
  { id: 'timeline', label: 'Timeline', symbol: '◷' },
  { id: 'agents', label: 'Agents', symbol: '♟' },
  { id: 'prs', label: 'PRs', symbol: '\u{1F500}' },
]

const numbered = (tabs: readonly TabName[]): readonly DrawnTab[] =>
  tabs.map((t, n) => ({ ...t, hotkey: String(n + 1) }))

/** The tabs a look draws, in order, each keyed by its place. Status needs a next build; supported looks opt into Timeline. */
export function shownTabs(isNextBuild: boolean, includeTimeline = false, includeAgents = false): readonly DrawnTab[] {
  return numbered(
    TAB_NAMES.filter(
      tab =>
        (isNextBuild || tab.id !== 'overview') &&
        (includeTimeline || tab.id !== 'timeline') &&
        (includeAgents || tab.id !== 'agents'),
    ),
  )
}

/** The `/inbox` command's description: what the build's tabs show. */
export function inboxCommandText(isNextBuild: boolean): string {
  return isNextBuild
    ? 'Show where this session stands and what waits on you'
    : "Show this session's questions, task plan and PRs"
}

/** The tab a build draws for a saved or sent one: that tab when the build draws it, else the build's first tab. */
export function drawnTabOf(
  tab: ShownTab,
  isNextBuild: boolean,
  includeTimeline = false,
  includeAgents = false,
): ShownTab {
  const tabs = shownTabs(isNextBuild, includeTimeline, includeAgents)

  return tabs.some(t => t.id === tab) ? tab : tabs[0]!.id
}

/** How a look names its tabs: by their words, or by their symbols. */
export type TabNaming = 'words' | 'symbols'

/** The namings a look tries, in order: the words wherever they fit, and the symbols only where they do not. */
const TAB_NAMINGS: readonly TabNaming[] = ['words', 'symbols']

export function tabName(tab: { label: string; symbol: string }, naming: TabNaming): string {
  return naming === 'words' ? tab.label : tab.symbol
}

/**
 * The naming and layout a look draws its tabs in: the words at the first of the look's layouts, roomiest first, where
 * they fit on one line, else the symbols at the first layout where those fit. When neither fits, the symbols at the
 * tightest layout, which the look wraps or cuts.
 */
export function fitTabs<L>(
  layouts: readonly L[],
  fits: (naming: TabNaming, layout: L) => boolean,
): {
  naming: TabNaming
  layout: L
} {
  for (const naming of TAB_NAMINGS) for (const layout of layouts) if (fits(naming, layout)) return { naming, layout }

  return { naming: 'symbols', layout: layouts.at(-1)! }
}
/** What a tab draws after its name: its row count, Timeline tasks, or Agents attention. Null draws nothing. */
export function tabBadge(
  id: ShownTab,
  counts: Readonly<Record<Tab, number> & { timeline?: number }>,
  agentsAttentionCount = 0,
): string | null {
  if (id === 'agents') return agentsAttentionCount > 0 ? String(agentsAttentionCount) : null
  if (id === 'timeline' && counts.timeline !== undefined) return String(counts.timeline)
  return isRowTab(id) && counts[id] > 0 ? String(counts[id]) : null
}

/** Whether a shown tab lists rows you answer or close: Asks. */
export function isListedTab(tab: ShownTab): tab is ListedTab {
  return tab === 'needsYou'
}

/** Whether a shown tab is a row tab, which has rows, a count and a cursor. */
export function isRowTab(tab: ShownTab): tab is Tab {
  return tab === 'needsYou' || tab === 'prs'
}

/** Whether a saved or sent value names a tab that some build draws. */
export function isShownTab(raw: unknown): raw is ShownTab {
  return TAB_NAMES.some(t => t.id === raw)
}

/** The tab a look shows, as the inbox model is told. */
export function screenTabOf(tab: ShownTab): ScreenTab {
  return { label: TAB_NAMES.find(t => t.id === tab)?.label ?? tab, isPage: !isRowTab(tab) }
}

/** The tabs that list rows: Asks and PRs. */
export const ROW_TABS = TAB_NAMES.filter((t): t is TabName & { id: Tab } => isRowTab(t.id))

export const LISTED_TABS = TAB_NAMES.filter((t): t is TabName & { id: ListedTab } => isListedTab(t.id))
