import type { PaneBase, PaneHandlers, PaneSvg } from './pane-context'
import type { TaskPrCiState, TaskPrState, TaskTree } from '../types'
import { wrapText } from './line-wrap'

export type TimelinePaneBase = Pick<
  PaneBase,
  'Box' | 'Button' | 'Text' | 'pal' | 'look' | 'view' | 'timelineSelection' | 'timelineFolded' | 'timelineDetailOpen'
> & {
  bodyColumns: number
  timelineTaskTree: TaskTree
  taskReportQueue: string
  taskPrStates: Record<string, TaskPrState>
  taskPrCiStates: Record<string, TaskPrCiState>
  now: number
  Svg?: PaneSvg
}
export type TimelinePaneHandlers = Pick<
  PaneHandlers,
  'runPress' | 'selectTimelineRow' | 'updateTimelineFolded' | 'openTimelineDetail' | 'closeTimelineDetail'
>
export const timelineRowLead = (row: { prefix: string; mark: string }, selected: boolean) =>
  `${selected ? '> ' : '  '}${row.prefix}${row.mark} `
export const wrapTimelineText = (text: string, width: number, measure: (text: string) => number) =>
  wrapText(text, width, measure, { keepCjkSpaces: true })
    .map(line => line.text)
    .join('\n')
