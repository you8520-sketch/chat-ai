/**
 * Canonical server-only GitHub reader for admin automation reports.
 * Does not rerun workflows, write ledgers, or expose credentials.
 */
export const GITHUB_REPORT_USER_AGENT = "chat-ai-admin-automation-reports";
export const GITHUB_REPORT_CACHE_TTL_MS = 30_000;
export const GITHUB_REPORT_NEGATIVE_TTL_MS = 5_000;
export const GITHUB_REPORT_MAX_WAIT_MS = 1_500;

export type GithubReportErrorKind =
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "UNAVAILABLE";

export type GithubReportKind = GithubReportErrorKind | "OK";

export type GithubReportResult<T> = {
  ok: boolean;
  status: number;
  json: T | null;
  kind: GithubReportKind;
  error: string | null;
  requestId: string | null;
  retryAt: string | null;
  remaining: number | null;
};

export type GithubReportContentResult = {
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  raw: string | null;
};

type CacheEntry = {
  expiresAtMs: number;
  result: GithubReportResult<unknown>;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GithubReportResult<unknown>>>();

export function resetGithubReportClientForTests(): void {
  cache.clear();
  inflight.clear();
}

export function resolveGithubReportsToken(explicit?: string): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.GITHUB_REPORTS_TOKEN?.trim();
  return fromEnv || undefined;
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function parseRemaining(headers: Record<string, string>): number | null {
  const raw = headers["x-ratelimit-remaining"];
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRetryAfterMs(
  headers: Record<string, string>,
  nowMs: number
): number | null {
  const raw = headers["retry-after"];
  if (raw == null || raw === "") return null;
  const retryAfter = Number(raw);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return nowMs + retryAfter * 1000;
  }
  return null;
}

function parseRateLimitResetMs(headers: Record<string, string>): number | null {
  const reset = Number(headers["x-ratelimit-reset"] ?? "");
  if (Number.isFinite(reset) && reset > 0) {
    return reset * 1000;
  }
  return null;
}

function messageLooksLikeRateLimit(message: string): boolean {
  return /rate limit/i.test(message) || /exceeded a secondary rate limit/i.test(message);
}

export function classifyGithubReportResponse(input: {
  status: number;
  remaining: number | null;
  hasRetryAfter: boolean;
  message: string;
}): GithubReportKind {
  if (input.status === 404) return "NOT_FOUND";
  if (input.status >= 200 && input.status < 300) return "OK";
  if (input.status === 401) return "AUTH_REQUIRED";
  if (input.status === 429) return "RATE_LIMITED";
  if (input.status === 403) {
    if (
      input.remaining === 0 ||
      input.hasRetryAfter ||
      messageLooksLikeRateLimit(input.message)
    ) {
      return "RATE_LIMITED";
    }
    return "PERMISSION_DENIED";
  }
  return "UNAVAILABLE";
}

export function formatGithubReportError(
  label: string,
  result: Pick<GithubReportResult<unknown>, "status" | "kind" | "retryAt" | "requestId">
): string {
  const parts = [label, String(result.status)];
  if (result.kind !== "OK" && result.kind !== "UNAVAILABLE") parts.push(result.kind);
  if (result.retryAt) parts.push(`reset=${result.retryAt}`);
  if (result.requestId) parts.push(`request=${result.requestId}`);
  return parts.join(" ");
}

function cacheKey(url: string, authorized: boolean): string {
  return `${authorized ? "auth" : "anon"}:${url}`;
}

function cacheTtlMs(kind: GithubReportKind, retryAtMs: number | null, nowMs: number): number {
  if (kind === "OK" || kind === "NOT_FOUND") return GITHUB_REPORT_CACHE_TTL_MS;
  if (kind === "RATE_LIMITED") {
    if (retryAtMs == null) return GITHUB_REPORT_NEGATIVE_TTL_MS;
    return Math.max(
      GITHUB_REPORT_NEGATIVE_TTL_MS,
      Math.min(GITHUB_REPORT_CACHE_TTL_MS, retryAtMs - nowMs)
    );
  }
  return GITHUB_REPORT_NEGATIVE_TTL_MS;
}

function retryAtMsForKind(
  kind: GithubReportKind,
  retryAfterMs: number | null,
  resetMs: number | null
): number | null {
  if (retryAfterMs != null) return retryAfterMs;
  if (kind === "RATE_LIMITED") return resetMs;
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function bodyMessage(json: unknown): string {
  if (json && typeof json === "object" && "message" in json && typeof json.message === "string") {
    return json.message;
  }
  return "";
}

export function decodeGithubReportContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const content =
    "content" in body && typeof body.content === "string" ? body.content : "";
  if (!content) return null;
  try {
    return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export type GithubReportGetOpts = {
  token?: string;
  label?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cache?: boolean;
};

export async function githubReportGetJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
  opts?: GithubReportGetOpts
): Promise<GithubReportResult<T>> {
  const now = opts?.now ?? Date.now;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const token = resolveGithubReportsToken(opts?.token);
  const share = opts?.cache ?? fetchImpl === fetch;
  const key = cacheKey(url, Boolean(token));
  const nowMs = now();
  if (share) {
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.result as GithubReportResult<T>;
    }
    const pending = inflight.get(key);
    if (pending) return pending as Promise<GithubReportResult<T>>;
  }

  const run = (async () => {
    const execute = async (): Promise<GithubReportResult<T>> => {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": GITHUB_REPORT_USER_AGENT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
      });
      const headers = headerMap(response.headers);
      const json = await readJson(response);
      const remaining = parseRemaining(headers);
      const retryAfterMs = parseRetryAfterMs(headers, now());
      const kind = classifyGithubReportResponse({
        status: response.status,
        remaining,
        hasRetryAfter: retryAfterMs != null,
        message: bodyMessage(json),
      });
      const retryAtMs = retryAtMsForKind(kind, retryAfterMs, parseRateLimitResetMs(headers));
      const requestId = headers["x-github-request-id"] ?? null;
      const retryAt = retryAtMs != null ? new Date(retryAtMs).toISOString() : null;
      const result: GithubReportResult<T> = {
        ok: kind === "OK",
        status: response.status,
        json: kind === "OK" ? (json as T) : null,
        kind,
        error:
          kind === "OK"
            ? null
            : formatGithubReportError(opts?.label ?? "GitHub API", {
                status: response.status,
                kind,
                retryAt,
                requestId,
              }),
        requestId,
        retryAt,
        remaining,
      };
      return result;
    };

    try {
      let result = await execute();
      if (result.kind === "RATE_LIMITED" && result.retryAt) {
        const waitMs = Date.parse(result.retryAt) - now();
        if (waitMs > 0 && waitMs <= GITHUB_REPORT_MAX_WAIT_MS) {
          await sleep(waitMs);
          result = await execute();
        }
      }
      if (share) {
        const ttl = cacheTtlMs(result.kind, result.retryAt ? Date.parse(result.retryAt) : null, now());
        cache.set(key, { expiresAtMs: now() + ttl, result });
      }
      return result;
    } catch (error) {
      const result: GithubReportResult<T> = {
        ok: false,
        status: 0,
        json: null,
        kind: "UNAVAILABLE",
        error: error instanceof Error ? error.message : "GitHub API unavailable",
        requestId: null,
        retryAt: null,
        remaining: null,
      };
      if (share) {
        cache.set(key, { expiresAtMs: now() + GITHUB_REPORT_NEGATIVE_TTL_MS, result });
      }
      return result;
    } finally {
      if (share) inflight.delete(key);
    }
  })();

  if (share) inflight.set(key, run as Promise<GithubReportResult<unknown>>);
  return run;
}

export async function githubReportGetContent(
  url: string,
  fetchImpl: typeof fetch = fetch,
  opts?: GithubReportGetOpts
): Promise<GithubReportContentResult> {
  const result = await githubReportGetJson<unknown>(url, fetchImpl, {
    ...opts,
    label: opts?.label ?? "GitHub Contents API",
  });
  if (result.kind === "NOT_FOUND") {
    return { status: "EMPTY", error: null, raw: null };
  }
  if (!result.ok) {
    return { status: "UNAVAILABLE", error: result.error, raw: null };
  }
  const raw = decodeGithubReportContent(result.json);
  return raw
    ? { status: "OK", error: null, raw }
    : { status: "EMPTY", error: null, raw: null };
}
