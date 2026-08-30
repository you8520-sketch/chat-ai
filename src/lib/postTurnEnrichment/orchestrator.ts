/**
 * Post-Turn Enrichment orchestration — DESIGN STUB ONLY.
 * NOT wired to route.ts while BILLING_ALLOCATION_GATE=BLOCKED.
 *
 * When gate passes in a follow-up PR, this owner will:
 * 1. decide enrichments for the turn
 * 2. coalesce safe shared initial calls
 * 3. dispatch results to existing domain parsers (no parallel parser copies)
 */
import { evaluateSharedEnrichmentBillingAllocationGate } from "./billingAllocationGate";
import {
  planCurrentMainPostTurnInitialCalls,
  resolvePostTurnEnrichmentEligibility,
} from "./eligibility";
import type { PostTurnEnrichmentTurnConfig } from "./types";

export const POST_TURN_ENRICHMENT_OWNER = "postTurnEnrichment/orchestrator.ts";

export type PostTurnEnrichmentPlan = {
  gate: ReturnType<typeof evaluateSharedEnrichmentBillingAllocationGate>;
  eligibility: ReturnType<typeof resolvePostTurnEnrichmentEligibility>;
  /** Current-main baseline (no coalescing). */
  baselineInitialCalls: ReturnType<typeof planCurrentMainPostTurnInitialCalls>;
  sharedInitialImplemented: false;
};

export function buildPostTurnEnrichmentPlan(
  config: PostTurnEnrichmentTurnConfig
): PostTurnEnrichmentPlan {
  const gate = evaluateSharedEnrichmentBillingAllocationGate();
  return {
    gate,
    eligibility: resolvePostTurnEnrichmentEligibility(config),
    baselineInitialCalls: planCurrentMainPostTurnInitialCalls(config),
    sharedInitialImplemented: false,
  };
}
