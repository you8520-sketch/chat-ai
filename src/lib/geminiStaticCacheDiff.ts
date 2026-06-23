import { createHash } from "node:crypto";

import { estimateTokens } from "@/lib/tokenEstimate";
import { isGeminiStaticCacheSectionId } from "@/lib/geminiStaticDynamicContext";
import type { TrackedPromptSection } from "@/services/promptAudit";

type StaticSectionSnapshot = {
  id: string;
  fingerprint: string;
  tokens: number;
  chars: number;
};

type TurnStaticSnapshot = {
  sections: Map<string, StaticSectionSnapshot>;
  staticTokens: number;
  staticFingerprint: string;
};

const previousByChatId = new Map<number, TurnStaticSnapshot>();

function sectionFingerprint(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 8);
}

function buildStaticSectionSnapshots(
  sections: TrackedPromptSection[]
): Map<string, StaticSectionSnapshot> {
  const snapshots = new Map<string, StaticSectionSnapshot>();
  for (const s of sections) {
    if (!isGeminiStaticCacheSectionId(s.id)) continue;
    const text = s.text.trim();
    snapshots.set(s.id, {
      id: s.id,
      fingerprint: sectionFingerprint(text),
      tokens: estimateTokens(text),
      chars: text.length,
    });
  }
  return snapshots;
}

export function logGeminiStaticChunkDiff(opts: {
  chatId?: number;
  sections: TrackedPromptSection[];
  staticFingerprint: string;
  staticTokens: number;
}): void {
  if (process.env.GEMINI_STATIC_DIFF_LOG !== "1") return;

  const chatId = opts.chatId ?? 0;
  const currSections = buildStaticSectionSnapshots(opts.sections);
  const curr: TurnStaticSnapshot = {
    sections: currSections,
    staticTokens: opts.staticTokens,
    staticFingerprint: opts.staticFingerprint,
  };

  const prev = previousByChatId.get(chatId);
  previousByChatId.set(chatId, curr);

  if (!prev) {
    console.log("[gemini-static-diff] first_turn", {
      chatId,
      staticTokens: curr.staticTokens,
      staticFingerprint: curr.staticFingerprint,
      sections: [...currSections.values()].map((s) => ({
        id: s.id,
        fingerprint: s.fingerprint,
        tokens: s.tokens,
        chars: s.chars,
      })),
    });
    return;
  }

  const changed: Array<{
    id: string;
    prevTokens: number;
    currTokens: number;
    tokenDelta: number;
    prevFp: string;
    currFp: string;
  }> = [];
  const added: string[] = [];
  const removed: string[] = [];
  let unchangedCount = 0;

  for (const [id, currSnap] of currSections) {
    const prevSnap = prev.sections.get(id);
    if (!prevSnap) {
      added.push(id);
      continue;
    }
    if (prevSnap.fingerprint === currSnap.fingerprint && prevSnap.tokens === currSnap.tokens) {
      unchangedCount++;
      continue;
    }
    changed.push({
      id,
      prevTokens: prevSnap.tokens,
      currTokens: currSnap.tokens,
      tokenDelta: currSnap.tokens - prevSnap.tokens,
      prevFp: prevSnap.fingerprint,
      currFp: currSnap.fingerprint,
    });
  }

  for (const id of prev.sections.keys()) {
    if (!currSections.has(id)) removed.push(id);
  }

  console.log("[gemini-static-diff] turn_delta", {
    chatId,
    prevStaticTokens: prev.staticTokens,
    currStaticTokens: curr.staticTokens,
    tokenDelta: curr.staticTokens - prev.staticTokens,
    prevStaticFingerprint: prev.staticFingerprint,
    currStaticFingerprint: curr.staticFingerprint,
    changed,
    added,
    removed,
    unchangedCount,
  });
}
