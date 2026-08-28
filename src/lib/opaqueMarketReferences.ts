/**
 * Opaque market references — consumer price anchors only.
 * NEVER used for target-margin selection, provider cost inference, or hard gates.
 */

export type OpaquePricingMode = "usage_based" | "per_turn" | "unknown";

export type OpaqueComparability = "opaque_same_model" | "opaque_turn_reference";

export type OpaqueMarketReference = {
  id: string;
  modelId?: string;
  providerOrProductLabel: string;
  visibleOutputChars?: number | null;
  userChargePoints: number;
  pricingMode: OpaquePricingMode;
  inputTokens: null;
  outputTokens: null;
  reasoningTokens: null;
  cacheSemantics: "unknown";
  providerContractSemantics: "unknown";
  comparability: OpaqueComparability;
  note?: string;
};

export const OPAQUE_MARKET_REFERENCES: OpaqueMarketReference[] = [
  {
    id: "opus5_crack_wrtn_a",
    modelId: "claude-opus-5",
    providerOrProductLabel: "Crack / Wrtn",
    visibleOutputChars: 2_800,
    userChargePoints: 300,
    pricingMode: "usage_based",
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheSemantics: "unknown",
    providerContractSemantics: "unknown",
    comparability: "opaque_same_model",
    note: "Claude Opus 5 — approximate visible Korean chars; token/cache/provider contract unknown",
  },
  {
    id: "premium_turn_competitor_a",
    providerOrProductLabel: "Premium turn competitor",
    visibleOutputChars: 1_800,
    userChargePoints: 250,
    pricingMode: "per_turn",
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheSemantics: "unknown",
    providerContractSemantics: "unknown",
    comparability: "opaque_turn_reference",
    note: "Per-turn pricing; model identity not confirmed for Opus hard comparison",
  },
];

let opaqueReferencesForTest: OpaqueMarketReference[] | null = null;

export function getOpaqueMarketReferences(): readonly OpaqueMarketReference[] {
  return opaqueReferencesForTest ?? OPAQUE_MARKET_REFERENCES;
}

export function _setOpaqueMarketReferencesForTest(refs: OpaqueMarketReference[] | null): void {
  opaqueReferencesForTest = refs;
}

export function computeUserPricePer1000VisibleChars(ref: OpaqueMarketReference): number | null {
  if (ref.visibleOutputChars == null || ref.visibleOutputChars <= 0) return null;
  return Math.round((ref.userChargePoints / ref.visibleOutputChars) * 1000 * 10) / 10;
}

export type OpaqueMarketPosition = "LOWER" | "SIMILAR" | "HIGHER" | "SUBSTANTIALLY_HIGHER" | "UNKNOWN";

export function evaluateOpaqueMarketPosition(params: {
  ourPricePer1000VisibleChars: number | null;
  referencePricePer1000VisibleChars: number | null;
}): OpaqueMarketPosition {
  const ours = params.ourPricePer1000VisibleChars;
  const ref = params.referencePricePer1000VisibleChars;
  if (ours == null || ref == null || ref <= 0) return "UNKNOWN";
  const ratio = ours / ref;
  if (ratio < 0.85) return "LOWER";
  if (ratio <= 1.15) return "SIMILAR";
  if (ratio <= 1.5) return "HIGHER";
  return "SUBSTANTIALLY_HIGHER";
}
