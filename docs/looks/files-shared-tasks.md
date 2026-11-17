# Files: shared task modules

Part of [the look map](../looks.md#files).

| File | Role |
| --- | --- |
| `hooks/task-tree.ts` | Shared module. Pure task-tree operations, validated task links, bounded notes and history, the durable marker for a PR merge already applied to a task, weighted progress segments and percentage, and the Status subject and milestone migration used by `upgradeSession`. |
| `hooks/task-text.ts` | Shared module. The current task text, chosen by the newer of its detail and latest note with its time. |
| `hooks/task-facts.ts` | Shared module. Applies linked PR states to task nodes, derives owner-stalled times and warnings, and maps owner state into weighted task progress segments. |
