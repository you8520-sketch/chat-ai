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
/** One window slice fails closed at this page count. It is not a complete history. */
export const CI_USAGE_PAGE_CAP = 50;
/** All slices of one covering read, including slices discarded because they still had a cursor. */
export const CI_USAGE_COVER_PAGE_BUDGET = 400;
export const CI_USAGE_COVER_BUDGET_MS = 120_000;

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

/** null cursor ends the slice. A present but unusable cursor is malformed, not the last page. */
function extractNextCursor(payload: unknown): { cursor: string | null } | null {
  if (!payload || typeof payload !== "object") return { cursor: null };
  const obj = payload as Record<string, unknown>;
  const cursor = obj.next_cursor ?? obj.nextCursor;
  if (cursor == null) return { cursor: null };
  if (typeof cursor !== "string") return null;
  const trimmed = cursor.trim();
  if (!trimmed) return null;
  return { cursor: trimmed };
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
    });
  }
  const nextCursor = extractNextCursor(payload);
  if (!nextCursor) return null;
  return { requests, nextCursor: nextCursor.cursor };
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
  apiKey?: string,
  timeoutMs = 15_000
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
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
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
  fetchImpl?: UsageFetcher;
  /** Explicit usage:read credential. Production default still uses resolveCheaperInferenceApiKey(). */
  apiKey?: string;
  timeoutMs?: number;
}): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; nextCursor: string | null }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    start_at: opts.startAt,
    end_at: opts.endAt,
    limit: String(clampLimit(opts.limit)),
  });
  if (opts.cursor) params.set("cursor", opts.cursor);
  const outcome = await requestJson(
    `${CI_USAGE_REQUESTS_URL}?${params.toString()}`,
    fetchImpl,
    opts.apiKey,
    opts.timeoutMs
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

type UsageWindowOpts = {
  startAt: string;
  endAt: string;
  limit?: number;
  fetchImpl?: UsageFetcher;
  apiKey?: string;
  now?: () => number;
  deadlineMs?: number;
};

/** All pages in one half-open window. Cursor is never interpreted, only forwarded.
 * A safety cap that is hit while a cursor remains is NOT a complete history. */
async function walkUsageRequestPages(
  opts: UsageWindowOpts & { maxPages: number }
): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; pages: number }>> {
  const maxPages = Math.max(1, Math.floor(opts.maxPages));
  const requests: CheaperInferenceUsageRequest[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  const now = opts.now ?? Date.now;
  do {
    const at = now();
    if (opts.deadlineMs != null && at >= opts.deadlineMs) {
      return {
        ok: false,
        reason: "incomplete",
        message: "usage requests window coverage exceeded the request or time budget",
      };
    }
    if (cursor) {
      if (seenCursors.has(cursor)) {
        return {
          ok: false,
          reason: "schema",
          message: "usage requests cursor repeated",
        };
      }
      seenCursors.add(cursor);
    }
    const timeoutMs =
      opts.deadlineMs == null ? 15_000 : Math.min(15_000, Math.max(1, opts.deadlineMs - at));
    const page = await fetchUsageRequestsPage({
      startAt: opts.startAt,
      endAt: opts.endAt,
      limit: opts.limit,
      cursor,
      fetchImpl: opts.fetchImpl,
      apiKey: opts.apiKey,
      timeoutMs,
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

function addUniqueUsageRequests(
  seenIds: Set<string>,
  dest: CheaperInferenceUsageRequest[],
  rows: readonly CheaperInferenceUsageRequest[]
): void {
  for (const row of rows) {
    if (seenIds.has(row.requestId)) continue;
    seenIds.add(row.requestId);
    dest.push(row);
  }
}

type UsageCoverState = {
  pages: number;
  deadlineMs: number;
  requests: CheaperInferenceUsageRequest[];
  seenIds: Set<string>;
};

function isPageCapIncomplete(
  result: UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; pages: number }>
): boolean {
  return !result.ok && result.reason === "incomplete" && result.message.includes("safety cap");
}

function usageWindowMidpoint(startAt: string, endAt: string): string | null {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < 2) return null;
  const midMs = startMs + Math.floor((endMs - startMs) / 2);
  if (midMs <= startMs || midMs >= endMs) return null;
  return new Date(midMs).toISOString();
}

/** Read [startAt, endAt) by splitting only slices that still have a cursor after the page cap. */
async function coverUsageRequestWindow(
  opts: UsageWindowOpts,
  state: UsageCoverState,
  startAt: string,
  endAt: string
): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; pages: number }>> {
  const now = opts.now ?? Date.now;
  if (state.pages >= CI_USAGE_COVER_PAGE_BUDGET || now() >= state.deadlineMs) {
    return {
      ok: false,
      reason: "incomplete",
      message: "usage requests window coverage exceeded the request or time budget",
    };
  }
  const sliceCap = Math.min(CI_USAGE_PAGE_CAP, CI_USAGE_COVER_PAGE_BUDGET - state.pages);
  const walked = await walkUsageRequestPages({
    ...opts,
    startAt,
    endAt,
    maxPages: sliceCap,
    deadlineMs: state.deadlineMs,
  });
  if (!walked.ok && !isPageCapIncomplete(walked)) return walked;
  if (walked.ok) {
    state.pages += walked.value.pages;
    addUniqueUsageRequests(state.seenIds, state.requests, walked.value.requests);
    return { ok: true, value: { requests: state.requests, pages: state.pages } };
  }
  state.pages += sliceCap;
  const mid = usageWindowMidpoint(startAt, endAt);
  if (!mid) {
    return {
      ok: false,
      reason: "incomplete",
      message: "usage requests pagination cannot split the remaining window",
    };
  }
  const left = await coverUsageRequestWindow(opts, state, startAt, mid);
  if (!left.ok) return left;
  return coverUsageRequestWindow(opts, state, mid, endAt);
}

/** All pages in [startAt, endAt).
 * An explicit maxPages keeps the single-slice cap and does not split the window.
 * The monthly caller omits maxPages: a slice that still has a cursor is bisected
 * until every half-open piece is read, or the whole read fails closed.
 * incomplete is never returned as ok. */
export async function fetchAllUsageRequests(opts: UsageWindowOpts & {
  maxPages?: number;
}): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; pages: number }>> {
  if (opts.maxPages != null) {
    return walkUsageRequestPages({ ...opts, maxPages: opts.maxPages });
  }
  const now = opts.now ?? Date.now;
  const startedMs = now();
  const state: UsageCoverState = {
    pages: 0,
    deadlineMs: startedMs + CI_USAGE_COVER_BUDGET_MS,
    requests: [],
    seenIds: new Set(),
  };
  const covered = await coverUsageRequestWindow(opts, state, opts.startAt, opts.endAt);
  if (!covered.ok) return covered;
  return { ok: true, value: { requests: state.requests, pages: state.pages } };
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
