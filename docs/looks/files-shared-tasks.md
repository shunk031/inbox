# Files: shared task modules

Part of [the look map](../looks.md#files).

| File | Role |
| --- | --- |
| `hooks/task-tree.ts` | Shared module. Pure task-tree operations, validated task links, bounded notes and history, the durable marker for a PR merge already applied to a task, weighted progress segments and percentage, and the Status subject and milestone migration used by `upgradeSession`. |
| `hooks/task-mismatches.ts` | Shared module. Applies explicit task-status conflict and retraction lines from Status, clears a mismatch when a successful task update agrees with its claim, and upgrades saved mismatch state. |
| `hooks/task-text.ts` | Shared module. The current task text, chosen by the newer of its detail and latest note with its time. |
| `hooks/task-projection.ts` | Shared task-tree projection, one-time feed import, and the operations hosts provide for locking and atomic publication. |
| `hooks/task-projection-host.ts` | Shared post-save step that reports projection failures and saves the imported tasks and migration marker through a host. |
| `hooks/task-facts.ts` | Shared module. Applies linked PR states to task nodes, derives owner-stalled times and warnings, and maps owner state into weighted task progress segments. |
