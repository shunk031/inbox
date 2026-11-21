import type { Timer } from 'claude-code'
import { HERDR_CHECK_MS, localAgentsFromHerdr, type LocalAgent } from './herdr'
import type { Run } from './gh'

const HERDR_AGENT_LIST = ['herdr', 'agent', 'list']

async function localAgentsInHerdr(run: Run): Promise<LocalAgent[] | null> {
  try {
    const result = await run(HERDR_AGENT_LIST, { cwd: '/', timeoutMs: 5000 })
    return result.code === 0 ? localAgentsFromHerdr(result.stdout) : null
  } catch {
    return null
  }
}

type LocalAgentsWatch = {
  localAgentsCheckTimer: Timer | null
  localAgentsCheckPending: boolean
  localAgentsCheckGeneration: number
  localAgents: LocalAgent[]
  timelineShown: boolean
}

export function stopLocalAgentsCheck(state: LocalAgentsWatch) {
  state.localAgentsCheckGeneration++
  state.localAgentsCheckTimer?.cancel()
  state.localAgentsCheckTimer = null
}

async function refreshLocalAgents(state: LocalAgentsWatch, run: Run, redraw: () => void, generation: number) {
  if (state.localAgentsCheckPending) return
  state.localAgentsCheckPending = true
  try {
    const agents = await localAgentsInHerdr(run)
    if (!state.timelineShown || generation !== state.localAgentsCheckGeneration) return
    const latest = agents ?? []
    if (JSON.stringify(latest) !== JSON.stringify(state.localAgents)) {
      state.localAgents = latest
      redraw()
    }
  } finally {
    state.localAgentsCheckPending = false
  }
}

export function watchLocalAgents(
  state: LocalAgentsWatch,
  after: (ms: number, fn: () => void) => Timer,
  every: (ms: number, fn: () => void) => Timer,
  run: Run,
  redraw: () => void,
) {
  if (state.localAgentsCheckTimer) return
  const generation = state.localAgentsCheckGeneration
  state.localAgentsCheckTimer = after(0, () => {
    if (state.timelineShown && generation === state.localAgentsCheckGeneration) {
      void refreshLocalAgents(state, run, redraw, generation)
      state.localAgentsCheckTimer = every(HERDR_CHECK_MS, () => {
        if (state.timelineShown && generation === state.localAgentsCheckGeneration)
          void refreshLocalAgents(state, run, redraw, generation)
        else stopLocalAgentsCheck(state)
      })
    } else stopLocalAgentsCheck(state)
  })
}
