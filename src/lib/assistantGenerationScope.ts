import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  generationSequenceForVariant,
  normalizeMessageVariants,
} from "@/lib/messageAlternates";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";

/** Canonical generation identity for one assistant message row. */
export type AssistantGenerationScope = {
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
};

const IN_FLIGHT_GENERATION_STATUSES = new Set([
  "generating",
  "submitted",
]);

export function generationJobKey(scope: Pick<AssistantGenerationScope, "assistantMessageId" | "generationSequence">): string {
  return `${scope.assistantMessageId}:${scope.generationSequence}`;
}

export function parseGenerationJobKey(key: string): AssistantGenerationScope | null {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const assistantMessageId = Number(key.slice(0, sep));
  const generationSequence = Number(key.slice(sep + 1));
  if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) return null;
  if (!Number.isInteger(generationSequence) || generationSequence < 0) return null;
  return {
    assistantMessageId,
    generationSequence,
    generationRequestId: null,
  };
}

type MessageGenerationRow = {
  id: number;
  alternates: string | null;
  active_variant: number | null;
  request_id: string | null;
  generation_status: string | null;
  content: string;
  model: string;
  usage: string | null;
};

function isInFlightGenerationStatus(status: string | null | undefined): boolean {
  return IN_FLIGHT_GENERATION_STATUSES.has(String(status ?? "").trim());
}

/** Resolve receipt/active generation from the currently selected variant (or in-flight next sequence). */
export function resolveActiveAssistantGenerationScopeFromRow(
  row: MessageGenerationRow
): AssistantGenerationScope | null {
  const { variants, activeVariant } = normalizeMessageVariants(row);

  if (isInFlightGenerationStatus(row.generation_status)) {
    return {
      assistantMessageId: row.id,
      generationSequence: variants.length,
      generationRequestId: row.request_id?.trim() || null,
    };
  }

  if (variants.length === 0) {
    if (!row.content.trim() && !row.request_id?.trim()) return null;
    return {
      assistantMessageId: row.id,
      generationSequence: 0,
      generationRequestId: row.request_id?.trim() || null,
    };
  }

  const active = variants[activeVariant];
  if (!active) return null;
  return {
    assistantMessageId: row.id,
    generationSequence: generationSequenceForVariant(active, activeVariant),
    generationRequestId: active.requestId?.trim() || row.request_id?.trim() || null,
  };
}

export function resolveActiveAssistantGenerationScope(
  assistantMessageId: number,
  db: Database.Database = getDb()
): AssistantGenerationScope | null {
  const row = db
    .prepare(
      `SELECT id, alternates, active_variant, request_id, generation_status, content, model, usage
       FROM messages WHERE id=?`
    )
    .get(assistantMessageId) as MessageGenerationRow | undefined;
  if (!row) return null;
  return resolveActiveAssistantGenerationScopeFromRow(row);
}

/** Next generation sequence when a regen bootstrap starts (before finalize appends the variant). */
export function resolveNextAssistantGenerationSequence(
  assistantMessageId: number,
  db: Database.Database = getDb()
): number {
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?`
    )
    .get(assistantMessageId) as
    | Pick<MessageGenerationRow, "content" | "model" | "usage" | "alternates" | "active_variant">
    | undefined;
  if (!row) return 0;
  const { variants } = normalizeMessageVariants(row);
  return variants.length;
}

export function recordMatchesGenerationScope(
  record: { generationSequence?: number | null } | null | undefined,
  scope: AssistantGenerationScope
): boolean {
  if (!record) return false;
  return record.generationSequence === scope.generationSequence;
}

export function ledgerRowMatchesGenerationScope(
  row: Pick<ProviderCostLedgerRow, "generation_sequence">,
  scope: AssistantGenerationScope
): boolean {
  if (row.generation_sequence == null) return false;
  return row.generation_sequence === scope.generationSequence;
}

export function filterLedgerRowsForGenerationScope(
  rows: ProviderCostLedgerRow[],
  scope: AssistantGenerationScope
): {
  scopedRows: ProviderCostLedgerRow[];
  hasUnscopedRows: boolean;
  hasOtherGenerationRows: boolean;
} {
  const scopedRows: ProviderCostLedgerRow[] = [];
  let hasUnscopedRows = false;
  let hasOtherGenerationRows = false;
  for (const row of rows) {
    if (row.generation_sequence == null) {
      hasUnscopedRows = true;
      continue;
    }
    if (row.generation_sequence === scope.generationSequence) {
      scopedRows.push(row);
    } else {
      hasOtherGenerationRows = true;
    }
  }
  return { scopedRows, hasUnscopedRows, hasOtherGenerationRows };
}

/** Fail closed when async logical record provenance does not match active generation. */
export function asyncRecordMatchesGenerationScope(
  record:
    | { generationSequence?: number | null; pending?: boolean; failed?: boolean }
    | null
    | undefined,
  scope: AssistantGenerationScope
): boolean {
  if (!record) return false;
  if (record.generationSequence == null) return false;
  return record.generationSequence === scope.generationSequence;
}

export function isCurrentAssistantGeneration(
  scope: AssistantGenerationScope,
  db: Database.Database = getDb()
): boolean {
  const current = resolveActiveAssistantGenerationScope(scope.assistantMessageId, db);
  if (!current) return false;
  if (current.generationSequence !== scope.generationSequence) return false;
  if (
    scope.generationRequestId &&
    current.generationRequestId &&
    scope.generationRequestId !== current.generationRequestId
  ) {
    return false;
  }
  return true;
}
