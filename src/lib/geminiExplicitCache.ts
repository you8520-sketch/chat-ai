import { GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD } from "@/lib/contextTrack";
import { geminiCachedContentsUrl } from "@/lib/geminiApiUrl";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  buildStableSessionPadding,
} from "@/lib/geminiCacheBulk";
import {
  estimatePayloadFromBody,
  isMockApiMode,
  MOCK_INPUT_TOKENS,
  recordMockApiPayload,
} from "@/lib/mockApiMode";

/** Explicit CachedContent — Google 최소 토큰 (gemini-3.1-pro 등) */
export const GEMINI_EXPLICIT_CACHE_MIN_TOKENS = GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD;

/** 생성 목표 (최소 + 여유) — gap padding fallback only */
export const GEMINI_EXPLICIT_CACHE_TARGET_TOKENS = 33_000;

const DEFAULT_TTL_SECONDS = Number(process.env.GEMINI_EXPLICIT_CACHE_TTL_SECONDS) || 86_400;

/** 캐시 스키마 변경 시 bump — volatile→dynamic 분리 v4 */
const EXPLICIT_CACHE_SCHEMA_VERSION = 4;

const STATIC_CONTEXT_HEADER =
  "[STATIC SESSION CONTEXT — read-only. Do NOT reference, quote, or roleplay this block in output.]\n\n";

export type ExplicitCacheEntry = {
  name: string;
  modelId: string;
  chatId: number;
  estimatedPaddingTokens: number;
  staticFingerprint: string;
  createdAt: number;
  expireAt: number;
};

export type GeminiRequestCacheContext = {
  mode: "none" | "explicit";
  cachedContentName?: string;
  estimatedPaddingTokens: number;
};

export type ExplicitCacheCreateOpts = {
  apiKey: string;
  modelId: string;
  chatId: number;
  staticPrompt: string;
  staticFingerprint: string;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
};

type CachedContentApiResponse = {
  name?: string;
  expireTime?: string;
  usageMetadata?: { totalTokenCount?: number };
  error?: { message?: string };
};

const sessionCache = new Map<string, ExplicitCacheEntry>();
const createInflight = new Map<string, Promise<ExplicitCacheEntry | null>>();

export type ExplicitCacheConversationStats = {
  chatId: number;
  createCount: number;
  hitCount: number;
  missCount: number;
  fingerprintMismatchCount: number;
  expiredCount: number;
  lastFingerprint?: string;
  lastCacheId?: string;
  lastStaticTokens?: number;
  lastMissReason?: string;
};

const conversationStats = new Map<number, ExplicitCacheConversationStats>();

function getConversationStats(chatId: number): ExplicitCacheConversationStats {
  let stats = conversationStats.get(chatId);
  if (!stats) {
    stats = {
      chatId,
      createCount: 0,
      hitCount: 0,
      missCount: 0,
      fingerprintMismatchCount: 0,
      expiredCount: 0,
    };
    conversationStats.set(chatId, stats);
  }
  return stats;
}

export function getExplicitCacheConversationStats(chatId: number): ExplicitCacheConversationStats {
  return { ...getConversationStats(chatId) };
}

export function resetExplicitCacheConversationStats(chatId?: number): void {
  if (chatId == null) {
    conversationStats.clear();
    return;
  }
  conversationStats.delete(chatId);
}

type CacheLookupResult =
  | { kind: "hit"; entry: ExplicitCacheEntry }
  | { kind: "miss"; reason: "no_entry" | "expired" | "fingerprint_mismatch" };

function lookupCacheEntry(
  chatId: number,
  modelId: string,
  fingerprint?: string
): CacheLookupResult {
  const key = cacheKey(chatId, modelId);
  const entry = sessionCache.get(key);
  if (!entry) {
    return { kind: "miss", reason: "no_entry" };
  }
  if (entry.expireAt <= Date.now()) {
    sessionCache.delete(key);
    getConversationStats(chatId).expiredCount++;
    return { kind: "miss", reason: "expired" };
  }
  if (fingerprint && entry.staticFingerprint !== fingerprint) {
    getConversationStats(chatId).fingerprintMismatchCount++;
    console.warn("[gemini-explicit-cache] MISS fingerprint_mismatch", {
      chatId,
      modelId,
      cacheId: entry.name,
      wasFingerprint: entry.staticFingerprint,
      nowFingerprint: fingerprint,
      stats: getExplicitCacheConversationStats(chatId),
    });
    invalidateExplicitCache(chatId, modelId);
    return { kind: "miss", reason: "fingerprint_mismatch" };
  }
  return { kind: "hit", entry };
}

function logCacheHit(chatId: number, modelId: string, entry: ExplicitCacheEntry, context: string): void {
  const stats = getConversationStats(chatId);
  stats.hitCount++;
  stats.lastFingerprint = entry.staticFingerprint;
  stats.lastCacheId = entry.name;
  stats.lastStaticTokens = entry.estimatedPaddingTokens;
  console.log("[gemini-explicit-cache] HIT", {
    context,
    chatId,
    modelId,
    cacheId: entry.name,
    fingerprint: entry.staticFingerprint,
    staticTokens: entry.estimatedPaddingTokens,
    createCount: stats.createCount,
    hitCount: stats.hitCount,
    missCount: stats.missCount,
  });
}

function logCacheMiss(
  chatId: number,
  modelId: string,
  reason: "no_entry" | "expired" | "fingerprint_mismatch",
  fingerprint?: string,
  context?: string
): void {
  const stats = getConversationStats(chatId);
  stats.missCount++;
  stats.lastMissReason = reason;
  if (fingerprint) stats.lastFingerprint = fingerprint;
  console.warn("[gemini-explicit-cache] MISS", {
    context: context ?? "lookup",
    chatId,
    modelId,
    reason,
    fingerprint,
    createCount: stats.createCount,
    hitCount: stats.hitCount,
    missCount: stats.missCount,
    fingerprintMismatchCount: stats.fingerprintMismatchCount,
  });
}

function logCacheCreate(chatId: number, modelId: string, entry: ExplicitCacheEntry): void {
  const stats = getConversationStats(chatId);
  stats.createCount++;
  stats.lastFingerprint = entry.staticFingerprint;
  stats.lastCacheId = entry.name;
  stats.lastStaticTokens = entry.estimatedPaddingTokens;
  console.log("[gemini-explicit-cache] CREATE", {
    chatId,
    modelId,
    cacheId: entry.name,
    fingerprint: entry.staticFingerprint,
    staticTokens: entry.estimatedPaddingTokens,
    createCount: stats.createCount,
    hitCount: stats.hitCount,
    missCount: stats.missCount,
    warning:
      stats.createCount > 1
        ? "Multiple cachedContents creates for this conversation — check fingerprint stability"
        : undefined,
  });
}

function cacheKey(chatId: number, modelId: string): string {
  return `${chatId}:${modelId}:v${EXPLICIT_CACHE_SCHEMA_VERSION}`;
}

/** 400 system_instruction 충돌 등 — 세션 캐시 무효화 */
export function invalidateExplicitCache(chatId: number, modelId: string, reason = "manual"): void {
  const had = sessionCache.has(cacheKey(chatId, modelId));
  sessionCache.delete(cacheKey(chatId, modelId));
  createInflight.delete(cacheKey(chatId, modelId));
  if (had) {
    console.warn("[gemini-explicit-cache] INVALIDATE", {
      chatId,
      modelId,
      reason,
      stats: getExplicitCacheConversationStats(chatId),
    });
  }
}

export function isGeminiExplicitCacheEnabled(): boolean {
  if (isGeminiIsolationMode()) return false;
  return process.env.GEMINI_EXPLICIT_CACHE !== "0";
}

/** Gemini 3.x Flash (not Pro) — thinking·로깅 분기용 */
export function isGemini3FlashModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /3-flash|3\.0-flash|3\.5-flash|gemini-3/i.test(id) && !/pro/i.test(id);
}

export function isGeminiExplicitCacheEnabledForModel(_modelId: string): boolean {
  return isGeminiExplicitCacheEnabled();
}

function toApiModelName(modelId: string): string {
  return modelId.startsWith("models/") ? modelId : `models/${modelId}`;
}

function parseExpireMs(expireTime?: string, ttlSeconds = DEFAULT_TTL_SECONDS): number {
  if (expireTime) {
    const ms = Date.parse(expireTime);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now() + ttlSeconds * 1000;
}

function getValidEntry(chatId: number, modelId: string, fingerprint?: string): ExplicitCacheEntry | null {
  const result = lookupCacheEntry(chatId, modelId, fingerprint);
  if (result.kind === "hit") return result.entry;
  return null;
}

async function createCachedContentOnGoogle(opts: ExplicitCacheCreateOpts): Promise<ExplicitCacheEntry | null> {
  const staticBody = `${STATIC_CONTEXT_HEADER}${opts.staticPrompt.trim()}`;
  const url = geminiCachedContentsUrl(opts.apiKey);
  const body = {
    model: toApiModelName(opts.modelId),
    displayName: `chat-${opts.chatId}-static-v${EXPLICIT_CACHE_SCHEMA_VERSION}-${opts.modelId}`,
    ttl: `${DEFAULT_TTL_SECONDS}s`,
    contents: [
      {
        role: "user",
        parts: [{ text: staticBody }],
      },
    ],
  };

  if (isMockApiMode()) {
    const { chars, tokens } = estimatePayloadFromBody(body);
    recordMockApiPayload({
      provider: "gemini-cache",
      requestKind: "cachedContents-create",
      model: opts.modelId,
      payloadChars: chars,
      payloadTokens: tokens,
      historyMessages: 1,
      payload: body,
    });
    const name = `cachedContents/mock-${opts.chatId}-${opts.modelId.replace(/\//g, "-")}`;
    if (opts.turnTrace) {
      opts.turnTrace.endRequest(
        opts.turnTrace.startRequest({
          phase: "cache-create",
          requestKind: "cachedContents-create",
          model: opts.modelId,
          body: body as Record<string, unknown>,
        }),
        { promptTokenCount: tokens, cachedContentTokenCount: tokens }
      );
    }
    return {
      name,
      modelId: opts.modelId,
      chatId: opts.chatId,
      estimatedPaddingTokens: tokens,
      staticFingerprint: opts.staticFingerprint,
      createdAt: Date.now(),
      expireAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
    };
  }

  const cacheTraceId = opts.turnTrace?.startRequest({
    phase: "cache-create",
    requestKind: "cachedContents-create",
    model: opts.modelId,
    body: body as Record<string, unknown>,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (cacheTraceId) opts.turnTrace?.endRequest(cacheTraceId, undefined, e);
    throw e;
  }

  const data = (await res.json()) as CachedContentApiResponse;
  if (!res.ok) {
    const msg = data.error?.message ?? JSON.stringify(data);
    if (cacheTraceId) opts.turnTrace?.endRequest(cacheTraceId, undefined, new Error(msg));
    console.warn("[gemini-explicit-cache] create failed", {
      status: res.status,
      modelId: opts.modelId,
      chatId: opts.chatId,
      staticTokens: estimateTokens(staticBody),
      message: msg,
    });
    return null;
  }

  const name = data.name;
  if (!name) {
    console.warn("[gemini-explicit-cache] create response missing name", data);
    return null;
  }

  const estimatedPaddingTokens =
    data.usageMetadata?.totalTokenCount ?? estimateTokens(staticBody);

  const entry: ExplicitCacheEntry = {
    name,
    modelId: opts.modelId,
    chatId: opts.chatId,
    estimatedPaddingTokens,
    staticFingerprint: opts.staticFingerprint,
    createdAt: Date.now(),
    expireAt: parseExpireMs(data.expireTime),
  };

  console.log("[gemini-explicit-cache] created (static context)", {
    name,
    chatId: opts.chatId,
    modelId: opts.modelId,
    estimatedStaticTokens: estimatedPaddingTokens,
    fingerprint: opts.staticFingerprint,
    expireAt: new Date(entry.expireAt).toISOString(),
  });

  logCacheCreate(opts.chatId, opts.modelId, entry);

  if (cacheTraceId) {
    opts.turnTrace?.endRequest(cacheTraceId, {
      promptTokenCount: estimatedPaddingTokens,
      cachedContentTokenCount: estimatedPaddingTokens,
    });
  }

  return entry;
}

/** chat+model+fingerprint 단위 CachedContent — static context 1회 생성 후 세션 재사용 */
export async function getOrCreateExplicitCache(
  chatId: number | undefined,
  modelId: string,
  apiKey: string,
  staticOpts?: { staticPrompt: string; staticFingerprint: string },
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<ExplicitCacheEntry | null> {
  if (!isGeminiExplicitCacheEnabledForModel(modelId) || chatId == null || chatId <= 0) return null;

  const fingerprint = staticOpts?.staticFingerprint;
  const lookup = lookupCacheEntry(chatId, modelId, fingerprint);
  if (lookup.kind === "hit") {
    logCacheHit(chatId, modelId, lookup.entry, "getOrCreateExplicitCache");
    return lookup.entry;
  }
  logCacheMiss(chatId, modelId, lookup.reason, fingerprint, "getOrCreateExplicitCache");

  if (!staticOpts?.staticPrompt?.trim()) {
    console.warn("[gemini-explicit-cache] skip create — no static prompt", { chatId, modelId });
    return null;
  }

  const key = cacheKey(chatId, modelId);
  const inflight = createInflight.get(key);
  if (inflight) return inflight;

  const promise = createCachedContentOnGoogle({
    apiKey,
    modelId,
    chatId,
    staticPrompt: staticOpts.staticPrompt,
    staticFingerprint: staticOpts.staticFingerprint,
    turnTrace,
  })
    .then((entry) => {
      if (entry) sessionCache.set(key, entry);
      return entry;
    })
    .finally(() => {
      createInflight.delete(key);
    });

  createInflight.set(key, promise);
  return promise;
}

/** 백그라운드 CachedContent 워밍 */
export function warmExplicitCacheInBackground(
  chatId: number,
  modelId: string,
  apiKey: string,
  staticOpts?: { staticPrompt: string; staticFingerprint: string }
): void {
  void getOrCreateExplicitCache(chatId, modelId, apiKey, staticOpts);
}

/** generateContent/streamGenerateContent용 캐시 컨텍스트 */
export function resolveGeminiRequestCache(opts: {
  chatId?: number;
  modelId: string;
  apiKey: string;
  staticOpts?: { staticPrompt: string; staticFingerprint: string };
}): GeminiRequestCacheContext {
  if (
    !isGeminiExplicitCacheEnabledForModel(opts.modelId) ||
    opts.chatId == null ||
    opts.chatId <= 0
  ) {
    return { mode: "none", estimatedPaddingTokens: 0 };
  }

  const lookup = lookupCacheEntry(opts.chatId, opts.modelId, opts.staticOpts?.staticFingerprint);
  if (lookup.kind === "hit") {
    logCacheHit(opts.chatId, opts.modelId, lookup.entry, "resolveGeminiRequestCache");
    return {
      mode: "explicit",
      cachedContentName: lookup.entry.name,
      estimatedPaddingTokens: lookup.entry.estimatedPaddingTokens,
    };
  }
  logCacheMiss(
    opts.chatId,
    opts.modelId,
    lookup.reason,
    opts.staticOpts?.staticFingerprint,
    "resolveGeminiRequestCache"
  );

  if (opts.staticOpts?.staticPrompt?.trim()) {
    warmExplicitCacheInBackground(opts.chatId, opts.modelId, opts.apiKey, opts.staticOpts);
  }
  return { mode: "none", estimatedPaddingTokens: 0 };
}

/** @deprecated lorem-only retry — static gap padding은 finalizeGeminiStaticCache에서 처리 */
export { buildStableSessionPadding };
