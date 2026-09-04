import type Database from "better-sqlite3";
import { sumDeductionSliceAmounts } from "@/lib/chatBillingFinalCharge";
import {
  CHAT_TURN_CHARGE_KIND,
  parseDeductionSlicesJson,
  readChatBillingSettlement,
  type ChatBillingSettlementOutcome,
} from "@/lib/chatBillingSettlement";
import type { Usage } from "@/lib/chatUsage";
import { isInFlightGenerationStatus } from "@/lib/streamingPersistenceShared";
import type {
  StoredTurnChargeEvidence,
  StoredTurnChargeEvidenceStatus,
  StoredTurnChargeStatus,
} from "@/lib/storedTurnChargeEvidenceShared";

export type {
  StoredTurnChargeEvidence,
  StoredTurnChargeEvidenceStatus,
  StoredTurnChargeStatus,
  UserMessageBillingSummary,
} from "@/lib/storedTurnChargeEvidenceShared";
export {
  formatStoredTurnChargeStatusLabel,
} from "@/lib/storedTurnChargeEvidenceShared";

export type ResolveStoredTurnChargeEvidenceInput = {
  userId: number;
  chatId: number;
  assistantMessageId: number;
  requestId: string | null;
  generationStatus: string | null;
  deductionSlicesRaw: string | null;
  usage: Usage | null;
  model?: string | null;
};

type SettlementSnapshot = {
  settledPoints: number;
  outcome: ChatBillingSettlementOutcome;
  assistantMessageId: number | null;
  source: string;
};

function hasLegacyChargeSignal(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed !== "[]" && trimmed !== "null";
}

function parseSliceTotal(raw: string | null): {
  total: number | null;
  malformed: boolean;
  present: boolean;
} {
  if (!hasLegacyChargeSignal(raw)) {
    return { total: null, malformed: false, present: false };
  }
  const slices = parseDeductionSlicesJson(raw ?? "");
  if (!slices) {
    return { total: null, malformed: true, present: true };
  }
  return {
    total: sumDeductionSliceAmounts(slices),
    malformed: false,
    present: slices.length > 0,
  };
}

function readScopedSettlement(
  db: Database.Database,
  input: ResolveStoredTurnChargeEvidenceInput
): SettlementSnapshot | null {
  const requestId = input.requestId?.trim();
  if (!requestId) return null;
  const settlement = readChatBillingSettlement(
    db,
    input.userId,
    input.chatId,
    requestId,
    CHAT_TURN_CHARGE_KIND
  );
  if (!settlement) return null;
  // Canonical row identity comes from the settlement reader (read-only).
  // No second ownership of chat_billing_settlements schema here.
  return {
    settledPoints: settlement.settledPoints,
    outcome: settlement.outcome,
    assistantMessageId: settlement.assistantMessageId,
    source: settlement.source,
  };
}

function finalizeEvidence(input: {
  status: StoredTurnChargeStatus;
  settledPoints: number | null;
  evidenceStatus: StoredTurnChargeEvidenceStatus;
  violations: string[];
}): StoredTurnChargeEvidence {
  return {
    status: input.status,
    settledPoints: input.settledPoints,
    evidenceStatus: input.violations.length > 0 ? "conflict" : input.evidenceStatus,
    violations: input.violations,
  };
}

/** Canonical stored charge evidence resolver — generation-scoped by request_id. */
export function resolveStoredTurnChargeEvidence(
  db: Database.Database,
  input: ResolveStoredTurnChargeEvidenceInput
): StoredTurnChargeEvidence {
  const violations: string[] = [];
  const generationStatus = (input.generationStatus ?? "").toLowerCase();

  if (isInFlightGenerationStatus(generationStatus)) {
    return finalizeEvidence({
      status: "pending",
      settledPoints: null,
      evidenceStatus: "partial",
      violations,
    });
  }

  const settlement = readScopedSettlement(db, input);
  if (
    settlement?.assistantMessageId != null &&
    settlement.assistantMessageId !== input.assistantMessageId
  ) {
    violations.push("settlement_assistant_message_mismatch");
  }

  const slices = parseSliceTotal(input.deductionSlicesRaw);
  if (slices.malformed) {
    violations.push("deduction_slices_malformed");
  }

  const usageCost =
    input.usage?.cost != null && Number.isFinite(input.usage.cost)
      ? input.usage.cost
      : null;
  const usageWaived = input.usage?.billingWaived === true;
  const dispatchSettled =
    input.usage?.billingContractDispatch?.settledDeductedPoints != null &&
    Number.isFinite(input.usage.billingContractDispatch.settledDeductedPoints)
      ? input.usage.billingContractDispatch.settledDeductedPoints
      : null;

  if (settlement && slices.total != null && settlement.settledPoints !== slices.total) {
    violations.push("settlement!=deduction_slices");
  }
  if (settlement && usageCost != null && settlement.settledPoints !== usageCost) {
    violations.push("settlement!=usage_cost");
  }
  if (dispatchSettled != null && settlement && dispatchSettled !== settlement.settledPoints) {
    violations.push("dispatch!=settlement");
  }
  if (dispatchSettled != null && usageCost != null && dispatchSettled !== usageCost) {
    violations.push("dispatch!=usage_cost");
  }
  if (slices.total != null && usageCost != null && slices.total !== usageCost) {
    violations.push("deduction_slices!=usage_cost");
  }

  if (violations.length > 0) {
    return finalizeEvidence({
      status: "unknown",
      settledPoints: settlement?.settledPoints ?? slices.total ?? usageCost,
      evidenceStatus: "conflict",
      violations,
    });
  }

  if (settlement) {
    if (settlement.outcome === "waived") {
      return finalizeEvidence({
        status: "not_charged",
        settledPoints: 0,
        evidenceStatus: "complete",
        violations,
      });
    }
    if (settlement.outcome === "legacy_malformed") {
      return finalizeEvidence({
        status: "unknown",
        settledPoints: null,
        evidenceStatus: "insufficient",
        violations: [...violations, "legacy_malformed_unprovable"],
      });
    }
    if (settlement.settledPoints > 0) {
      return finalizeEvidence({
        status: "charged",
        settledPoints: settlement.settledPoints,
        evidenceStatus: "complete",
        violations,
      });
    }
    return finalizeEvidence({
      status: "not_charged",
      settledPoints: 0,
      evidenceStatus: "complete",
      violations,
    });
  }

  if (slices.present && slices.total != null && slices.total > 0) {
    return finalizeEvidence({
      status: "charged",
      settledPoints: slices.total,
      evidenceStatus: "partial",
      violations,
    });
  }

  if (usageWaived || usageCost === 0) {
    return finalizeEvidence({
      status: "not_charged",
      settledPoints: 0,
      evidenceStatus: usageCost != null || usageWaived ? "complete" : "partial",
      violations,
    });
  }

  if (usageCost != null && usageCost > 0) {
    return finalizeEvidence({
      status: "charged",
      settledPoints: usageCost,
      evidenceStatus: dispatchSettled != null ? "complete" : "partial",
      violations,
    });
  }

  // Interrupted 0P invariant: settleChatTurnBillingExactlyOnce() runs
  // deductPointsOnDb + deduction-slices persist + settlement finalize inside one
  // BEGIN IMMEDIATE transaction (chatBillingSettlement.ts). Settlement lookup above
  // is scoped by request_id, so reaching here means no scoped settlement and no
  // scoped deduction evidence exist for this generation. That is a canonical
  // no-charge proof — but only for this path. Malformed/legacy/ambiguous evidence
  // must never use this branch (handled above → unknown).
  if (generationStatus === "interrupted") {
    return finalizeEvidence({
      status: "not_charged",
      settledPoints: 0,
      evidenceStatus: "complete",
      violations,
    });
  }

  return finalizeEvidence({
    status: "unknown",
    settledPoints: null,
    evidenceStatus: "insufficient",
    violations,
  });
}
