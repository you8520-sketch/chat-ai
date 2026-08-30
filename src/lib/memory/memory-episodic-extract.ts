/**
 * Seal-aligned episodic extraction — at most one background call per 5-turn summary batch.
 * Best-effort: failure never rolls back a successful summary seal.
 */
import { callBackgroundMemory } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { persistEpisodicMemoryFactsBestEffort } from "@/lib/episodicMemoryFacts";
import { sanitizeEpisodicExtractedFacts } from "@/lib/memory/memory-episodic-normalize";
import type {
  EpisodicBatchUserSource,
  EpisodicExtractedFact,
} from "@/lib/memory/memory-episodic-types";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import {
  batchSourceMessageIds,
  isBatchSourceGuardCurrent,
  snapshotBatchSourceGuard,
} from "./memory-batch-source-guard";
import { loadMemoryEligibleChatTurnsWithMessageIdsCore } from "./memory-turn-loader";
import {
  getMemorySourceBoundaryCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";

export const EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH = 1;

export type { EpisodicBatchUserSource, EpisodicExtractedFact };

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

export function parseEpisodicExtractedFacts(raw: string): EpisodicExtractedFact[] {
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
    return sanitizeEpisodicExtractedFacts(parsed.extracted_facts, { requireEvidence: true });
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
}): Promise<EpisodicExtractedFact[]> {
  extractCallCountForTests += 1;
  // Provider/API-key validation belongs to the background caller.
  // Node-test network suppression only — no provider-specific key gate here.
  const runningUnderNodeTest = Boolean(process.env.NODE_TEST_CONTEXT);
  if (!extractCallerOverride && runningUnderNodeTest) {
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
      callBackgroundMemory(sys, history, turnTrace, requestKind));
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
  batchUserSources: EpisodicBatchUserSource[];
  boundarySnapshot?: MemorySourceBoundary;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<{ extracted: number; persisted: number; calls: number; staleRejected?: boolean }> {
  if (!isMemoryFeatureEnabled()) {
    return { extracted: 0, persisted: 0, calls: 0 };
  }
  const db = getDb();
  const guardBefore = snapshotBatchSourceGuard(db, {
    chatId: opts.chatId,
    batchStart: opts.startTurn,
    batchEnd: opts.endTurn,
    boundarySnapshot: opts.boundarySnapshot,
    sourceUserMessageIds: opts.batchUserSources.map((source) => source.messageId),
  });
  const facts = await extractEpisodicFactsFromSealedBatch({
    dialogue: opts.dialogue,
    charName: opts.charName,
    startTurn: opts.startTurn,
    endTurn: opts.endTurn,
    turnTrace: opts.turnTrace,
  });
  if (
    !isBatchSourceGuardCurrent(
      db,
      {
        chatId: opts.chatId,
        batchStart: opts.startTurn,
        batchEnd: opts.endTurn,
        boundarySnapshot: guardBefore.boundary,
        sourceUserMessageIds: opts.batchUserSources.map((source) => source.messageId),
      },
      guardBefore
    )
  ) {
    console.info("EPISODIC_STALE_SOURCE_REJECTED", {
      chat_id: opts.chatId,
      batch_start: opts.startTurn,
      batch_end: opts.endTurn,
      epoch: guardBefore.boundary.epoch,
    });
    return {
      extracted: facts.length,
      persisted: 0,
      calls: 1,
      staleRejected: true,
    };
  }
  if (facts.length === 0) {
    return { extracted: 0, persisted: 0, calls: 1 };
  }
  const eligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
    db,
    opts.chatId,
    guardBefore.boundary
  );
  const sourceIds = batchSourceMessageIds(eligible, opts.startTurn, opts.endTurn);
  const persisted = persistEpisodicMemoryFactsBestEffort(db, {
    chatId: opts.chatId,
    characterId: opts.characterId,
    userId: opts.userId,
    sourceTurn: opts.endTurn,
    sourceUserMessageId:
      opts.batchUserSources[opts.batchUserSources.length - 1]?.messageId ?? null,
    batchUserSources: opts.batchUserSources,
    boundarySnapshot: guardBefore.boundary,
    facts,
    replaceSummarySealBatch: { batchStart: opts.startTurn, batchEnd: opts.endTurn },
    metadata: {
      extraction: "summary_seal_batch",
      batch_start: opts.startTurn,
      batch_end: opts.endTurn,
      source_user_message_ids: sourceIds.userMessageIds,
      source_assistant_message_ids: sourceIds.assistantMessageIds,
      source_fingerprint: guardBefore.batchFingerprint,
    },
  });
  return { extracted: facts.length, persisted, calls: 1 };
}
