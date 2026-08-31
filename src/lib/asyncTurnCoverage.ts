import "server-only";

import type { Usage } from "@/lib/chatUsage";
import { suggestedRepliesHaveContent } from "@/lib/suggestedReplies/parse";
import type { SuggestedRepliesRecord } from "@/lib/suggestedReplies/types";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";
import type { StatusMetaRecord } from "@/lib/statusMeta/types";
import type { ProviderCostFamily, ProviderCostLedgerRow } from "@/lib/providerCostLedger";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";

export type TurnAttributableAsyncFamily =
  | "suggested_replies_repair"
  | "status_meta"
  | "memory_relationship";

export type AsyncFamilyExpectationState =
  | "not_expected"
  | "pending"
  | "terminal"
  | "unverifiable";

export type AsyncFamilyCoverageState =
  | "complete"
  | "pending"
  | "partial"
  | "unverifiable";

export type ResolvedAsyncFamilyExpectation = {
  family: TurnAttributableAsyncFamily;
  label: string;
  expectationState: AsyncFamilyExpectationState;
  skipReason?: string;
  taskPending?: boolean;
  taskFailed?: boolean;
};

export type AsyncTurnCoverageResult = {
  families: ResolvedAsyncFamilyExpectation[];
  overallCoverage: AsyncFamilyCoverageState;
  expectedFamilies: TurnAttributableAsyncFamily[];
  terminalFamilies: TurnAttributableAsyncFamily[];
  pendingFamilies: TurnAttributableAsyncFamily[];
  skippedFamilies: TurnAttributableAsyncFamily[];
  unverifiableFamilies: TurnAttributableAsyncFamily[];
};

const ASYNC_FAMILY_LABELS: Record<TurnAttributableAsyncFamily, string> = {
  suggested_replies_repair: "Suggested Replies",
  status_meta: "Status Meta",
  memory_relationship: "Relationship Memory",
};

const TURN_ATTRIBUTABLE_ASYNC_FAMILIES: TurnAttributableAsyncFamily[] = [
  "suggested_replies_repair",
  "status_meta",
  "memory_relationship",
];

function isTurnAttributableAsyncFamily(
  family: string | null | undefined
): family is TurnAttributableAsyncFamily {
  return (
    family === "suggested_replies_repair" ||
    family === "status_meta" ||
    family === "memory_relationship"
  );
}

/** Canonical async expectation owner — persisted state only, fail-closed. */
export function resolveSuggestedRepliesExpectation(input: {
  usage: Usage;
  record: SuggestedRepliesRecord | null;
  repairLedgerRowCount: number;
}): ResolvedAsyncFamilyExpectation {
  const family = "suggested_replies_repair" as const;
  if (input.usage.htmlFlashOnly) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "not_expected",
      skipReason: "html_flash_only_turn",
    };
  }

  const syncExtract = input.usage.statusWidgetExtract;
  if (
    syncExtract?.postTurnSharedInitial &&
    input.record &&
    suggestedRepliesHaveContent(input.record.replies) &&
    !input.record.pending &&
    input.repairLedgerRowCount === 0
  ) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "not_expected",
      skipReason: "post_turn_shared_initial_satisfied",
    };
  }

  if (!input.record) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "unverifiable",
      skipReason: "missing_suggested_replies_record",
    };
  }

  if (input.record.pending) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "pending",
      taskPending: true,
    };
  }

  return {
    family,
    label: ASYNC_FAMILY_LABELS[family],
    expectationState: "terminal",
    taskFailed: input.record.failed === true && !suggestedRepliesHaveContent(input.record.replies),
  };
}

/** Canonical status meta expectation owner — persisted state only, fail-closed. */
export function resolveStatusMetaExpectation(input: {
  record: StatusMetaRecord | null;
  statusMetaLedgerRowCount: number;
}): ResolvedAsyncFamilyExpectation {
  const family = "status_meta" as const;

  if (
    input.record &&
    !input.record.pending &&
    statusMetaHasDisplayContent(input.record.meta, input.record.formatSpec) &&
    input.statusMetaLedgerRowCount === 0
  ) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "not_expected",
      skipReason: "prefilled_or_non_provider_status_meta",
    };
  }

  if (!input.record) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "unverifiable",
      skipReason: "missing_status_meta_record",
    };
  }

  if (input.record.pending) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "pending",
      taskPending: true,
    };
  }

  return {
    family,
    label: ASYNC_FAMILY_LABELS[family],
    expectationState: "terminal",
    taskFailed:
      input.record.failed === true &&
      !statusMetaHasDisplayContent(input.record.meta, input.record.formatSpec),
  };
}

/**
 * Memory relationship logical-task expectation — durable marker is source of truth.
 * Physical ledger rows alone never promote to terminal.
 */
export function resolveMemoryRelationshipExpectation(input: {
  task: MemoryRelationshipTaskRecord | null;
  memoryRelationshipLedgerRowCount: number;
}): ResolvedAsyncFamilyExpectation {
  const family = "memory_relationship" as const;
  const rowCount = input.memoryRelationshipLedgerRowCount;

  if (!input.task) {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "unverifiable",
      skipReason:
        rowCount > 0
          ? "missing_durable_marker_with_ledger_evidence"
          : "no_durable_memory_relationship_completion_marker",
    };
  }

  if (input.task.state === "skipped") {
    if (rowCount > 0) {
      return {
        family,
        label: ASYNC_FAMILY_LABELS[family],
        expectationState: "unverifiable",
        skipReason: "skipped_marker_with_physical_ledger_contradiction",
      };
    }
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "not_expected",
      skipReason: input.task.reason ?? "memory_relationship_skipped",
    };
  }

  if (input.task.state === "pending") {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "pending",
      taskPending: true,
    };
  }

  if (input.task.state === "succeeded") {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "terminal",
      taskFailed: false,
    };
  }

  if (input.task.state === "failed") {
    return {
      family,
      label: ASYNC_FAMILY_LABELS[family],
      expectationState: "terminal",
      taskFailed: true,
    };
  }

  return {
    family,
    label: ASYNC_FAMILY_LABELS[family],
    expectationState: "unverifiable",
    skipReason: "invalid_memory_relationship_task_state",
  };
}

export function resolveAsyncTurnCoverage(input: {
  usage: Usage;
  suggestedRepliesRecord: SuggestedRepliesRecord | null;
  statusMetaRecord: StatusMetaRecord | null;
  memoryRelationshipTask: MemoryRelationshipTaskRecord | null;
  ledgerAsyncRows: ProviderCostLedgerRow[];
}): AsyncTurnCoverageResult {
  const rowsByFamily = new Map<TurnAttributableAsyncFamily, ProviderCostLedgerRow[]>();
  for (const family of TURN_ATTRIBUTABLE_ASYNC_FAMILIES) {
    rowsByFamily.set(family, []);
  }
  for (const row of input.ledgerAsyncRows) {
    if (!isTurnAttributableAsyncFamily(row.family)) continue;
    rowsByFamily.get(row.family)!.push(row);
  }

  const families = [
    resolveSuggestedRepliesExpectation({
      usage: input.usage,
      record: input.suggestedRepliesRecord,
      repairLedgerRowCount: rowsByFamily.get("suggested_replies_repair")!.length,
    }),
    resolveStatusMetaExpectation({
      record: input.statusMetaRecord,
      statusMetaLedgerRowCount: rowsByFamily.get("status_meta")!.length,
    }),
    resolveMemoryRelationshipExpectation({
      task: input.memoryRelationshipTask,
      memoryRelationshipLedgerRowCount: rowsByFamily.get("memory_relationship")!.length,
    }),
  ];

  const expectedFamilies = families
    .filter((f) => f.expectationState === "pending" || f.expectationState === "terminal")
    .map((f) => f.family);
  const terminalFamilies = families
    .filter((f) => f.expectationState === "terminal")
    .map((f) => f.family);
  const pendingFamilies = families
    .filter((f) => f.expectationState === "pending")
    .map((f) => f.family);
  const skippedFamilies = families
    .filter((f) => f.expectationState === "not_expected")
    .map((f) => f.family);
  const unverifiableFamilies = families
    .filter((f) => f.expectationState === "unverifiable")
    .map((f) => f.family);

  let overallCoverage: AsyncFamilyCoverageState;
  if (unverifiableFamilies.length > 0) {
    overallCoverage = "unverifiable";
  } else if (pendingFamilies.length > 0) {
    overallCoverage = "pending";
  } else {
    overallCoverage = "complete";
  }

  return {
    families,
    overallCoverage,
    expectedFamilies,
    terminalFamilies,
    pendingFamilies,
    skippedFamilies,
    unverifiableFamilies,
  };
}

export function isKnownAsyncFamily(
  family: string | null | undefined
): family is ProviderCostFamily {
  return (
    family === "suggested_replies_repair" ||
    family === "status_meta" ||
    family === "memory_relationship" ||
    family === "post_turn_shared_initial" ||
    family === "status_widget_extract"
  );
}

export { TURN_ATTRIBUTABLE_ASYNC_FAMILIES, ASYNC_FAMILY_LABELS };
