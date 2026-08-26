/**
 * Seal-aligned episodic extraction — at most one background call per 5-turn summary batch.
 * Best-effort: failure never rolls back a successful summary seal.
 */
import { callGeminiBackground } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { persistEpisodicMemoryFactsBestEffort } from "@/lib/episodicMemoryFacts";
import { sanitizeExtractedFacts } from "@/lib/statusWidget/extractedFacts";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import type { MemorySourceBoundary } from "./memory-source-boundary";

export const EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH = 1;

type EpisodicExtractLlmCaller = (
  system: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  turnTrace: import("@/lib/geminiRequestTrace").GeminiTurnTrace | undefined,
  requestKind: string
) => Promise<{ text: string }>;

let extractCallerOverride: EpisodicExtractLlmCaller | null = null;
let extractCallCountForTests = 0;

export function __setEpisodicExtractCallerForTests(
  fn: EpisodicExtractLlmCaller | null
): void {
  extractCallerOverride = fn;
}

export function __getEpisodicExtractCallCountForTests(): number {
  return extractCallCountForTests;
}

export function __resetEpisodicExtractCallCountForTests(): void {
  extractCallCountForTests = 0;
}

export function parseEpisodicExtractedFacts(raw: string): ExtractedStatusFact[] {
  const text = raw.trim();
  if (!text) return [];
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as {
      extracted_facts?: unknown;
    };
    return sanitizeExtractedFacts(parsed.extracted_facts, { requireEvidence: true });
  } catch {
    return [];
  }
}

export function buildEpisodicExtractSystemPrompt(): string {
  return `You extract durable episodic facts from a sealed RP summary batch as JSON only. No prose, no markdown fences.

${EPISODIC_FACTS_EXTRACT_INSTRUCTIONS}`;
}

export async function extractEpisodicFactsFromSealedBatch(opts: {
  dialogue: string;
  charName: string;
  startTurn: number;
  endTurn: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<ExtractedStatusFact[]> {
  extractCallCountForTests += 1;
  if (!extractCallerOverride && !process.env.OPENROUTER_API_KEY?.trim()) {
    return [];
  }
  const system = buildEpisodicExtractSystemPrompt();
  const userContent = `[${opts.startTurn}~${opts.endTurn}턴 원본 대화]
${opts.dialogue}

캐릭터: ${opts.charName}
위 배치에서 장기 보존할 사실만 JSON으로 추출한다.`;
  const callLlm: EpisodicExtractLlmCaller =
    extractCallerOverride ??
    ((sys, history, turnTrace, requestKind) =>
      callGeminiBackground(sys, history, turnTrace, requestKind));
  try {
    const { text } = await callLlm(
      system,
      [{ role: "user", content: userContent }],
      opts.turnTrace,
      "background-episodic-extract"
    );
    return parseEpisodicExtractedFacts(text);
  } catch (e) {
    console.warn("[memory] episodic seal extract LLM failed (best-effort)", {
      start: opts.startTurn,
      end: opts.endTurn,
      error: (e as Error).message?.slice(0, 200) ?? "unknown",
    });
    return [];
  }
}

export async function extractAndPersistEpisodicFactsForSealedBatch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  startTurn: number;
  endTurn: number;
  dialogue: string;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<{ extracted: number; persisted: number; calls: number }> {
  if (!isMemoryFeatureEnabled()) {
    return { extracted: 0, persisted: 0, calls: 0 };
  }
  const facts = await extractEpisodicFactsFromSealedBatch({
    dialogue: opts.dialogue,
    charName: opts.charName,
    startTurn: opts.startTurn,
    endTurn: opts.endTurn,
    turnTrace: opts.turnTrace,
  });
  if (facts.length === 0) {
    return { extracted: 0, persisted: 0, calls: 1 };
  }
  const persisted = persistEpisodicMemoryFactsBestEffort(getDb(), {
    chatId: opts.chatId,
    characterId: opts.characterId,
    userId: opts.userId,
    sourceTurn: opts.endTurn,
    sourceUserMessageId: opts.sourceUserMessageId ?? null,
    boundarySnapshot: opts.boundarySnapshot,
    facts,
    replaceSourceTurn: true,
    metadata: {
      extraction: "summary_seal_batch",
      batch_start: opts.startTurn,
      batch_end: opts.endTurn,
    },
  });
  return { extracted: facts.length, persisted, calls: 1 };
}
