export function guidanceText(host: Host): string {
  return `# Inbox
${host.intro}

Write the text of questions and tasks in the language the person writes to you in.

When a choice can be inferred from the work or is easy to undo, make it and say what you chose. When you ask the user to decide something, say which option you recommend and why, in one clause ("I'd go with B: it keeps the old API"). If you cannot recommend one, say what would decide it.

Before you hand the user a step, take it yourself when your tools reach it, such as running a command, reloading or checking a page, or reading a log. When the step changes something other people see, such as merging, releasing or messaging someone, ask for their OK as a question and take the step when they say yes. Record a task only for a step your tools cannot reach, and say in your reply why you cannot take it.

When asking the user to act, give them the link, path or command, what to do, and how to return the result in your reply. If you cannot read it, such as in their browser, say how to send it.

Ask in your reply as a direct question, and record the same ask in that turn with ${host.recordTool}, so it stays in the inbox after the conversation moves on. Record a decision, an approval or information you need as a question, with its options and the one you recommend. Record an act you hold until the user says so the same way. Record a step only the user can take as a task, with its steps. Do not record rhetorical questions, offers to continue when continuing is the default, FYIs, or invitations to look at finished work.

These are not findings. Handle them in the task and your reply instead:
- A problem in your own change or inside the task: fix it.
- A check you could run yourself: run it, or say in your reply that you have not.
- Progress, status, or an approach you tried and dropped: say it.
- Something only the user can do or decide, such as an approval, a sign-in or a choice: ask it, and record it as a question or task.

Use ${host.taskTool} for your plan as you plan, start, finish or drop work. Use ${host.recordTool} for questions and user-owned steps.

The latest "inbox:" text beside the user's prompt is the current state. It lists every open item and finding with its id, such as (close id: i35), and anything it does not list is closed. Check it before telling the user that something is open or waits on them. The user never sees the ids, so never write one to the user, not even in parentheses: name an item or finding by what it says, as "the deploy task" or "the migration finding".

Close with ${host.closeTool}:
- When the user's message answers an open item, close it first, before other work, with their answer, and say in your reply what you took their answer to be.
- When an item is done or no longer applies, close it with a short reason, without waiting to be asked. Close a finding only when a change fixed it, not when the user puts it off.
The answer to a question is the user's to give. Close a question with their answer, or once it no longer applies, and never with an answer of your own.`
}

/** Claude Code sends only this many characters of a tool's description when the tool is not behind tool search. */
export const MAX_TOOL_DESCRIPTION = 4096

/** `record`'s own description leaves too little room under `MAX_TOOL_DESCRIPTION` for the guidance, so `close` carries it. */
export function guidedCloseDescription(host: Host, description: string): string {
  return `${description}\n\n${guidanceText(host)}`
}

export type Host = {
  agent: string
  surface: string
  /** Where the person always sees how many items are open, besides the surface; null when only the surface shows them. */
  band: string | null
  /** Where the person sees their PRs. */
  prsIn: string
  /** The names the agent calls the inbox tools by. */
  recordTool: string
  closeTool: string
  taskTool: string
  /** The first paragraph of `guidanceText`: what the inbox shows the person, and where. */
  intro: string
  /**
   * Whether the Status call is told to give each part of the plan the person would name its own subject, and that a
   * session's own subagents keep a subject working. See "Differences on purpose" in docs/looks.md.
   */
  splitsPlanIntoSubjects: boolean
}

export const CLAUDE_CODE: Host = {
  agent: 'Claude',
  surface: 'the /inbox pane',
  band: 'a band above their prompt',
  prsIn: 'the PRs tab of the /inbox pane',
  recordTool: 'mcp__inbox__record',
  closeTool: 'mcp__inbox__close',
  taskTool: 'mcp__inbox__tasks',
  splitsPlanIntoSubjects: false,
  intro:
    'The inbox plugin shows the user what waits on them: your open questions, the tasks only they can do, and legacy findings in Asks, in the /inbox pane. A band above their prompt shows only counts: one for your questions and their tasks together, and one for their PRs that wait on them.',
}
