import type { Timer } from 'claude-code'
import { HERDR_CHECK_MS, localAgentsInHerdr, type LocalAgent } from './herdr'
import type { Run } from './gh'

type AgentsWatch = {
  agentsCheckTimer: Timer | null
  agentsCheckPending: boolean
  localAgents: LocalAgent[]
  agentsUnavailable: boolean
  agentsPageShown: boolean
}

export function stopAgentsCheck(state: AgentsWatch) {
  state.agentsCheckTimer?.cancel()
  state.agentsCheckTimer = null
}

async function refreshLocalAgents(state: AgentsWatch, run: Run, redraw: () => void) {
  if (state.agentsCheckPending) return
  state.agentsCheckPending = true
  try {
    const agents = await localAgentsInHerdr(run)
    const latest = agents ?? []
    const unavailable = agents === null
    if (JSON.stringify(latest) !== JSON.stringify(state.localAgents) || unavailable !== state.agentsUnavailable) {
      state.localAgents = latest
      state.agentsUnavailable = unavailable
      redraw()
    }
  } catch {
    if (!state.agentsUnavailable || state.localAgents.length > 0) {
      state.localAgents = []
      state.agentsUnavailable = true
      redraw()
    }
  } finally {
    state.agentsCheckPending = false
  }
}

export function watchLocalAgents(
  state: AgentsWatch,
  every: (ms: number, fn: () => void) => Timer,
  run: Run,
  redraw: () => void,
) {
  if (state.agentsCheckTimer) return
  void refreshLocalAgents(state, run, redraw)
  state.agentsCheckTimer = every(HERDR_CHECK_MS, () => {
    if (state.agentsPageShown) void refreshLocalAgents(state, run, redraw)
    else stopAgentsCheck(state)
  })
}
