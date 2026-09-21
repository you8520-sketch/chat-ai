import type { OpenRouterContentBlock } from "@/lib/openRouterClient";
import { estimateTokens } from "@/lib/tokenEstimate";

/** OpenRouter Anthropic prompt caching — 정적 prefix / 동적 suffix 분리 */
export type OpenRouterSystemSplit = {
  /** 페르소나(1.2k) + 유저노트 고집중(1k) + 코어 RP 규칙 (캐시 breakpoint 1) */
  systemRulesBlock: string;
  /** [2] Character Critical + [6] 로어북 + [1.4] prose + [1.45] handoff (캐시 breakpoint 2) */
  characterSettingsBlock: string;
  /** User Lorebook · memory · tail — 매 턴 변동 (비캐시, breakpoint 2 아래) */
  dynamicBlock: string;
};

export const ANTHROPIC_EPHEMERAL_CACHE = { type: "ephemeral" as const };

/**
 * Legacy history cache tail exclude — diagnostic / test-only.
 * Main RP no longer emits history cache_control (bounded sliding RAW suffix).
 */
export const HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES = 3;

/** OpenRouter Anthropic — 단일 텍스트 → cache_control 블록 배열 */
export function wrapTextAsCachedContentBlock(text: string): OpenRouterContentBlock[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return [
    {
      type: "text",
      text: trimmed,
      cache_control: ANTHROPIC_EPHEMERAL_CACHE,
    },
  ];
}

/**
 * Legacy history cache breakpoint resolver — diagnostic / test-only.
 * Main RP wire no longer applies cache_control at this index (sliding RAW suffix).
 * Kept to prove structural conflict: index resolves on assembled messages but caching it
 * would write a prefix that the next shifted-head turn cannot reuse.
 */
export function resolveHistoryCacheBreakpointIndex(messages: { role: string }[]): number | null {
  if (messages.length < 3) return null;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 2) return null;

  const breakpointIdx = lastUserIdx - HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES;
  if (breakpointIdx < 1) return null;
  return breakpointIdx;
}

/** system 메시지 content 배열 — rules + character에 cache_control 적용 (dynamic은 비캐시) */
export function buildOpenRouterCachedSystemContent(
  split: OpenRouterSystemSplit
): OpenRouterContentBlock[] {
  const out: OpenRouterContentBlock[] = [];

  const rules = split.systemRulesBlock.trim();
  const character = split.characterSettingsBlock.trim();
  const dynamic = split.dynamicBlock.trim();

  if (rules) {
    out.push({
      type: "text",
      text: rules,
      cache_control: ANTHROPIC_EPHEMERAL_CACHE,
    });
  }
  if (character) {
    out.push({
      type: "text",
      text: character,
      cache_control: ANTHROPIC_EPHEMERAL_CACHE,
    });
  }
  if (dynamic) {
    out.push({ type: "text", text: dynamic });
  }

  return out;
}

export function estimateOpenRouterCacheableTokens(split: OpenRouterSystemSplit): number {
  return (
    estimateTokens(split.systemRulesBlock) + estimateTokens(split.characterSettingsBlock)
  );
}

/** On-demand keyword / global lorebook — system cached prefix 아래, 최신 user 직전 */
export function buildOpenRouterDynamicLoreUserPrefix(
  parts: Array<string | null | undefined>
): string {
  return parts.map((p) => p?.trim() ?? "").filter(Boolean).join("\n\n");
}
