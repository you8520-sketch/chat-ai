import { createHash } from "node:crypto";

import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { ChatMsg } from "@/lib/ai";
import {
  GEMINI_STATIC_CACHE_MAX_TOKENS,
  GEMINI_STATIC_CACHE_MIN_TOKENS,
} from "@/lib/contextTrack";
import { buildStableSessionPadding } from "@/lib/geminiCacheBulk";
import { isGeminiExplicitCacheEnabled } from "@/lib/geminiExplicitCache";
import type { GeminiContextSplit } from "@/types";
import type { TrackedPromptSection } from "@/services/promptAudit";

/** Explicit cache에 고정 — 턴마다 변하는 memory/relationship/history는 제외 (fingerprint 안정).
 * MEMORY_FEATURE_ENABLED=0 이면 contextBuilder가 volatile 섹션을 주입하지 않음. */
const STATIC_SECTION_IDS = new Set([
  "identity-and-rules",
  "user-persona-speech-guard",
  "rule-core-master",
  "nsfw-adult-style-reference",
]);

/** 턴/설정 변경 시 dynamic으로만 주입 (캐시 fingerprint에서 제외) */
const VOLATILE_SECTION_IDS = new Set([
  "current-memory",
  "relationship-meta",
  "user-note-reference",
  "contextual-lore-rag",
]);

export function isVolatilePromptSectionId(id: string): boolean {
  return VOLATILE_SECTION_IDS.has(id);
}

const STATIC_TRIM_PRIORITY = [
  "user-note-reference",
  "contextual-lore-rag",
] as const;

export function isGeminiStaticCacheSectionId(id: string): boolean {
  if (VOLATILE_SECTION_IDS.has(id)) return false;
  if (STATIC_SECTION_IDS.has(id)) return true;
  return id.startsWith("chunk-critical-") || id.startsWith("chunk-lore-");
}

function isStaticSectionId(id: string): boolean {
  return isGeminiStaticCacheSectionId(id);
}

function isDynamicSectionId(id: string): boolean {
  if (VOLATILE_SECTION_IDS.has(id)) return true;
  return !isStaticSectionId(id);
}

export function fingerprintStaticPrompt(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/** trackedSections → Static / Dynamic 분리 */
export function assembleGeminiStaticDynamicSplit(opts: {
  sections: TrackedPromptSection[];
  staticHistoryBlock?: string;
  dynamicHistory: ChatMsg[];
  visualAnchorTail?: string;
}): GeminiContextSplit {
  const staticParts: string[] = [];
  const dynamicParts: string[] = [];

  for (const s of opts.sections) {
    if (VOLATILE_SECTION_IDS.has(s.id) && isStaticSectionId(s.id)) {
      console.error("[gemini-static-dynamic] FATAL — volatile section routed to static cache", {
        sectionId: s.id,
      });
    }
    if (isStaticSectionId(s.id)) {
      staticParts.push(s.text);
    } else if (isDynamicSectionId(s.id)) {
      dynamicParts.push(s.text);
    }
  }

  const oldHistory = opts.staticHistoryBlock?.trim();
  if (oldHistory) {
    dynamicParts.push(
      `[6] Stored history summaries (${ROLLING_SUMMARY_INTERVAL}-turn batches, latest 1–15)\n${oldHistory}`
    );
  }

  const visual = opts.visualAnchorTail?.trim();
  const hasVisualSection = opts.sections.some((s) => s.id === "visual-appearance-anchor");
  if (visual && !hasVisualSection) {
    dynamicParts.push(visual);
  }

  const staticPrompt = staticParts.join("\n\n");
  const dynamicSystemTail = dynamicParts.join("\n\n");

  return {
    staticPrompt,
    staticFingerprint: fingerprintStaticPrompt(staticPrompt),
    dynamicSystemTail,
    dynamicHistory: opts.dynamicHistory,
    staticEstimatedTokens: estimateTokens(staticPrompt),
    staticPaddingApplied: false,
  };
}

function truncateStaticPrompt(staticPrompt: string, maxTokens: number): string {
  let text = staticPrompt;
  let tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;

  for (const sectionId of STATIC_TRIM_PRIORITY) {
    const marker =
      sectionId === "user-note-reference"
        ? "[5] User Note"
        : "[1.5] Contextual Lore";
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      text = text.slice(0, idx).trimEnd();
      tokens = estimateTokens(text);
      if (tokens <= maxTokens) return text;
    }
  }

  const maxChars = Math.floor(maxTokens * 3.5);
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** Static 32K~60K 맞춤 + fingerprint — explicit cache 전용 padding */
export function finalizeGeminiStaticCache(
  geminiSplit: GeminiContextSplit,
  options?: { chatId?: number }
): GeminiContextSplit {
  let staticPrompt = geminiSplit.staticPrompt.trim();
  let staticPaddingApplied = false;

  if (isGeminiExplicitCacheEnabled()) {
    let tokens = estimateTokens(staticPrompt);

    if (tokens < GEMINI_STATIC_CACHE_MIN_TOKENS) {
      const targetTokens = GEMINI_STATIC_CACHE_MIN_TOKENS + 512;
      const staticTokensBefore = tokens;
      const gapTokens = Math.max(256, targetTokens - tokens);
      const padding = buildStableSessionPadding(options?.chatId ?? 0, gapTokens);
      staticPrompt = `${staticPrompt}\n\n${padding}`;
      staticPaddingApplied = true;
      tokens = estimateTokens(staticPrompt);
      if (process.env.NODE_ENV !== "production") {
        console.log("[gemini-static-cache] gap padding applied", {
          staticTokensBefore,
          gapTokens,
          staticTokensAfter: tokens,
          targetTokens,
        });
      }
    }

    if (tokens > GEMINI_STATIC_CACHE_MAX_TOKENS) {
      staticPrompt = truncateStaticPrompt(staticPrompt, GEMINI_STATIC_CACHE_MAX_TOKENS);
      tokens = estimateTokens(staticPrompt);
    }

    return {
      ...geminiSplit,
      staticPrompt,
      staticFingerprint: fingerprintStaticPrompt(staticPrompt),
      staticEstimatedTokens: tokens,
      staticPaddingApplied,
    };
  }

  return {
    ...geminiSplit,
    staticEstimatedTokens: estimateTokens(staticPrompt),
    staticPaddingApplied,
  };
}
