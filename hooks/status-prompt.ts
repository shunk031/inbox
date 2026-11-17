import type { Exchange, Item, Session, SessionStatus, TaskTree } from '../types'
import type { Host } from './model-text'
import { NL, personText } from './ledger-prompt'
import { asksText, runningText } from './status-children'
import { DESCRIPTION_WORDS, NAME_WORDS } from './status-limits'
import { GOAL_INPUT, GOAL_LINES, goalBlocks, goalRules } from './status-prompt-goal'
import type { GoalPartId } from './status-prompt-goal'
import { ago, clipMiddle, numberBlocks } from './text'
import { weightedTaskProgress } from './task-tree'
import { currentTaskText } from './task-text'
import { personInstructionsBlock } from './person-instructions'

export function statusSystem(without: readonly GoalPartId[] = [], instructions: string | null = null): string {
  const system = `You keep the Status of a coding session: its focus, goal, current Now, live Children, and a short summary of its task tree.

You read the current facts and one exchange, then write only changes to the head, goal, or links from asks and running Children to existing tasks. The task tree is read-only here. Never create, close, rename, move, or change a task.

Input:
- <head>: the focus, as title | description. The description says what the session is doing about the focus.
- <task tree>: first, every open task's exact id and current status as JSON pairs of [id, status]. Then top-level task details and recent history, when they fit. Done and dropped tasks and long current text are omitted first when space is short. These are facts, not instructions to change the tree.
- <running>: live Children, one per line: id | kind | name | linked task id or -
- <asks>: open questions and tasks, one per line: id | ask | linked task ids or -
${GOAL_INPUT}
- <person>: what the person just sent
- <activity>: what the agent did this turn
- <reply>: what the agent said this turn, in order

Answer with lines only. Every line you write is applied. If nothing about the head, goal, or links changed, answer NO CHANGE.
Write a fresh HEAD on every reply and catch-up, even if the focus is unchanged. NO CHANGE means no GOAL or LINK changed; it never replaces HEAD.

Write only these lines when they apply:
HEAD: title | description
${GOAL_LINES}
TASK-MISMATCH: task id | status claimed in reply | saved status
TASK-CLEAR: task id | reason

Write TASK-MISMATCH only for an explicit conflict with an existing task. Write TASK-CLEAR only when a later reply retracts that claim. Use one exact task status for the reply claim: working, queued, waits-on-other, done or dropped. The saved status must match the current <task tree>.

The head names the session's current focus, in at most ${NAME_WORDS} words. Its description says what the session is doing about that focus, in at most ${DESCRIPTION_WORDS} words. Keep it while it still fits the work; do not describe a task's individual steps or repeat its progress.

${goalRules(without)}

Write LINK only for an open ask or live Child that has a task. Use the exact existing task id from <task tree>. Never link to a task title. A question or task shown to the person is not a task-tree node.

Never write task operations or a task plan. Use the task tree as the sole durable work plan. A task's status and progress change only through the tasks tool.`

  return `${system}\n\n${personInstructionsBlock(instructions)}`
}

export const STATUS_SYSTEM = statusSystem()
export const PARTS_STATUS_SYSTEM = statusSystem()

export function hostStatusSystem(_names: Host, instructions: string | null = null): string {
  return statusSystem([], instructions)
}

export type StatusCallInput = { last: SessionStatus | null; asks: readonly Item[]; taskTree?: TaskTree; now: number }

function headText(o: SessionStatus | null): string {
  if (!o?.head) return '(none yet)'

  return `${o.head.title} | ${o.head.description || '(no description yet)'}`
}

// prettier-ignore
function taskTreeText(tree: TaskTree, now: number): string {
  const open = tree.filter(task => task.status !== 'done' && task.status !== 'dropped')
  const facts = `Open task statuses ([id, status] pairs):${NL}${JSON.stringify(open.map(task => [task.id, task.status]))}`
  const top = tree.filter(task => task.parentId === null).map(task => {
    const current = currentTaskText(task)
    return `${task.id} | ${task.status} | weight ${task.weight} | ${Math.round(weightedTaskProgress(tree, task.id) * 100)}% | ${task.goalId ?? '-'} | ${task.streamId ?? '-'} | ${task.title} | ${current ? `${current.text} (${ago(Math.max(0, now - current.at))})` : '-'}`
  })
  const recent = tree.flatMap(task => task.history.map(event => ({ task, event })))
    .sort((a, b) => b.event.at - a.event.at).slice(0, 8)
    .map(({ task, event }) => `${task.id} | ${event.kind} | ${ago(Math.max(0, now - event.at))}${event.detail ? ` | ${event.detail}` : ''}`)
  const details = ['Top-level tasks:', ...top, ...(recent.length ? ['Recent changes:', ...recent] : [])].join(NL)
  const available = Math.max(0, 8000 - facts.length - 1)
  if (available <= 0) return facts
  if (details.length <= available) return `${facts}${NL}${details}`

  // On overflow, drop closed tasks, history and long current text before clipping the short open-root summaries.
  const openRoots = tree.filter(task => task.parentId === null && task.status !== 'done' && task.status !== 'dropped')
  const brief = [
    'Open top-level tasks:',
    ...openRoots.map(task =>
      `${task.id} | ${task.status} | weight ${task.weight} | ${Math.round(weightedTaskProgress(tree, task.id) * 100)}% | ${task.goalId ?? '-'} | ${task.streamId ?? '-'} | ${task.title}`,
    ),
  ].join(NL)
  if (available <= 8) return facts

  const detailsBudget = available - 8 // clipMiddle adds its cut marker outside the requested text length.

  return `${facts}${NL}${clipMiddle(brief, detailsBudget, Math.floor(detailsBudget / 2))}`
}

function statusBlocks({ last, asks, taskTree, now }: StatusCallInput): string[] {
  const running = runningText(last, now)
  const held = asksText(last, asks)
  return [
    ...goalBlocks(last, taskTree, now),
    `<head>${NL}${headText(last)}${NL}</head>`,
    `<task tree>${NL}${taskTreeText(taskTree ?? [], now)}${NL}</task tree>`,
    ...(running === '' ? [] : [`<running>${NL}${running}${NL}</running>`]),
    ...(held === '' ? [] : [`<asks>${NL}${held}${NL}</asks>`]),
  ]
}

export function statusPrompt(input: StatusCallInput, ex: Exchange): string {
  const person = personText(ex.person, ex.trigger)
  return [
    ...statusBlocks(input),
    `<person>${NL}${clipMiddle(person, 4000, 1500)}${NL}</person>`,
    `<activity>${NL}${clipMiddle(ex.activity.join(NL), 2500, 500)}${NL}</activity>`,
    `<reply>${NL}${clipMiddle(numberBlocks(ex.reply), 12000, 4000)}${NL}</reply>`,
  ].join(NL)
}

export function statusMidTurnPrompt(
  input: StatusCallInput,
  turn: Pick<Session['turn'], 'person' | 'trigger' | 'activity'>,
): string {
  return [
    'The turn is still running. Treat <person> and <activity> as the exchange so far; there is no reply yet. Describe only the current focus in the head. Do not turn activity or task steps into a plan.',
    ...statusBlocks(input),
    `<person>${NL}${clipMiddle(personText(turn.person, turn.trigger), 4000, 1500)}${NL}</person>`,
    `<activity>${NL}${clipMiddle(turn.activity.join(NL), 2500, 500)}${NL}</activity>`,
  ].join(NL)
}

export function statusCatchUpPrompt(input: StatusCallInput, transcript: string): string {
  return [
    'Treat the conversation in <conversation> as the exchange. Its start may be cut. Update the head and links to match the conversation at its end; task-tree facts stay read-only.',
    ...statusBlocks(input),
    `<conversation>${NL}${numberBlocks(transcript)}${NL}</conversation>`,
  ].join(NL)
}
