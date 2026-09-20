import {
  resolveAdminReceiptCostAttribution,
  resolveAdminReceiptPhysicalCallDiagnostic,
  type AdminReceiptCostAttribution,
} from "@/lib/adminBillingReceiptProvenance";
import type { AuxProviderOwner } from "@/lib/auxProviderProvenance";
import {
  readProviderCostEventByProviderRequestId,
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
): AdminProviderRequestForensicRecord | null {
  const trimmed = providerRequestId.trim();
  if (!trimmed) return null;
  const row = readProviderCostEventByProviderRequestId(trimmed, opts?.provider, opts?.db);
  if (!row) return null;
  return projectAdminProviderRequestForensicRecord(row);
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
