# Owners: the Status page

Part of [the look map](../looks.md#who-owns-each-rule).

| Rule | Owner | Read by |
| --- | --- | --- |
| Explicit task-status mismatches from replies; Status applies only valid lines for existing tasks, while successful task updates clear matching claims. The tree's saved status never changes from a reply. | `hooks/status.ts`, `hooks/task-mismatches.ts`, `hooks/session-status.ts`, `hooks/session-presses.ts`. | Every host's Status and task tools. |
| The Status page shows each open mismatch on its task's work row. | `hooks/status-page.ts:statusPage`. | All four looks. |
| Status reads the task tree as facts. It can update the head, goal and links from open asks or live Children to existing task ids. It never creates, closes, renames or relinks a task. Legacy subject and milestone reply lines are ignored. | `hooks/status-prompt.ts`, `hooks/status.ts`, `hooks/status-ops.ts`. | Claude Code, Codex and omp Status calls. |
| The Status work rows are top-level tasks, grouped into one row per stream when they share a stream id. Each row shows the weighted completed-work percentage derived from task facts. | `hooks/status-page.ts:statusPage`, `hooks/task-tree.ts:weightedTaskProgress`. | The shared Status view model, before each look draws it. |
| Current task text is the newer of its detail and latest note, with the time it became current. | `hooks/task-text.ts:currentTaskText`; detail changes record a history time in `hooks/task-tree.ts:updateTask`. | Status, Timeline, prompt summaries and each look. |
| The Status page model also exposes weighted progress segments for done, working, stalled, waiting and queued work. Dropped tasks are excluded; owner facts classify a working task as stalled without changing its status. | `hooks/status-page.ts:statusPage`, `hooks/task-tree.ts:weightedTaskProgressSegments`, `hooks/task-facts.ts:applyTaskOwnerFacts`. | The shared Status view model, for T4 to draw in each applicable look. |
| Task freshness follows task facts. The view compares each task's `updatedAt` with the last Status look and any rows missed during that look. | `hooks/status-page.ts:statusPage`. | All four looks. |
| The page keeps the head, goal, Now line and live Children. A goal is met when every task linked by `goalId` is done or dropped. Goal controls, Undo and refusal state remain; legacy saved subject and milestone fields remain until their migration is removed. | `hooks/status-goal-page.ts:goalPage`, `hooks/status-goal-gate.ts:isGoalMet`, `hooks/status-goal-ops.ts:settleGoal`, `hooks/status-keys.ts:goalKeyPlan`. | All four looks. |
| An open ask links to task ids. The Status row shows the ask-held mark, and Asks names the linked open tasks. | `hooks/status-ops.ts:applyOps`, `hooks/status-page.ts:statusPage`, `hooks/view.ts:inboxView`. | All four looks. |
| The shared page model chooses rows, their order, marks, folds and action plans. A look draws those rows and actions in the shared order. | `hooks/status-page.ts`, `hooks/status-page-parts.ts`, `hooks/action-plan.ts`. | Terminal, Claude desktop pane, Codex tab and omp panel. |
