import { createHash } from "node:crypto";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import { estimateTokens } from "@/lib/tokenEstimate";

let lastCacheableFingerprint: string | null = null;
let consecutiveStableCacheHits = 0;
let lastLoggedSystemTokens: number | null = null;

function fingerprintCacheablePrefix(split: OpenRouterSystemSplit): string {
  const payload = `${split.systemRulesBlock}\n---\n${split.characterSettingsBlock}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** OpenRouter prompt cache — 연속 턴 cache_read > 0 추적 (Block 1+2 fingerprint, all providers) */
export function logOpenRouterCacheStabilityCheck(opts: {
  split: OpenRouterSystemSplit;
  cacheReadTokens: number;
  systemPrompt: string;
}): number {
  const fingerprint = fingerprintCacheablePrefix(opts.split);
  const systemTokens = estimateTokens(opts.systemPrompt);

  if (opts.cacheReadTokens > 0 && fingerprint === lastCacheableFingerprint) {
    consecutiveStableCacheHits += 1;
  } else if (opts.cacheReadTokens > 0) {
    consecutiveStableCacheHits = 1;
    lastCacheableFingerprint = fingerprint;
  } else {
    consecutiveStableCacheHits = 0;
  }

  const tokenDelta =
    lastLoggedSystemTokens != null ? systemTokens - lastLoggedSystemTokens : null;
  lastLoggedSystemTokens = systemTokens;

  console.log("[cache-stability-check]", {
    consecutive_turns_stable: consecutiveStableCacheHits,
    cache_read_tokens: opts.cacheReadTokens,
    cacheable_fingerprint: fingerprint,
    system_prompt_tokens: systemTokens,
    system_prompt_token_delta: tokenDelta,
    cache_rules_tokens: estimateTokens(opts.split.systemRulesBlock),
    character_settings_tokens: estimateTokens(opts.split.characterSettingsBlock),
    dynamic_block_tokens: estimateTokens(opts.split.dynamicBlock),
  });

  return consecutiveStableCacheHits;
}

/** 테스트용 — 모듈 상태 초기화 */
export function resetOpenRouterCacheStabilityStateForTests(): void {
  lastCacheableFingerprint = null;
  consecutiveStableCacheHits = 0;
  lastLoggedSystemTokens = null;
}
