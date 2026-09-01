/**
 * Final user-charge consistency — one canonical settled points value across
 * settlement, usage.cost, deduction_slices, Admin Receipt, and Finance revenue.
 */

import type Database from "better-sqlite3";
import type { Usage, UsageBillingContractAdmin } from "@/lib/chatUsage";
import type { ChatBillingContractDecision } from "@/lib/chatBillingContractDispatch";
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
    decision.contract === "published_phase1" ? decision.points : null;
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
    baseCost: settledPoints,
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
      `SELECT usage, deduction_slices FROM messages
       WHERE id=? AND chat_id=? AND request_id=?`
    )
    .get(input.assistantMessageId, input.chatId, input.requestId) as
    | { usage: string | null; deduction_slices: string | null }
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

  db.prepare(
    `UPDATE messages SET usage=? WHERE id=? AND chat_id=? AND request_id=?`
  ).run(
    JSON.stringify(patched),
    input.assistantMessageId,
    input.chatId,
    input.requestId
  );

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
