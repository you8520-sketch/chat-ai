import {
  CHEAPER_INFERENCE_BASE_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { toMicroUsd } from "@/lib/providerCostLedger";

/**
 * CheaperInference usage/spend client (usage:read scope).
 * Production default credential is resolveCheaperInferenceApiKey().
 * Operator/reporting callers may pass an explicit usage:read apiKey instead.
 * Decimals are validated as strings and normalized to integer micro-USD so
 * reconciliation never drifts on floats.
 */

export const CI_USAGE_REQUESTS_URL = `${CHEAPER_INFERENCE_BASE_URL}/usage/requests`;
export const CI_USAGE_DAILY_URL = `${CHEAPER_INFERENCE_BASE_URL}/usage/daily`;

export type CheaperInferenceUsageRequest = {
  requestId: string;
  status: string;
  /** Provider-settled billed cost in integer micro-USD (0 when unsettled). */
  billedMicroUsd: number;
  settled: boolean;
  model: string | null;
  endpoint: string | null;
  /** Provider event time in 'YYYY-MM-DD HH:MM:SS' (UTC) when parseable. */
  createdAt: string | null;
  /** Provider API-key id when the usage payload includes one. Never return or log this. */
  apiKeyId?: string | null;
  /** Provider API-key label when present. Internal classification only; never export. */
  apiKeyName?: string | null;
};

export type UsageClientResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "no_key" | "http" | "schema" | "network" | "incomplete";
      status?: number;
      retryAfterMs?: number;
      message: string;
    };

export type UsageFetcher = typeof fetch;

const DEFAULT_LIMIT = 100;
export const CI_USAGE_MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  const n = Math.floor(Number(limit) || DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(CI_USAGE_MAX_LIMIT, n);
}

/** Normalize a provider timestamp to 'YYYY-MM-DD HH:MM:SS' UTC when possible. */
function normalizeProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** Read a decimal USD field that may be a string or number. */
function readBilledMicroUsd(item: Record<string, unknown>): number {
  const candidate =
    item.billed_cost_usd ?? item.billedCostUsd ?? item.billed_cost ?? item.cost_usd;
  if (candidate == null) return 0;
  if (typeof candidate === "string" && candidate.trim() === "") return 0;
  return toMicroUsd(candidate as string | number);
}

function readStatus(item: Record<string, unknown>): string {
  const s = item.status ?? item.state;
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function readRequestId(item: Record<string, unknown>): string | null {
  const id = item.request_id ?? item.requestId ?? item.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

function readModel(item: Record<string, unknown>): string | null {
  const m = item.model ?? item.model_id ?? item.modelId;
  return typeof m === "string" && m.trim() ? m.trim() : null;
}

function readEndpoint(item: Record<string, unknown>): string | null {
  const e = item.endpoint ?? item.path ?? item.route;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

function readApiKeyId(item: Record<string, unknown>): string | null {
  const id = item.api_key_id ?? item.apiKeyId ?? item.key_id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

function readApiKeyName(item: Record<string, unknown>): string | null {
  const name = item.api_key_name ?? item.apiKeyName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function extractItems(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "requests", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return null;
}

function extractNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const cursor = obj.next_cursor ?? obj.nextCursor;
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
}

function parseRequestsPage(
  payload: unknown
): { requests: CheaperInferenceUsageRequest[]; nextCursor: string | null } | null {
  const items = extractItems(payload);
  if (!items) return null;
  const requests: CheaperInferenceUsageRequest[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const requestId = readRequestId(item);
    if (!requestId) return null;
    const status = readStatus(item);
    const billedMicroUsd = readBilledMicroUsd(item);
    requests.push({
      requestId,
      status,
      billedMicroUsd,
      settled: billedMicroUsd > 0 && status !== "failed" && status !== "error",
      model: readModel(item),
      endpoint: readEndpoint(item),
      createdAt: normalizeProviderTimestamp(
        item.created_at ?? item.createdAt ?? item.timestamp ?? item.created
      ),
      apiKeyId: readApiKeyId(item),
      apiKeyName: readApiKeyName(item),
    });
  }
  return { requests, nextCursor: extractNextCursor(payload) };
}

function retryAfterMsFromHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

type FetchOutcome =
  | { kind: "payload"; payload: unknown }
  | { kind: "error"; result: Extract<UsageClientResult<never>, { ok: false }> };

async function requestJson(
  url: string,
  fetchImpl: UsageFetcher,
  apiKey?: string
): Promise<FetchOutcome> {
  let key: string;
  try {
    key = apiKey?.trim() || resolveCheaperInferenceApiKey();
  } catch {
    return {
      kind: "error",
      result: { ok: false, reason: "no_key", message: "NO_CHEAPER_INFERENCE_KEY" },
    };
  }
  if (!key) {
    return {
      kind: "error",
      result: { ok: false, reason: "no_key", message: "NO_CHEAPER_INFERENCE_KEY" },
    };
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      kind: "error",
      result: {
        ok: false,
        reason: "network",
        message: (error as Error).message || "usage request failed",
      },
    };
  }
  if (!res.ok) {
    return {
      kind: "error",
      result: {
        ok: false,
        reason: "http",
        status: res.status,
        retryAfterMs: retryAfterMsFromHeader(res.headers.get("retry-after")),
        message: `usage API ${res.status}`,
      },
    };
  }
  try {
    return { kind: "payload", payload: await res.json() };
  } catch {
    return {
      kind: "error",
      result: { ok: false, reason: "schema", message: "usage API returned non-JSON" },
    };
  }
}

/** One page of workspace request history. Cursor is opaque and passed through. */
export async function fetchUsageRequestsPage(opts: {
  startAt: string;
  endAt: string;
  limit?: number;
  cursor?: string | null;
  /** Official usage:read filter. A key outside the workspace is HTTP 404, not an empty page. */
  apiKeyId?: string | null;
  fetchImpl?: UsageFetcher;
  /** Explicit usage:read credential. Production default still uses resolveCheaperInferenceApiKey(). */
  apiKey?: string;
}): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; nextCursor: string | null }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    start_at: opts.startAt,
    end_at: opts.endAt,
    limit: String(clampLimit(opts.limit)),
  });
  if (opts.cursor) params.set("cursor", opts.cursor);
  const filterKeyId = opts.apiKeyId?.trim();
  if (filterKeyId) params.set("api_key_id", filterKeyId);
  const outcome = await requestJson(
    `${CI_USAGE_REQUESTS_URL}?${params.toString()}`,
    fetchImpl,
    opts.apiKey
  );
  if (outcome.kind === "error") return outcome.result;
  const parsed = parseRequestsPage(outcome.payload);
  if (!parsed) {
    return {
      ok: false,
      reason: "schema",
      message: "usage requests response did not match the documented schema",
    };
  }
  return { ok: true, value: parsed };
}

/** All pages in [startAt, endAt). Cursor is never interpreted, only forwarded.
 * A safety cap that is hit while a cursor remains is NOT a complete history:
 * the caller gets a non-success "incomplete" result so truncated pages are
 * never treated as full provider history. */
export async function fetchAllUsageRequests(opts: {
  startAt: string;
  endAt: string;
  limit?: number;
  maxPages?: number;
  fetchImpl?: UsageFetcher;
  apiKey?: string;
  apiKeyId?: string | null;
}): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; pages: number }>> {
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? 50));
  const requests: CheaperInferenceUsageRequest[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await fetchUsageRequestsPage({
      startAt: opts.startAt,
      endAt: opts.endAt,
      limit: opts.limit,
      cursor,
      fetchImpl: opts.fetchImpl,
      apiKey: opts.apiKey,
      apiKeyId: opts.apiKeyId,
    });
    if (!page.ok) return page;
    requests.push(...page.value.requests);
    cursor = page.value.nextCursor;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (cursor) {
    return {
      ok: false,
      reason: "incomplete",
      message: `usage requests pagination hit the ${maxPages}-page safety cap with more pages remaining`,
    };
  }
  return { ok: true, value: { requests, pages } };
}

export const CI_USAGE_REQUEST_LOOKUP_MAX_GETS = 3;
export const CI_USAGE_REQUEST_LOOKUP_BUDGET_MS = 30_000;
export const CI_USAGE_CHAT_COMPLETIONS_ENDPOINT = "/v1/chat/completions";

/** Same window as production targeted reconcile: start-2min … now+1min. */
export function buildUsageRequestLookupWindow(
  requestStartedAtMs: number,
  nowMs: number
): { startAt: string; endAt: string } {
  const startMs = Math.max(0, requestStartedAtMs - 2 * 60_000);
  const endMs = nowMs + 60_000;
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Read-only bounded lookup of one provider request id.
 * Does not write the production ledger. HTTP errors fail closed immediately.
 */
export async function lookupCheaperInferenceUsageRequestById(opts: {
  requestId: string;
  startAt: string;
  endAt: string;
  apiKey: string;
  fetchImpl?: UsageFetcher;
  maxGets?: number;
  totalBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<UsageClientResult<CheaperInferenceUsageRequest>> {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) {
    return { ok: false, reason: "no_key", message: "NO_USAGE_REPORTING_KEY" };
  }
  const requestId = opts.requestId.trim();
  if (!requestId) {
    return { ok: false, reason: "schema", message: "usage lookup missing request id" };
  }
  const maxGets = Math.min(
    CI_USAGE_REQUEST_LOOKUP_MAX_GETS,
    Math.max(1, Math.floor(opts.maxGets ?? CI_USAGE_REQUEST_LOOKUP_MAX_GETS))
  );
  const budgetMs = Math.max(
    0,
    Math.floor(opts.totalBudgetMs ?? CI_USAGE_REQUEST_LOOKUP_BUDGET_MS)
  );
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const started = now();
  let lastMissing: UsageClientResult<CheaperInferenceUsageRequest> = {
    ok: false,
    reason: "incomplete",
    message: "provider request not in usage window",
  };

  for (let attempt = 0; attempt < maxGets; attempt += 1) {
    if (now() - started > budgetMs) break;
    const page = await fetchUsageRequestsPage({
      startAt: opts.startAt,
      endAt: opts.endAt,
      apiKey,
      fetchImpl: opts.fetchImpl,
    });
    if (!page.ok) return page;
    const match = page.value.requests.find((row) => row.requestId === requestId);
    if (match) return { ok: true, value: match };
    if (attempt < maxGets - 1) {
      const remaining = budgetMs - (now() - started);
      if (remaining <= 0) break;
      await sleep(Math.min(1_000, remaining));
    }
  }

  return lastMissing;
}

/**
 * Official /usage/daily schema (object "usage.daily"): the canonical window
 * total is the REQUIRED top-level `spend_usd` decimal string. `daily_spend`
 * is a per-day breakdown of the SAME spend and is never summed into it, so
 * this parser reads `spend_usd` only (no additive alias owner).
 */
function parseDaily(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  if (obj.object !== "usage.daily") return null;
  const spend = obj.spend_usd;
  if (spend == null) return null;
  return toMicroUsd(spend as string | number);
}

/** Workspace settled spend total for [startAt, endAt) — checksum only, never additive. */
export async function fetchUsageDaily(opts: {
  startAt: string;
  endAt: string;
  fetchImpl?: UsageFetcher;
}): Promise<UsageClientResult<{ settledMicroUsd: number }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ start_at: opts.startAt, end_at: opts.endAt });
  const outcome = await requestJson(`${CI_USAGE_DAILY_URL}?${params.toString()}`, fetchImpl);
  if (outcome.kind === "error") return outcome.result;
  const settledMicroUsd = parseDaily(outcome.payload);
  if (settledMicroUsd == null) {
    return {
      ok: false,
      reason: "schema",
      message: "usage daily response did not match the documented schema",
    };
  }
  return { ok: true, value: { settledMicroUsd } };
}
