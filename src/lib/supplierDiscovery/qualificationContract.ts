import type { IndependentSupplierLiveQualification } from "./types";

export const CANONICAL_RP_QUALIFICATION_FIXTURE_OWNER =
  "scripts/lib/rpModelQualificationFixture.ts#loadCanonicalRpQualificationFixture";

export const INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS = [
  "exact_model_identity",
  "exact_production_final_prompt",
  "streaming",
  "ttft",
  "throughput",
  "e2e_time",
  "usage",
  "billed_cost",
  "http_429",
  "http_5xx",
  "timeout",
  "malformed_response",
  "cache_read_write",
  "reasoning_controls",
  "long_context",
  "regeneration",
  "continuation",
  "adult_mode_behavior",
  "zdr_retention_contract",
] as const;

/**
 * Discovery does not execute this contract. A future credentialled runner must
 * reuse the canonical production RP fixture and must not score RP prose quality.
 */
export function independentSupplierLiveQualification(input: {
  blockedReason: string;
}): IndependentSupplierLiveQualification {
  return {
    status: "NOT_RUN",
    reason: input.blockedReason,
    providerGenerationCalls: 0,
    canonicalFixtureOwner: CANONICAL_RP_QUALIFICATION_FIXTURE_OWNER,
    outputQualityScored: false,
    checks: INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS.map((id) => ({
      id,
      status: "NOT_RUN" as const,
    })),
  };
}
