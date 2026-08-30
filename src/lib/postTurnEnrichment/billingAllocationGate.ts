import type { BillingAllocationGateResult } from "./types";

/**
 * P0 gate — shared physical provider initial call requires exact split between
 * user-billed status widget aux and platform-funded suggested replies.
 *
 * Current main has NO canonical SHARED_ENRICHMENT_COST_ALLOCATION owner.
 * Widget billing uses full merged TokenUsage → openRouterRawCostKrw → user points
 * (applyStatusWidgetBillingCharge / buildStatusWidgetExtractReceipt).
 * Suggested replies usage is discarded (platform-funded, not in receipt).
 */
export function evaluateSharedEnrichmentBillingAllocationGate(): BillingAllocationGateResult {
  return {
    status: "BLOCKED",
    reason:
      "Status widget aux is user-billed from full provider call usage (upstreamCostUsd / token-derived KRW). " +
      "Suggested replies are platform-funded with no persisted provider usage. " +
      "A single shared initial call returns one indivisible actual settled cost and larger output token usage. " +
      "Attributing only the widget portion would require arbitrary token/cost split (forbidden). " +
      "Billing the full shared call to the user would silently fund suggestions from user points (forbidden). " +
      "No existing canonical shared-call allocation policy exists in billing architecture.",
    options: [
      "KEEP separate initial calls (current) — no user billing change; duplicate context read remains.",
      "FOLLOW-UP billing policy PR — define SHARED_ENRICHMENT_COST_ALLOCATION owner with explicit user/platform split rules, then coalesce.",
      "FOLLOW-UP async widget path — major lifecycle change; not in this PR.",
      "Do NOT coalesce with estimated 50/50 or token-ratio actual cost attribution.",
    ],
  };
}

export function canImplementSharedInitialCoalescing(): boolean {
  return evaluateSharedEnrichmentBillingAllocationGate().status === "PASS";
}
