# Differences on purpose: Stop question guard in omp

Part of [the look map](../looks.md#omp).

| Topic                                       | omp            | Why                                                                                                                                                                                                                                                                 | Where                                                                                     |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Stop question guard (`stop-question-guard`) | Unrecorded decisions stay in the next-prompt note. | omp runs [`agent_end` after the reply][omp-turn]; the [oh-my-pi extension handler type][omp-types] returns no result. | `omp/src/host.ts`, `omp/src/host-turns.ts`, `hooks/client-support-omp.ts` |

[omp-turn]: ../../omp/src/host-turns.ts#L37-L39
[omp-types]: https://github.com/can1357/oh-my-pi/blob/v18.18.5/packages/coding-agent/src/extensibility/extensions/types.ts#L1819-L1908
