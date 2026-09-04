/**
 * Final user-charge consistency — one canonical settled points value across
 * settlement, usage.cost, deduction_slices, Admin Receipt, and Finance revenue.
 */

import type Database from "better-sqlite3";
import type { Usage, UsageBillingContractAdmin } from "@/lib/chatUsage";
import type { ChatBillingContractDecision } from "@/lib/chatBillingContractDispatch";
import {
  normalizeMessageVariants,
  parseMessageVariants,
  type MessageVariant,
} from "@/lib/messageAlternates";
import type { DeductionSlice } from "@/lib/points";

export const FINAL_USER_CHARGE_OWNER =
  "resolveChatBillingContract() → settleChatTurnBillingExactlyOnce() → syncAssistantMessageFinalCharge()";

export type FinalChargeConsistencySnapshot = {
  finalUserChargePoints: number;
  settledDeductionPoints: number;
  usageCostPoints: number;
  deductionSliceTotal: number;
  paidSliceTotal: number;
  freeSliceTotal: number;
  consistent: boolean;
  violations: string[];
};

export function sumDeductionSliceAmounts(slices: DeductionSlice[]): number {
  let total = 0;
  for (const slice of slices) {
    const amount = Number(slice.amount);
    if (Number.isFinite(amount) && amount > 0) {
      total += amount;
    }
  }
  return total;
}

export function sumDeductionSliceTotals(slices: DeductionSlice[]): {
  paid: number;
  free: number;
  total: number;
} {
  let paid = 0;
  let free = 0;
  for (const slice of slices) {
    const amount = Number(slice.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (slice.pointType === "FREE") free += amount;
    else paid += amount;
  }
  return { paid, free, total: paid + free };
}

export function buildUsageBillingContractAdmin(
  decision: ChatBillingContractDecision,
  settledDeductedPoints: number,
  legacyFinalPoints: number
): UsageBillingContractAdmin {
  const publishedFinalPoints =
    decision.contract === "published_phase1" || decision.contract === "published_phase2"
      ? decision.points
      : null;
  return {
    billingContract: decision.contract,
    billingContractReason: decision.telemetry.billingContractReason,
    deliveredModelId: decision.telemetry.deliveredModelId,
    publishedCandidateStatus: decision.telemetry.publishedCandidateStatus,
    publishedBlockReason: decision.telemetry.publishedBlockReason,
    pricingVersion: decision.telemetry.pricingVersion,
    publishedFinalPoints,
    legacyFinalPoints,
    settledDeductedPoints,
  };
}

export function applyFinalUserChargeToUsage(
  usage: Usage,
  settledPoints: number,
  billingContractDispatch?: UsageBillingContractAdmin | null
): Usage {
  return {
    ...usage,
    cost: settledPoints,
    ...(billingContractDispatch ? { billingContractDispatch } : {}),
  };
}

export function evaluateFinalChargeConsistency(input: {
  finalUserChargePoints: number;
  settledDeductionPoints: number;
  usageCostPoints: number;
  deductionSlices: DeductionSlice[];
}): FinalChargeConsistencySnapshot {
  const sliceTotals = sumDeductionSliceTotals(input.deductionSlices);
  const violations: string[] = [];
  if (input.finalUserChargePoints !== input.settledDeductionPoints) {
    violations.push("final_user_charge!=settled_deduction");
  }
  if (input.usageCostPoints !== input.settledDeductionPoints) {
    violations.push("usage_cost!=settled_deduction");
  }
  if (sliceTotals.total !== input.settledDeductionPoints) {
    violations.push("deduction_slice_total!=settled_deduction");
  }
  return {
    finalUserChargePoints: input.finalUserChargePoints,
    settledDeductionPoints: input.settledDeductionPoints,
    usageCostPoints: input.usageCostPoints,
    deductionSliceTotal: sliceTotals.total,
    paidSliceTotal: sliceTotals.paid,
    freeSliceTotal: sliceTotals.free,
    consistent: violations.length === 0,
    violations,
  };
}

export type FinalChargeVariantPatchMode =
  | "none"
  | "request_id"
  | "active_only_legacy";

export type FinalChargeVariantPatchResult = {
  patchedVariantIndices: number[];
  mode: FinalChargeVariantPatchMode;
  skippedCrossGeneration: boolean;
};

/** Resolve which stored alternates entries receive the same final charge as top-level usage. */
export function resolveVariantIndicesForFinalChargePatch(input: {
  variants: MessageVariant[];
  requestId: string;
  activeVariant: number;
}): FinalChargeVariantPatchResult {
  const requestId = input.requestId.trim();
  if (!requestId || input.variants.length === 0) {
    return { patchedVariantIndices: [], mode: "none", skippedCrossGeneration: false };
  }

  const byRequestId = input.variants.flatMap((variant, index) =>
    variant.requestId?.trim() === requestId ? [index] : []
  );
  if (byRequestId.length === 1) {
    return {
      patchedVariantIndices: byRequestId,
      mode: "request_id",
      skippedCrossGeneration: false,
    };
  }
  if (byRequestId.length > 1) {
    return { patchedVariantIndices: [], mode: "none", skippedCrossGeneration: true };
  }

  // Legacy rows may lack per-variant requestId. Patch only when unambiguous.
  if (
    input.variants.length === 1 &&
    input.activeVariant === 0 &&
    !input.variants[0]?.requestId?.trim()
  ) {
    return {
      patchedVariantIndices: [0],
      mode: "active_only_legacy",
      skippedCrossGeneration: false,
    };
  }

  return { patchedVariantIndices: [], mode: "none", skippedCrossGeneration: true };
}

function patchVariantsForFinalCharge(input: {
  variants: MessageVariant[];
  variantIndices: number[];
  settledPoints: number;
  billingContractDispatch?: UsageBillingContractAdmin | null;
}): MessageVariant[] {
  if (input.variantIndices.length === 0) return input.variants;
  const indexSet = new Set(input.variantIndices);
  return input.variants.map((variant, index) => {
    if (!indexSet.has(index) || !variant.usage) return variant;
    return {
      ...variant,
      usage: applyFinalUserChargeToUsage(
        variant.usage,
        input.settledPoints,
        input.billingContractDispatch
      ),
    };
  });
}

export function persistAssistantMessageFinalCharge(
  db: Database.Database,
  input: {
    assistantMessageId: number;
    chatId: number;
    requestId: string;
    settledPoints: number;
    slices: DeductionSlice[];
    billingContractDispatch?: UsageBillingContractAdmin | null;
  }
): FinalChargeConsistencySnapshot {
  const row = db
    .prepare(
      `SELECT usage, deduction_slices, alternates, active_variant, content, model
       FROM messages
       WHERE id=? AND chat_id=? AND request_id=?`
    )
    .get(input.assistantMessageId, input.chatId, input.requestId) as
    | {
        usage: string | null;
        deduction_slices: string | null;
        alternates: string | null;
        active_variant: number | null;
        content: string;
        model: string;
      }
    | undefined;

  if (!row) {
    return evaluateFinalChargeConsistency({
      finalUserChargePoints: input.settledPoints,
      settledDeductionPoints: input.settledPoints,
      usageCostPoints: -1,
      deductionSlices: input.slices,
    });
  }

  let usage: Usage;
  try {
    usage = JSON.parse(row.usage ?? "{}") as Usage;
  } catch {
    usage = { input: 0, output: 0, model: "unknown", route: "safe", cost: 0, breakdown: [] };
  }

  const patched = applyFinalUserChargeToUsage(
    usage,
    input.settledPoints,
    input.billingContractDispatch
  );

  const storedVariants = parseMessageVariants(row.alternates);
  const { variants, activeVariant } =
    storedVariants.length > 0
      ? {
          variants: storedVariants,
          activeVariant: row.active_variant ?? storedVariants.length - 1,
        }
      : normalizeMessageVariants({
          content: row.content,
          model: row.model,
          usage: row.usage,
          alternates: row.alternates,
          active_variant: row.active_variant,
        });

  const variantPatch = resolveVariantIndicesForFinalChargePatch({
    variants,
    requestId: input.requestId,
    activeVariant,
  });
  const patchedVariants = patchVariantsForFinalCharge({
    variants,
    variantIndices: variantPatch.patchedVariantIndices,
    settledPoints: input.settledPoints,
    billingContractDispatch: input.billingContractDispatch,
  });
  const alternatesJson =
    storedVariants.length > 0 ? JSON.stringify(patchedVariants) : null;

  if (alternatesJson != null) {
    db.prepare(
      `UPDATE messages SET usage=?, alternates=? WHERE id=? AND chat_id=? AND request_id=?`
    ).run(
      JSON.stringify(patched),
      alternatesJson,
      input.assistantMessageId,
      input.chatId,
      input.requestId
    );
  } else {
    db.prepare(
      `UPDATE messages SET usage=? WHERE id=? AND chat_id=? AND request_id=?`
    ).run(
      JSON.stringify(patched),
      input.assistantMessageId,
      input.chatId,
      input.requestId
    );
  }

  let persistedSlices = input.slices;
  if (row.deduction_slices && row.deduction_slices !== "[]" && row.deduction_slices !== "null") {
    try {
      persistedSlices = JSON.parse(row.deduction_slices) as DeductionSlice[];
    } catch {
      persistedSlices = input.slices;
    }
  }

  return evaluateFinalChargeConsistency({
    finalUserChargePoints: input.settledPoints,
    settledDeductionPoints: input.settledPoints,
    usageCostPoints: patched.cost,
    deductionSlices: persistedSlices,
  });
}
