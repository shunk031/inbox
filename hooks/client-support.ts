import type { ClientId, ClientSupport } from './clients'
import { CLAUDE_CODE_SUPPORT } from './client-support-claude'
import { CODEX_SUPPORT } from './client-support-codex'
import { OMP_SUPPORT } from './client-support-omp'

export const CLIENTS: Record<ClientId, ClientSupport> = {
  'claude-code': { support: CLAUDE_CODE_SUPPORT },
  codex: { support: CODEX_SUPPORT },
  omp: { support: OMP_SUPPORT },
}
