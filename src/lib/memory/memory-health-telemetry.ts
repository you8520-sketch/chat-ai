import { MEMORY_POLICY_ID, newAutomaticBatchEnd } from "./memory-constants";

export type MemoryHealthTelemetry = {
  memory_policy: typeof MEMORY_POLICY_ID;
  completed_playable_turns: number;
  summarized_through: number;
  next_pending_summary_range: string | null;
  real_raw_complete_exchanges: number;
  opening_in_raw: boolean;
  bridge_in_raw: boolean;
  episodic_candidate_count: number;
  episodic_injected_count: number;
  episodic_duplicate_blocked_count: number;
  episodic_budget_blocked_count: number;
  status_extract_call_count: number;
};

export function buildMemoryHealthTelemetry(input: {
  completedPlayableTurns: number;
  summarizedThrough: number;
  realRawCompleteExchanges: number;
  openingInRaw: boolean;
  bridgeInRaw: boolean;
  episodicCandidateCount: number;
  episodicInjectedCount: number;
  episodicDuplicateBlockedCount: number;
  episodicBudgetBlockedCount: number;
  statusExtractCallCount: number;
}): MemoryHealthTelemetry {
  const nextStart = Math.max(0, input.summarizedThrough) + 1;
  const nextEnd = newAutomaticBatchEnd(nextStart);
  return {
    memory_policy: MEMORY_POLICY_ID,
    completed_playable_turns: input.completedPlayableTurns,
    summarized_through: input.summarizedThrough,
    next_pending_summary_range: nextStart >= 1 ? `${nextStart}~${nextEnd}` : null,
    real_raw_complete_exchanges: input.realRawCompleteExchanges,
    opening_in_raw: input.openingInRaw,
    bridge_in_raw: input.bridgeInRaw,
    episodic_candidate_count: input.episodicCandidateCount,
    episodic_injected_count: input.episodicInjectedCount,
    episodic_duplicate_blocked_count: input.episodicDuplicateBlockedCount,
    episodic_budget_blocked_count: input.episodicBudgetBlockedCount,
    status_extract_call_count: input.statusExtractCallCount,
  };
}

export function logMemoryHealthTelemetry(payload: MemoryHealthTelemetry): void {
  console.info("MEMORY_HEALTH", payload);
}
