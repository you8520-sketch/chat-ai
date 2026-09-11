import {
  CHEAPER_INFERENCE_BASE_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { toMicroUsd } from "@/lib/providerCostLedger";

/**
 * CheaperInference usage/spend client (usage:read scope).
 * Uses the existing server-side credential owner (CHEAPER_INFERENCE_API_KEY);
 * never introduces a new secret. Decimals are validated as strings and
 * normalized to integer micro-USD so reconciliation never drifts on floats.
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
  fetchImpl: UsageFetcher
): Promise<FetchOutcome> {
  let key: string;
  try {
    key = resolveCheaperInferenceApiKey();
  } catch {
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
  fetchImpl?: UsageFetcher;
}): Promise<UsageClientResult<{ requests: CheaperInferenceUsageRequest[]; nextCursor: string | null }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    start_at: opts.startAt,
    end_at: opts.endAt,
    limit: String(clampLimit(opts.limit)),
  });
  if (opts.cursor) params.set("cursor", opts.cursor);
  const outcome = await requestJson(`${CI_USAGE_REQUESTS_URL}?${params.toString()}`, fetchImpl);
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
