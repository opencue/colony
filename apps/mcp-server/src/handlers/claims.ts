import type { MemoryStore } from '@colony/core';

export type AgentRole = 'scout' | 'executor' | 'queen';
export type ProposalStatus = 'proposed' | 'approved' | 'archived';

export const SCOUT_NO_CLAIM = 'SCOUT_NO_CLAIM';

export class ClaimsHandlerError extends Error {
  readonly code: typeof SCOUT_NO_CLAIM;

  constructor(code: typeof SCOUT_NO_CLAIM, message: string) {
    super(message);
    this.name = 'ClaimsHandlerError';
    this.code = code;
  }
}

export interface ClaimActorContext {
  agent?: string | null;
  session_id?: string | null;
}

export interface ProposalReadyRow {
  proposal_status?: ProposalStatus | null;
}

export function actorRole(store: MemoryStore, ctx: ClaimActorContext): AgentRole {
  const agent = ctx.agent?.trim() || ctx.session_id?.trim();
  if (!agent) return 'executor';
  return store.storage.getAgentProfile(agent)?.role ?? 'executor';
}

export function enforceScoutNoClaim(store: MemoryStore, ctx: ClaimActorContext): void {
  // Open mode (default): roles are advisory hints, not capability walls.
  if (store.settings.coordinationMode === 'open') return;
  if (actorRole(store, ctx) !== 'scout') return;
  throw new ClaimsHandlerError(SCOUT_NO_CLAIM, 'scouts cannot claim files; propose instead');
}

export function filterReadyForExecutor<T extends ProposalReadyRow>(
  rows: readonly T[],
  role: AgentRole,
  mode: 'open' | 'guarded',
): T[] {
  // Open mode: every agent sees every proposal, approved or not.
  if (mode === 'open') return [...rows];
  if (role === 'scout') return [];
  if (role === 'executor') {
    return rows.filter((row) => row.proposal_status == null || row.proposal_status === 'approved');
  }
  return [...rows];
}
