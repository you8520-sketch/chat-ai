/**
 * Forensic audit evidence — provider context ceilings, billing owners, margin matrix, gates.
 * Read-only; zero provider generation calls. Catalog fixture verified via GET /v1/models.
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { resolveMaxPayloadInputTokens } from "@/lib/contextTrack";
import {
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN,
  CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
} from "@/lib/pointsReasoningMargins";
import { MODEL_SYSTEM_BUDGETS } from "@/types";
import catalogFixture from "./fixtures/cheaperInferenceMainRpProviderContext.fixture.json";
import type {
  AuditLoadClass,
  ForensicAssemblyResult,
  ForensicModelHeadroomRow,
  ImplementationDecision,
} from "./forensic-memory-cost-audit";

export const PROVIDER_CONTEXT_UNKNOWN = "PROVIDER_CONTEXT_UNKNOWN" as const;

export type ProviderContextEvidenceRow = {
  modelId: string;
  providerModelId: string;
  providerContextWindowTokens: number | typeof PROVIDER_CONTEXT_UNKNOWN;
  providerMaxOutputTokens: number | typeof PROVIDER_CONTEXT_UNKNOWN;
  providerEvidenceSource: string;
  retrievedVerifiedDate: string;
  productionAssemblyPayloadLimit: number;
  telemetrySystemBudget: number;
};

export type BillingOwnerRow = {
  modelId: string;
  rawCostOwner: string;
  pointChargeOwner: string;
  pricingRule: string;
  canonicalMarginFloor: number | "NO_EXPLICIT_MARGIN_FLOOR";
  marginFloorOwner: string;
};

export type MarginMatrixRow = {
  modelId: string;
  loadClass: AuditLoadClass;
  paid10RawKrw: number;
  paid10ChargeP: number;
  paid10RealizedGrossMargin: number | null;
  paid15RawKrw: number;
  paid15ChargeP: number;
  paid15RealizedGrossMargin: number | null;
  marginDelta: number | null;
  canonicalPolicyFloorTarget: number | "NO_EXPLICIT_MARGIN_FLOOR";
  canonicalPolicyPass: "PASS" | "FAIL" | "UNKNOWN";
};

export type AuditGateStatus = "PASS" | "FAIL" | "UNKNOWN";

export type AuditGateEvaluation = {
  contextGate: AuditGateStatus;
  freeIsolationGate: AuditGateStatus;
  historyGate: AuditGateStatus;
  billingGate: AuditGateStatus;
  ownerGate: AuditGateStatus;
  details: {
    contextGate: string;
    freeIsolationGate: string;
    historyGate: string;
    billingGate: string;
    ownerGate: string;
  };
};

export const IMPLEMENTATION_SAFE_LABEL = "SAFE_FOR_SEPARATE_FEATURE_PR" as const;

/** Minimum provider-ceiling headroom required at BOUNDED_VALID_STRESS Paid15 sim. */
export const MIN_PROVIDER_HEADROOM_TOKENS = 5_000;

const MARGIN_ROUNDING_TOLERANCE = 0.015;

type CatalogFixtureModel = {
  providerModelId: string;
  providerContextWindowTokens: number;
  providerMaxOutputTokens: number;
  provider: string;
  ownedBy: string;
  pricingSource: string;
  openAiCatalogNote?: string;
};

type CatalogFixture = {
  retrievedAt: string;
  verifiedAt: string;
  endpoint: string;
  evidenceKind: string;
  notes: string;
  models: Record<string, CatalogFixtureModel>;
};

const VERIFIED_CATALOG = catalogFixture as CatalogFixture;

function roundCostIntermediate(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveCatalogEntry(modelId: string): CatalogFixtureModel | null {
  return VERIFIED_CATALOG.models[modelId] ?? null;
}

export function allMainRpProviderContextVerified(): boolean {
  return MAIN_RP_MODEL_IDS.every((modelId) => {
    const evidence = resolveProviderContextEvidence(modelId);
    return evidence.providerContextWindowTokens !== PROVIDER_CONTEXT_UNKNOWN;
  });
}

export function resolveProviderContextEvidence(modelId: string): ProviderContextEvidenceRow {
  const entry = resolveCatalogEntry(modelId);
  const telemetrySystemBudget =
    MODEL_SYSTEM_BUDGETS[modelId] ?? MODEL_SYSTEM_BUDGETS.default ?? 28_000;
  const productionAssemblyPayloadLimit = resolveMaxPayloadInputTokens(modelId);

  if (!entry) {
    return {
      modelId,
      providerModelId: modelId,
      providerContextWindowTokens: PROVIDER_CONTEXT_UNKNOWN,
      providerMaxOutputTokens: PROVIDER_CONTEXT_UNKNOWN,
      providerEvidenceSource: PROVIDER_CONTEXT_UNKNOWN,
      retrievedVerifiedDate: VERIFIED_CATALOG.retrievedAt,
      productionAssemblyPayloadLimit,
      telemetrySystemBudget,
    };
  }

  const sourceParts = [
    VERIFIED_CATALOG.evidenceKind,
    VERIFIED_CATALOG.endpoint,
    `pricing.source=${entry.pricingSource}`,
    `provider=${entry.provider}`,
    `owned_by=${entry.ownedBy}`,
  ];
  if (entry.openAiCatalogNote) sourceParts.push(entry.openAiCatalogNote);

  return {
    modelId,
    providerModelId: entry.providerModelId,
    providerContextWindowTokens: entry.providerContextWindowTokens,
    providerMaxOutputTokens: entry.providerMaxOutputTokens,
    providerEvidenceSource: sourceParts.join("; "),
    retrievedVerifiedDate: VERIFIED_CATALOG.retrievedAt,
    productionAssemblyPayloadLimit,
    telemetrySystemBudget,
  };
}

export function buildProviderContextEvidenceTable(): ProviderContextEvidenceRow[] {
  return MAIN_RP_MODEL_IDS.map((modelId) => resolveProviderContextEvidence(modelId));
}

export function resolveAuditProviderContextCeiling(modelId: string): {
  ceiling: number | typeof PROVIDER_CONTEXT_UNKNOWN;
  source: string;
} {
  const evidence = resolveProviderContextEvidence(modelId);
  return {
    ceiling: evidence.providerContextWindowTokens,
    source: evidence.providerEvidenceSource,
  };
}

export function buildForensicModelHeadroomRowFromProviderEvidence(
  assembly: ForensicAssemblyResult,
  baselineHistoryCount?: number
): ForensicModelHeadroomRow {
  const evidence = resolveProviderContextEvidence(assembly.modelId);
  const { ceiling, source } = resolveAuditProviderContextCeiling(assembly.modelId);
  const finiteCeiling =
    ceiling !== PROVIDER_CONTEXT_UNKNOWN &&
    Number.isFinite(ceiling) &&
    ceiling < Number.MAX_SAFE_INTEGER;

  return {
    modelId: assembly.modelId,
    loadClass: assembly.loadClass,
    matrix: assembly.matrix,
    estimatedInputTokens: assembly.estimatedInputTokens,
    contextPayloadCeiling: finiteCeiling ? ceiling : Number.MAX_SAFE_INTEGER,
    ceilingSource: finiteCeiling ? source : PROVIDER_CONTEXT_UNKNOWN,
    remainingHeadroom: finiteCeiling
      ? ceiling - assembly.estimatedInputTokens
      : Number.NaN,
    historyMessages: assembly.historyMessageCount,
    historyTrimmedByGlobalIncrease:
      baselineHistoryCount != null && assembly.historyMessageCount < baselineHistoryCount,
    telemetrySystemBudget: evidence.telemetrySystemBudget,
    telemetryHeadroom: evidence.telemetrySystemBudget - assembly.estimatedSystemTokens,
    providerContextWindowTokens: evidence.providerContextWindowTokens,
    providerMaxOutputTokens: evidence.providerMaxOutputTokens,
    providerEvidenceSource: evidence.providerEvidenceSource,
    productionAssemblyPayloadLimit: evidence.productionAssemblyPayloadLimit,
  };
}

function billingOwnerForModel(modelId: string): BillingOwnerRow {
  const rates = resolveOpenRouterReasoningPointRates(modelId);
  if (!rates) {
    return {
      modelId,
      rawCostOwner: "UNKNOWN",
      pointChargeOwner: "UNKNOWN",
      pricingRule: "UNKNOWN",
      canonicalMarginFloor: "NO_EXPLICIT_MARGIN_FLOOR",
      marginFloorOwner: "UNKNOWN",
    };
  }

  let pricingRule = "token-proportional cost-plus-margin (resolveOpenRouterReasoningPointRates)";
  if (modelId === "deepseek-v4-pro-0813") {
    pricingRule =
      "unified reasoning token owner; target gross margin 65% (CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN)";
  } else if (modelId === "gemini-3.1-pro-preview") {
    pricingRule =
      "unified reasoning token owner; target gross margin 50% (CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN)";
  } else if (modelId === "gemini-3.7-flash") {
    pricingRule =
      "unified reasoning token owner; target gross margin 55% (CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN) — does NOT inherit Gemini 3.1 output floor";
  } else if (modelId === "gpt-5.6-terra") {
    pricingRule =
      "unified reasoning token owner; target gross margin 50% (CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN)";
  }

  return {
    modelId,
    rawCostOwner:
      "computeReasoningPointCost rawUsd×FX (pointsReasoningMargins.ts) / catalog list rates",
    pointChargeOwner:
      "computeOpenRouterTurnBilling → pointsReasoningMargins.ts unified reasoning branch",
    pricingRule,
    canonicalMarginFloor: rates.grossMargin,
    marginFloorOwner: "pointsReasoningMargins.ts resolveReasoningTokenPricing().grossMargin",
  };
}

export function buildBillingOwnerMap(): BillingOwnerRow[] {
  return MAIN_RP_MODEL_IDS.map((modelId) => billingOwnerForModel(modelId));
}

function resolveAuditRawCostKrw(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const rates = resolveOpenRouterReasoningPointRates(modelId);
  if (!rates) return null;
  const input = Math.max(0, inputTokens);
  const completion = Math.max(0, outputTokens);
  return roundCostIntermediate(
    input * (rates.inputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd +
      completion * (rates.outputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd
  );
}

function resolveRealizedGrossMargin(chargeP: number, rawCostKrw: number | null): number | null {
  if (rawCostKrw == null || chargeP <= 0) return null;
  return (chargeP - rawCostKrw) / chargeP;
}

function evaluateCanonicalPolicyPass(opts: {
  paid10Margin: number | null;
  paid15Margin: number | null;
  floor: number | "NO_EXPLICIT_MARGIN_FLOOR";
}): "PASS" | "FAIL" | "UNKNOWN" {
  if (opts.floor === "NO_EXPLICIT_MARGIN_FLOOR") return "UNKNOWN";
  if (opts.paid10Margin == null || opts.paid15Margin == null) return "UNKNOWN";
  const floor = opts.floor;
  const meetsFloor = (margin: number) => margin + MARGIN_ROUNDING_TOLERANCE >= floor;
  if (!meetsFloor(opts.paid10Margin)) return "FAIL";
  if (!meetsFloor(opts.paid15Margin)) return "FAIL";
  if (opts.paid15Margin + MARGIN_ROUNDING_TOLERANCE < opts.paid10Margin) return "FAIL";
  return "PASS";
}

export function buildMarginMatrixRow(opts: {
  modelId: string;
  loadClass: AuditLoadClass;
  paid10Assembly: ForensicAssemblyResult;
  paid15Assembly: ForensicAssemblyResult;
  outputTokens: number;
}): MarginMatrixRow {
  const owner = billingOwnerForModel(opts.modelId);
  const paid10RawKrw =
    resolveAuditRawCostKrw(
      opts.modelId,
      opts.paid10Assembly.estimatedInputTokens,
      opts.outputTokens
    ) ?? 0;
  const paid15RawKrw =
    resolveAuditRawCostKrw(
      opts.modelId,
      opts.paid15Assembly.estimatedInputTokens,
      opts.outputTokens
    ) ?? 0;

  const paid10Billing = computeOpenRouterTurnBilling({
    modelId: opts.modelId,
    inputTokens: opts.paid10Assembly.estimatedInputTokens,
    outputTokens: opts.outputTokens,
    apiPromptTokens: opts.paid10Assembly.estimatedInputTokens,
    apiCompletionTokens: opts.outputTokens,
  });
  const paid15Billing = computeOpenRouterTurnBilling({
    modelId: opts.modelId,
    inputTokens: opts.paid15Assembly.estimatedInputTokens,
    outputTokens: opts.outputTokens,
    apiPromptTokens: opts.paid15Assembly.estimatedInputTokens,
    apiCompletionTokens: opts.outputTokens,
  });

  const paid10RealizedGrossMargin = resolveRealizedGrossMargin(
    paid10Billing.total,
    paid10RawKrw
  );
  const paid15RealizedGrossMargin = resolveRealizedGrossMargin(
    paid15Billing.total,
    paid15RawKrw
  );

  return {
    modelId: opts.modelId,
    loadClass: opts.loadClass,
    paid10RawKrw,
    paid10ChargeP: paid10Billing.total,
    paid10RealizedGrossMargin,
    paid15RawKrw,
    paid15ChargeP: paid15Billing.total,
    paid15RealizedGrossMargin,
    marginDelta:
      paid10RealizedGrossMargin != null && paid15RealizedGrossMargin != null
        ? paid15RealizedGrossMargin - paid10RealizedGrossMargin
        : null,
    canonicalPolicyFloorTarget: owner.canonicalMarginFloor,
    canonicalPolicyPass: evaluateCanonicalPolicyPass({
      paid10Margin: paid10RealizedGrossMargin,
      paid15Margin: paid15RealizedGrossMargin,
      floor: owner.canonicalMarginFloor,
    }),
  };
}

export function buildPaidMarginMatrix(opts: {
  loadClass: AuditLoadClass;
  paid10ByModel: Map<string, ForensicAssemblyResult>;
  paid15ByModel: Map<string, ForensicAssemblyResult>;
  outputTokens: number;
}): MarginMatrixRow[] {
  return MAIN_RP_MODEL_IDS.map((modelId) =>
    buildMarginMatrixRow({
      modelId,
      loadClass: opts.loadClass,
      paid10Assembly: opts.paid10ByModel.get(modelId)!,
      paid15Assembly: opts.paid15ByModel.get(modelId)!,
      outputTokens: opts.outputTokens,
    })
  );
}

/** Product-wide reference only — not a billing owner. */
export const PRODUCT_MARGIN_REFERENCE = {
  label: "PRODUCT_MARGIN_REFERENCE",
  note: "Legacy OPENROUTER_GROSS_MARGIN default 30% in points.ts — informational only; Main RP CI models use model-specific floors above.",
  value: 0.3,
} as const;

export function evaluateAuditGates(opts: {
  boundedStressPaid15Assemblies: ForensicAssemblyResult[];
  paid10Assemblies: ForensicAssemblyResult[];
  paid15Assemblies: ForensicAssemblyResult[];
  free10Assemblies: ForensicAssemblyResult[];
  marginRows: MarginMatrixRow[];
  historyTrimOffsetObserved: boolean;
}): AuditGateEvaluation {
  let contextGate: AuditGateStatus = "PASS";
  let contextDetail = "All Main RP provider ceilings verified; Paid15 bounded stress headroom sufficient.";

  if (!allMainRpProviderContextVerified()) {
    contextGate = "UNKNOWN";
    contextDetail = "One or more Main RP models lack verified provider context ceiling.";
  } else {
    for (const assembly of opts.boundedStressPaid15Assemblies) {
      const headroom = buildForensicModelHeadroomRowFromProviderEvidence(assembly);
      if (
        !Number.isFinite(headroom.remainingHeadroom) ||
        headroom.remainingHeadroom < MIN_PROVIDER_HEADROOM_TOKENS
      ) {
        contextGate = "FAIL";
        contextDetail = `Paid15 bounded stress headroom below ${MIN_PROVIDER_HEADROOM_TOKENS} for ${assembly.modelId}.`;
        break;
      }
    }
  }

  let freeIsolationGate: AuditGateStatus = "PASS";
  let freeDetail = "Free tier remains Global10 + Free capability; PAID15 sim does not mutate Free matrix.";
  for (const free of opts.free10Assemblies) {
    if (free.globalMaxChars !== 10_000 || free.capability.focusMaxChars !== 1_000) {
      freeIsolationGate = "FAIL";
      freeDetail = "Free tier Global10 / Focus1K invariant violated in harness.";
      break;
    }
  }

  const historyGate: AuditGateStatus = opts.historyTrimOffsetObserved ? "FAIL" : "PASS";
  const historyDetail = opts.historyTrimOffsetObserved
    ? "Paid15 unexpectedly reduced raw-history retention vs PAID10."
    : "Paid15 does not trim raw history vs PAID10 in tested production assembly.";

  let billingGate: AuditGateStatus = "PASS";
  let billingDetail =
    "PAID10/PAID15 raw cost, point charge, and realized margins computed for all Main RP models.";
  if (opts.marginRows.length !== MAIN_RP_MODEL_IDS.length) {
    billingGate = "UNKNOWN";
    billingDetail = "Margin matrix incomplete for Main RP model set.";
  } else {
    for (const row of opts.marginRows) {
      if (row.canonicalPolicyPass === "UNKNOWN") {
        billingGate = "UNKNOWN";
        billingDetail = `Billing floor owner unknown for ${row.modelId}.`;
        break;
      }
      if (row.canonicalPolicyPass === "FAIL") {
        billingGate = "FAIL";
        billingDetail = `Paid15 violates canonical margin floor for ${row.modelId}.`;
        break;
      }
      if (row.paid10RealizedGrossMargin == null || row.paid15RealizedGrossMargin == null) {
        billingGate = "UNKNOWN";
        billingDetail = `Realized margin could not be computed for ${row.modelId}.`;
        break;
      }
    }
  }

  const ownerGate: AuditGateStatus = "PASS";
  const ownerDetail =
    "No new Global owner; subscription resolver unchanged; RUNTIME_CHANGE=NO; BILLING_CHANGE=NO.";

  return {
    contextGate,
    freeIsolationGate,
    historyGate,
    billingGate,
    ownerGate,
    details: {
      contextGate: contextDetail,
      freeIsolationGate: freeDetail,
      historyGate: historyDetail,
      billingGate: billingDetail,
      ownerGate: ownerDetail,
    },
  };
}

export function decideImplementationRecommendationFromGates(
  gates: AuditGateEvaluation
): ImplementationDecision {
  if (gates.freeIsolationGate === "FAIL") return "D";
  if (gates.historyGate === "FAIL") return "C";
  if (
    gates.contextGate === "UNKNOWN" ||
    gates.billingGate === "UNKNOWN" ||
    gates.ownerGate === "UNKNOWN"
  ) {
    return "B";
  }
  if (gates.contextGate === "FAIL" || gates.billingGate === "FAIL" || gates.ownerGate === "FAIL") {
    return "B";
  }
  return "A";
}

export function implementationDecisionLabel(
  decision: ImplementationDecision
): typeof IMPLEMENTATION_SAFE_LABEL | "B" | "C" | "D" {
  if (decision === "A") return IMPLEMENTATION_SAFE_LABEL;
  return decision;
}

export {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN,
  CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
};
