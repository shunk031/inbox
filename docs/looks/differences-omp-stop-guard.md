# Differences on purpose: Stop question guard in omp

Part of [the look map](../looks.md#omp).

| Topic                                       | omp            | Why                                                                               | Where                         |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Stop question guard (`stop-question-guard`) | Not supported. | The guard runs in the Claude Code mod's Stop hook; omp uses a separate hook host. | `hooks/client-support-omp.ts` |
