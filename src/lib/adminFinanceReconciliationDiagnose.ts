import "server-only";

import type Database from "better-sqlite3";
import { monthRangeSql } from "@/lib/adminFinance";
import { resolveActiveAssistantGenerationScopeFromRow } from "@/lib/assistantGenerationScope";
import {
  ensureProviderCostLedgerSchema,
  isLedgerEventCostExact,
} from "@/lib/providerCostLedger";
import { readProviderReconciliationState } from "@/lib/providerCostReconciliation";

/**
 * Opt-in read-only linkage audit for GET /api/admin/finance?diagnose=reconciliation.
 * Counts only. Never mutates the ledger, never runs reconcile, never calls a provider.
 * Stage parsing mirrors buildMessageProviderIdentityIndex; that function remains
 * the write-path owner.
 */

export const RECONCILIATION_DIAGNOSE_VALUE = "reconciliation";
export const RECONCILIATION_ROOT_CAUSE_UNCONFIRMED = "ROOT_CAUSE_UNCONFIRMED" as const;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type LedgerPeriodCounts = {
  rows: number;
  exactRows: number;
  inexactRows: number;
  withProviderRequestId: number;
  withoutProviderRequestId: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
};

export type MessageLinkageCounts = {
  messagesWithStoredRequestId: number;
  distinctStoredRequestIds: number;
  usableIdentities: number;
  linkedToLedgerAny: number;
  linkedToLedgerInWindow: number;
  linkedToLedgerOutsideWindow: number;
  unlinkedToLedger: number;
  nearBoundary9h: number;
};

export type ProviderReconciliationDiagnosis = {
  monthKey: string;
  windowStart: string;
  windowEnd: string;
  windowSemantics: "naive_calendar_month_treated_as_utc";
  ledgerInWindow: LedgerPeriodCounts;
  messagesInWindow: MessageLinkageCounts;
  messagesOutOfWindow: MessageLinkageCounts;
  storedReconciliation: {
    present: boolean;
    status: string | null;
    settledMicroUsd: number | null;
    localReconciledMicroUsd: number | null;
    unreconciledProviderMicroUsd: number | null;
    storedWindowStart: string | null;
    storedWindowEnd: string | null;
  };
  evidence: {
    missingRequestIdsInWindow: boolean;
    outOfWindowIdentitiesPresent: boolean;
    inWindowIdentitiesUnlinked: boolean;
    timezoneBoundaryCandidate: boolean;
    remoteOnlyOrIdMismatchCandidate: boolean;
    remotePerRequestDataAvailable: false;
    classification: typeof RECONCILIATION_ROOT_CAUSE_UNCONFIRMED;
    requiredToConfirm: readonly string[];
  };
};

const REQUIRED_TO_CONFIRM = [
  "Admin GET /api/admin/finance?diagnose=reconciliation&month=<KST YYYY-MM> against production (aggregates only).",
  "Read-only production SQLite counts from api_cost_ledger, messages.usage.stages.providerRequestId, and provider_cost_reconciliation_state for that month.",
  "Read-only CheaperInference /usage/requests for the same window (settled flag + billed micro + request-id presence counts). Do not POST /api/admin/finance/reconcile and do not issue paid generations.",
] as const;

const FORBIDDEN_DIAGNOSIS_KEYS = new Set([
  "providerrequestid",
  "provider_request_id",
  "requestid",
  "request_id",
  "userid",
  "user_id",
  "email",
  "content",
  "prompt",
  "apikey",
  "api_key",
  "nickname",
  "chatid",
  "chat_id",
  "assistantmessageid",
  "assistant_message_id",
  "authorization",
  "rawresponse",
  "responsebody",
]);

type MessageRequestPresence = {
  messageId: number;
  requestId: string;
  createdAt: string;
  usable: boolean;
};

function emptyLinkage(): MessageLinkageCounts {
  return {
    messagesWithStoredRequestId: 0,
    distinctStoredRequestIds: 0,
    usableIdentities: 0,
    linkedToLedgerAny: 0,
    linkedToLedgerInWindow: 0,
    linkedToLedgerOutsideWindow: 0,
    unlinkedToLedger: 0,
    nearBoundary9h: 0,
  };
}

function increment(bucket: Record<string, number>, raw: string | null): void {
  const trimmed = (raw ?? "").trim();
  const key =
    !trimmed
      ? "(null)"
      : trimmed.length > 64 ||
          /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
            trimmed
          )
        ? "(other)"
        : trimmed;
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function sqlDateTimeToUtcMs(value: string): number {
  const trimmed = value.trim();
  const iso = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

function inRange(createdAt: string, start: string, end: string): boolean {
  return createdAt >= start && createdAt < end;
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) != null
  );
}

function tableColumnSet(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (column) => column.name
    )
  );
}

function collectMessageRequestPresence(db: Database.Database): MessageRequestPresence[] {
  if (!tableExists(db, "messages")) return [];
  const columns = tableColumnSet(db, "messages");
  if (!columns.has("usage") || !columns.has("created_at") || !columns.has("id")) return [];
  const alternatesExpr = columns.has("alternates") ? "alternates" : "NULL AS alternates";
  const activeVariantExpr = columns.has("active_variant")
    ? "active_variant"
    : "NULL AS active_variant";
  const requestIdExpr = columns.has("request_id") ? "request_id" : "NULL AS request_id";
  const generationStatusExpr = columns.has("generation_status")
    ? "generation_status"
    : "NULL AS generation_status";
  const modelExpr = columns.has("model") ? "model" : "'' AS model";
  const contentExpr = columns.has("content") ? "content" : "'' AS content";
  const rows = db
    .prepare(
      `SELECT id, ${contentExpr}, ${modelExpr}, usage, ${alternatesExpr}, ${activeVariantExpr},
              ${requestIdExpr}, ${generationStatusExpr}, created_at
         FROM messages
        WHERE role = 'assistant' AND usage LIKE '%"providerRequestId"%'`
    )
    .all() as Array<{
    id: number;
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
    request_id: string | null;
    generation_status: string | null;
    created_at: string;
  }>;

  const out: MessageRequestPresence[] = [];
  for (const row of rows) {
    let usage: Record<string, unknown>;
    try {
      usage = JSON.parse(row.usage ?? "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const stages = Array.isArray(usage.stages) ? (usage.stages as unknown[]) : [];
    const scope = resolveActiveAssistantGenerationScopeFromRow(row);
    for (const raw of stages) {
      if (!raw || typeof raw !== "object") continue;
      const stage = raw as Record<string, unknown>;
      const requestId =
        typeof stage.providerRequestId === "string" ? stage.providerRequestId.trim() : "";
      if (!requestId) continue;
      out.push({
        messageId: row.id,
        requestId,
        createdAt: row.created_at,
        usable: Boolean(scope),
      });
    }
  }
  return out;
}

function ledgerIdSets(
  db: Database.Database,
  start: string,
  end: string
): { anyIds: Set<string>; inWindowIds: Set<string> } {
  const anyIds = new Set<string>();
  const inWindowIds = new Set<string>();
  if (!tableExists(db, "api_cost_ledger")) return { anyIds, inWindowIds };
  const columns = tableColumnSet(db, "api_cost_ledger");
  if (!columns.has("provider_request_id") || !columns.has("created_at")) {
    return { anyIds, inWindowIds };
  }
  const rows = db
    .prepare(
      `SELECT provider_request_id, created_at
         FROM api_cost_ledger
        WHERE provider_request_id IS NOT NULL AND TRIM(provider_request_id) != ''`
    )
    .all() as Array<{ provider_request_id: string; created_at: string }>;
  for (const row of rows) {
    const id = row.provider_request_id.trim();
    if (!id) continue;
    anyIds.add(id);
    if (inRange(row.created_at, start, end)) inWindowIds.add(id);
  }
  return { anyIds, inWindowIds };
}

function countLedgerInWindow(db: Database.Database, start: string, end: string): LedgerPeriodCounts {
  const counts: LedgerPeriodCounts = {
    rows: 0,
    exactRows: 0,
    inexactRows: 0,
    withProviderRequestId: 0,
    withoutProviderRequestId: 0,
    bySource: {},
    byStatus: {},
  };
  if (!tableExists(db, "api_cost_ledger")) return counts;
  const columns = tableColumnSet(db, "api_cost_ledger");
  if (!columns.has("created_at")) return counts;
  const sourceExpr = columns.has("actual_cost_source")
    ? "actual_cost_source"
    : "NULL AS actual_cost_source";
  const statusExpr = columns.has("event_status") ? "event_status" : "NULL AS event_status";
  const usdExpr = columns.has("actual_cost_usd") ? "actual_cost_usd" : "NULL AS actual_cost_usd";
  const requestIdExpr = columns.has("provider_request_id")
    ? "provider_request_id"
    : "NULL AS provider_request_id";
  const rows = db
    .prepare(
      `SELECT ${sourceExpr}, ${statusExpr}, ${usdExpr}, ${requestIdExpr}
         FROM api_cost_ledger
        WHERE created_at >= ? AND created_at < ?`
    )
    .all(start, end) as Array<{
    actual_cost_source: string | null;
    event_status: string | null;
    actual_cost_usd: number | null;
    provider_request_id: string | null;
  }>;

  for (const row of rows) {
    counts.rows += 1;
    if (isLedgerEventCostExact(row)) counts.exactRows += 1;
    else counts.inexactRows += 1;
    if (row.provider_request_id?.trim()) counts.withProviderRequestId += 1;
    else counts.withoutProviderRequestId += 1;
    increment(counts.bySource, row.actual_cost_source);
    increment(counts.byStatus, row.event_status);
  }
  return counts;
}

function isNearBoundary(createdAt: string, start: string, end: string): boolean {
  const createdMs = sqlDateTimeToUtcMs(createdAt);
  const startMs = sqlDateTimeToUtcMs(start);
  const endMs = sqlDateTimeToUtcMs(end);
  if (![createdMs, startMs, endMs].every(Number.isFinite)) return false;
  return (
    (createdMs >= startMs - KST_OFFSET_MS && createdMs < startMs) ||
    (createdMs >= endMs && createdMs < endMs + KST_OFFSET_MS)
  );
}

function countMessageLinkage(
  presence: MessageRequestPresence[],
  start: string,
  end: string,
  ledgerAny: Set<string>,
  ledgerInWindow: Set<string>,
  inWindow: boolean
): MessageLinkageCounts {
  const counts = emptyLinkage();
  const selected = presence.filter((row) => inRange(row.createdAt, start, end) === inWindow);
  const messageIds = new Set<number>();
  const distinct = new Map<string, MessageRequestPresence>();
  for (const row of selected) {
    messageIds.add(row.messageId);
    const prev = distinct.get(row.requestId);
    if (!prev || (row.usable && !prev.usable)) distinct.set(row.requestId, row);
  }

  let usable = 0;
  let linkedAny = 0;
  let linkedIn = 0;
  let near = 0;
  for (const row of distinct.values()) {
    if (row.usable) usable += 1;
    if (ledgerAny.has(row.requestId)) linkedAny += 1;
    if (ledgerInWindow.has(row.requestId)) linkedIn += 1;
    if (!inWindow && isNearBoundary(row.createdAt, start, end)) near += 1;
  }

  counts.messagesWithStoredRequestId = messageIds.size;
  counts.distinctStoredRequestIds = distinct.size;
  counts.usableIdentities = usable;
  counts.linkedToLedgerAny = linkedAny;
  counts.linkedToLedgerInWindow = linkedIn;
  counts.linkedToLedgerOutsideWindow = Math.max(0, linkedAny - linkedIn);
  counts.unlinkedToLedger = Math.max(0, distinct.size - linkedAny);
  counts.nearBoundary9h = near;
  return counts;
}

function looksLikeIdentifier(value: string): boolean {
  return (
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
  );
}

export function assertReconciliationDiagnosisSafePayload(payload: unknown): void {
  const walk = (value: unknown, path: string): void => {
    if (value == null) return;
    if (typeof value === "string") {
      if (looksLikeIdentifier(value)) {
        throw new Error(`reconciliation diagnosis leaked an identifier at ${path}`);
      }
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_DIAGNOSIS_KEYS.has(key.toLowerCase())) {
          throw new Error(`reconciliation diagnosis forbids key ${key}`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(payload, "reconciliationDiagnosis");
}

export function diagnoseProviderReconciliationLinkage(
  db: Database.Database,
  monthKey: string
): ProviderReconciliationDiagnosis {
  ensureProviderCostLedgerSchema(db);
  const { start, end } = monthRangeSql(monthKey);
  const ledgerInWindow = countLedgerInWindow(db, start, end);
  const { anyIds, inWindowIds } = ledgerIdSets(db, start, end);
  const presence = collectMessageRequestPresence(db);
  const messagesInWindow = countMessageLinkage(presence, start, end, anyIds, inWindowIds, true);
  const messagesOutOfWindow = countMessageLinkage(
    presence,
    start,
    end,
    anyIds,
    inWindowIds,
    false
  );

  const stored = readProviderReconciliationState(db);
  const unreconciled = stored?.unreconciledProviderMicroUsd ?? 0;

  const diagnosis: ProviderReconciliationDiagnosis = {
    monthKey,
    windowStart: start,
    windowEnd: end,
    windowSemantics: "naive_calendar_month_treated_as_utc",
    ledgerInWindow,
    messagesInWindow,
    messagesOutOfWindow,
    storedReconciliation: {
      present: stored != null,
      status: stored?.status ?? null,
      settledMicroUsd: stored ? stored.settledMicroUsd : null,
      localReconciledMicroUsd: stored ? stored.localReconciledMicroUsd : null,
      unreconciledProviderMicroUsd: stored ? stored.unreconciledProviderMicroUsd : null,
      storedWindowStart: stored?.windowStart ?? null,
      storedWindowEnd: stored?.windowEnd ?? null,
    },
    evidence: {
      missingRequestIdsInWindow: messagesInWindow.distinctStoredRequestIds === 0,
      outOfWindowIdentitiesPresent: messagesOutOfWindow.distinctStoredRequestIds > 0,
      inWindowIdentitiesUnlinked: messagesInWindow.unlinkedToLedger > 0,
      timezoneBoundaryCandidate: messagesOutOfWindow.nearBoundary9h > 0,
      remoteOnlyOrIdMismatchCandidate:
        unreconciled > 0 &&
        messagesInWindow.unlinkedToLedger === 0 &&
        messagesOutOfWindow.unlinkedToLedger === 0,
      remotePerRequestDataAvailable: false,
      classification: RECONCILIATION_ROOT_CAUSE_UNCONFIRMED,
      requiredToConfirm: REQUIRED_TO_CONFIRM,
    },
  };
  assertReconciliationDiagnosisSafePayload(diagnosis);
  return diagnosis;
}
