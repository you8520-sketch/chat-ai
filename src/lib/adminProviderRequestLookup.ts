import {
  resolveAdminReceiptCostAttribution,
  resolveAdminReceiptPhysicalCallDiagnostic,
  type AdminReceiptCostAttribution,
} from "@/lib/adminBillingReceiptProvenance";
import type { AuxProviderOwner } from "@/lib/auxProviderProvenance";
import {
  listProviderCostEventsByProviderRequestId,
  listProviderCostEventsInCreatedAtRange,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";

import {
  BROADER_CORRELATION_WINDOW_SECONDS,
  DEFAULT_CORRELATION_WINDOW_SECONDS,
  LEDGER_CREATED_AT_SEMANTICS,
  LEDGER_INPUT_TOKEN_SEMANTICS,
} from "@/lib/adminProviderRequestLookupShared";

export {
  BROADER_CORRELATION_WINDOW_SECONDS,
  DEFAULT_CORRELATION_WINDOW_SECONDS,
  LEDGER_CREATED_AT_SEMANTICS,
  LEDGER_INPUT_TOKEN_SEMANTICS,
} from "@/lib/adminProviderRequestLookupShared";

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

export type AdminHistoricalLedgerCorrelationInput = {
  provider?: string;
  model: string;
  requestedAtUtc: string;
  durationMs: number;
  originalInputTokens: number;
  sentToModelTokens: number;
  outputTokens: number;
  windowSeconds?: number;
};

export type AdminHistoricalCorrelationEvidence = {
  providerMatch: boolean;
  modelMatch: boolean;
  timeMatch: boolean;
  timeDeltaMs: number | null;
  outputTokensMatch: boolean;
  inputTokenMatchType:
    | "SENT_TO_MODEL_EXACT"
    | "ORIGINAL_INPUT_EXACT"
    | "NONE"
    | "MISMATCH";
  providerRequestIdPresent: boolean;
  assistantMessageId: number | null;
  requestKind: string;
  family: string | null;
  executionPhase: string | null;
  costCenter: string | null;
  eventStatus: string | null;
  actualCostUsd: number | null;
  turnLinked: boolean;
};

export type AdminHistoricalCorrelationCandidate = {
  event: AdminProviderRequestForensicRecord;
  evidence: AdminHistoricalCorrelationEvidence;
  ownerInterpretation: string;
};

export type AdminHistoricalCorrelationState =
  | "EXACT_SINGLE_CANDIDATE"
  | "NO_CANDIDATE"
  | "AMBIGUOUS_MULTIPLE_CANDIDATES";

export type AdminHistoricalLedgerCorrelationResult = {
  state: AdminHistoricalCorrelationState;
  candidates: AdminHistoricalCorrelationCandidate[];
  expectedCompletionUtc: string;
  windowSeconds: number;
  ledgerInputTokenSemantics: typeof LEDGER_INPUT_TOKEN_SEMANTICS;
  ledgerCreatedAtSemantics: typeof LEDGER_CREATED_AT_SEMANTICS;
};

export function normalizeForensicModelId(model: string): string {
  return model.trim().toLowerCase().replace(/^openai\//, "");
}

export function ledgerRowMatchesForensicModel(
  row: ProviderCostLedgerRow,
  model: string
): boolean {
  const target = normalizeForensicModelId(model);
  const candidates = [row.actual_model, row.model, row.requested_model]
    .map((value) => (value?.trim() ? normalizeForensicModelId(value) : ""))
    .filter(Boolean);
  return candidates.includes(target);
}

export function expectedCompletionUtcFromProviderTiming(
  requestedAtUtc: string,
  durationMs: number
): Date {
  const startMs = Date.parse(requestedAtUtc);
  if (!Number.isFinite(startMs)) {
    throw new Error("invalid requestedAtUtc");
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("invalid durationMs");
  }
  return new Date(startMs + durationMs);
}

export function formatUtcSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function parseLedgerCreatedAtUtc(createdAt: string): number | null {
  const normalized = createdAt.trim().replace(" ", "T");
  const withZone = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildHistoricalCorrelationEvidence(
  row: ProviderCostLedgerRow,
  input: AdminHistoricalLedgerCorrelationInput,
  expectedCompletionMs: number,
  windowSeconds: number
): AdminHistoricalCorrelationEvidence {
  const event = projectAdminProviderRequestForensicRecord(row);
  const createdMs = parseLedgerCreatedAtUtc(row.created_at);
  const timeDeltaMs =
    createdMs == null ? null : Math.abs(createdMs - expectedCompletionMs);
  const withinWindow =
    timeDeltaMs != null && timeDeltaMs <= windowSeconds * 1000;
  let inputTokenMatchType: AdminHistoricalCorrelationEvidence["inputTokenMatchType"] =
    "NONE";
  if (row.input_tokens === input.sentToModelTokens) {
    inputTokenMatchType = "SENT_TO_MODEL_EXACT";
  } else if (row.input_tokens === input.originalInputTokens) {
    inputTokenMatchType = "ORIGINAL_INPUT_EXACT";
  } else if (row.input_tokens > 0) {
    inputTokenMatchType = "MISMATCH";
  }
  return {
    providerMatch: row.provider.trim().toLowerCase() === (input.provider ?? "cheaperinference").trim().toLowerCase(),
    modelMatch: ledgerRowMatchesForensicModel(row, input.model),
    timeMatch: withinWindow,
    timeDeltaMs,
    outputTokensMatch: row.output_tokens === input.outputTokens,
    inputTokenMatchType,
    providerRequestIdPresent: Boolean(row.provider_request_id?.trim()),
    assistantMessageId: event.assistantMessageId,
    requestKind: event.requestKind,
    family: event.family,
    executionPhase: event.executionPhase,
    costCenter: event.costCenter,
    eventStatus: event.eventStatus,
    actualCostUsd: event.actualCostUsd,
    turnLinked: event.turnLinked,
  };
}

export function interpretHistoricalCorrelationOwner(
  event: AdminProviderRequestForensicRecord
): string {
  if (event.assistantMessageId == null && event.requestKind === "background-prompt-translation") {
    return "DERIVED_CACHE_OR_PROMPT_TRANSLATION_CONFIRMED";
  }
  if (event.providerRequestId == null || event.providerRequestId.trim() === "") {
    return "PRODUCTION_CALL_CONFIRMED_PROVIDER_REQUEST_ID_PROVENANCE_MISSING";
  }
  if (event.turnLinked) {
    return "TURN_LINKED_LEDGER_EVIDENCE";
  }
  return "BACKGROUND_LEDGER_EVIDENCE";
}

export function correlateAdminHistoricalLedger(
  input: AdminHistoricalLedgerCorrelationInput,
  db: import("better-sqlite3").Database
): AdminHistoricalLedgerCorrelationResult {
  const provider = input.provider?.trim().toLowerCase() || "cheaperinference";
  const windowSeconds = input.windowSeconds ?? DEFAULT_CORRELATION_WINDOW_SECONDS;
  const expectedCompletion = expectedCompletionUtcFromProviderTiming(
    input.requestedAtUtc,
    input.durationMs
  );
  const expectedCompletionMs = expectedCompletion.getTime();
  const from = formatUtcSqliteDateTime(
    new Date(expectedCompletionMs - windowSeconds * 1000)
  );
  const to = formatUtcSqliteDateTime(
    new Date(expectedCompletionMs + windowSeconds * 1000)
  );

  const rows = listProviderCostEventsInCreatedAtRange(
    {
      provider,
      createdAtFrom: from,
      createdAtTo: to,
      outputTokens: input.outputTokens,
      inputTokens: input.sentToModelTokens,
    },
    db
  );

  const candidates = rows
    .filter((row) => ledgerRowMatchesForensicModel(row, input.model))
    .map((row) => {
      const event = projectAdminProviderRequestForensicRecord(row);
      return {
        event,
        evidence: buildHistoricalCorrelationEvidence(
          row,
          { ...input, provider },
          expectedCompletionMs,
          windowSeconds
        ),
        ownerInterpretation: interpretHistoricalCorrelationOwner(event),
      };
    });

  let state: AdminHistoricalCorrelationState;
  if (candidates.length === 0) {
    state = "NO_CANDIDATE";
  } else if (candidates.length === 1) {
    state = "EXACT_SINGLE_CANDIDATE";
  } else {
    state = "AMBIGUOUS_MULTIPLE_CANDIDATES";
  }

  return {
    state,
    candidates,
    expectedCompletionUtc: expectedCompletion.toISOString(),
    windowSeconds,
    ledgerInputTokenSemantics: LEDGER_INPUT_TOKEN_SEMANTICS,
    ledgerCreatedAtSemantics: LEDGER_CREATED_AT_SEMANTICS,
  };
}

export function assertAdminProviderRequestForensicSafePayload(
  payload: unknown
): void {
  if (payload == null || typeof payload !== "object") return;
  for (const key of ADMIN_PROVIDER_REQUEST_FORBIDDEN_RESPONSE_KEYS) {
    if (key in (payload as Record<string, unknown>)) {
      throw new Error(`forbidden forensic field: ${key}`);
    }
  }
  const inspectEvent = (event: unknown) => {
    if (event == null || typeof event !== "object") return;
    for (const key of ADMIN_PROVIDER_REQUEST_FORBIDDEN_RESPONSE_KEYS) {
      if (key in (event as Record<string, unknown>)) {
        throw new Error(`forbidden forensic field: event.${key}`);
      }
    }
  };
  const root = payload as { event?: unknown; candidates?: unknown[] };
  inspectEvent(root.event);
  if (Array.isArray(root.candidates)) {
    for (const candidate of root.candidates) {
      if (candidate != null && typeof candidate === "object") {
        inspectEvent((candidate as { event?: unknown }).event);
      }
    }
  }
}
