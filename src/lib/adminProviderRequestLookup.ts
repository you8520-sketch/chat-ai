import {
  resolveAdminReceiptCostAttribution,
  resolveAdminReceiptPhysicalCallDiagnostic,
  type AdminReceiptCostAttribution,
} from "@/lib/adminBillingReceiptProvenance";
import type { AuxProviderOwner } from "@/lib/auxProviderProvenance";
import {
  listProviderCostEventsByProviderRequestId,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";

/** Canonical ledger evidence for one physical provider request — no prompt/content fields. */
export type AdminProviderRequestForensicRecord = {
  id: number;
  createdAt: string;
  provider: string;
  actualProvider: string | null;
  model: string;
  actualModel: string | null;
  requestKind: string;
  costCenter: string | null;
  family: string | null;
  executionPhase: string | null;
  assistantMessageId: number | null;
  generationSequence: number | null;
  generationRequestId: string | null;
  providerRequestId: string | null;
  eventStatus: string | null;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  actualCostSource: string | null;
  /** Ledger-derived owner label (same projector as Admin Receipt v3). */
  canonicalOwner: AuxProviderOwner;
  costAttribution: AdminReceiptCostAttribution;
  turnLinked: boolean;
  chatId: number | null;
};

export type AdminProviderRequestForensicLookupResult = {
  /** Oldest matching row (lowest id) — diagnostic display only, never a cost sum. */
  event: AdminProviderRequestForensicRecord;
  matchingRowCount: number;
  duplicateDetected: boolean;
};

/**
 * READ SIDE EFFECT (established application behavior, not unique to this lookup):
 * `listProviderCostEventsByProviderRequestId` calls `ensureProviderCostLedgerSchema()`,
 * which may ALTER TABLE add missing columns and CREATE INDEX IF NOT EXISTS on first access.
 * Legacy DBs with duplicate (provider, provider_request_id) pairs skip the unique index
 * but rows are never deleted or merged by reads. Same pattern as all other ledger readers.
 */
export function projectAdminProviderRequestForensicRecord(
  row: ProviderCostLedgerRow
): AdminProviderRequestForensicRecord {
  const provenance = resolveAdminReceiptPhysicalCallDiagnostic(row);
  return {
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
    actualProvider: row.actual_provider?.trim() || null,
    model: row.model,
    actualModel: row.actual_model?.trim() || null,
    requestKind: row.request_kind,
    costCenter: row.cost_center?.trim() || null,
    family: row.family?.trim() || null,
    executionPhase: row.execution_phase?.trim() || null,
    assistantMessageId: row.assistant_message_id,
    generationSequence: row.generation_sequence,
    generationRequestId: row.generation_request_id?.trim() || null,
    providerRequestId: row.provider_request_id?.trim() || null,
    eventStatus: row.event_status?.trim() || null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    actualCostUsd:
      row.actual_cost_usd != null && Number.isFinite(row.actual_cost_usd)
        ? row.actual_cost_usd
        : null,
    actualCostSource: row.actual_cost_source?.trim() || null,
    canonicalOwner: provenance.canonicalOwner,
    costAttribution: provenance.costAttribution,
    turnLinked: row.assistant_message_id != null,
    chatId: row.chat_id,
  };
}

export function lookupAdminProviderRequestForensic(
  providerRequestId: string,
  opts?: { provider?: string; db?: import("better-sqlite3").Database }
): AdminProviderRequestForensicLookupResult | null {
  const trimmed = providerRequestId.trim();
  if (!trimmed) return null;
  const rows = listProviderCostEventsByProviderRequestId(
    trimmed,
    opts?.provider,
    opts?.db
  );
  if (rows.length === 0) return null;
  return {
    event: projectAdminProviderRequestForensicRecord(rows[0]!),
    matchingRowCount: rows.length,
    duplicateDetected: rows.length > 1,
  };
}

/** Keys that must never appear in admin forensic lookup responses. */
export const ADMIN_PROVIDER_REQUEST_FORBIDDEN_RESPONSE_KEYS = [
  "prompt",
  "messages",
  "content",
  "authorization",
  "apiKey",
  "api_key",
  "rawResponse",
  "responseBody",
] as const;

export function assertAdminProviderRequestForensicSafePayload(
  payload: unknown
): void {
  if (payload == null || typeof payload !== "object") return;
  for (const key of ADMIN_PROVIDER_REQUEST_FORBIDDEN_RESPONSE_KEYS) {
    if (key in (payload as Record<string, unknown>)) {
      throw new Error(`forbidden forensic field: ${key}`);
    }
  }
  const event = (payload as { event?: unknown }).event;
  if (event != null && typeof event === "object") {
    for (const key of ADMIN_PROVIDER_REQUEST_FORBIDDEN_RESPONSE_KEYS) {
      if (key in (event as Record<string, unknown>)) {
        throw new Error(`forbidden forensic field: event.${key}`);
      }
    }
  }
}
