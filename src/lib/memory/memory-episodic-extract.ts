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

export type EpisodicExtractFailureReason =
  | "provider_error"
  | "blank_response"
  | "malformed_response"
  | "invalid_contract"
  | "test_network_suppressed";

export type EpisodicExtractOutcome =
  | { ok: true; facts: EpisodicExtractedFact[] }
  | { ok: false; reason: EpisodicExtractFailureReason };

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

/** Structured seal-extract outcome — distinguishes semantic empty from contract/provider failure. */
export function parseEpisodicExtractOutcome(raw: string): EpisodicExtractOutcome {
  const text = raw.trim();
  if (!text) {
    return { ok: false, reason: "blank_response" };
  }
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, reason: "malformed_response" };
  }
  let parsed: { extracted_facts?: unknown };
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1)) as { extracted_facts?: unknown };
  } catch {
    return { ok: false, reason: "malformed_response" };
  }
  if (!Array.isArray(parsed.extracted_facts)) {
    return { ok: false, reason: "invalid_contract" };
  }
  const rawArr = parsed.extracted_facts;
  if (rawArr.length === 0) {
    return { ok: true, facts: [] };
  }
  const facts = sanitizeEpisodicExtractedFacts(rawArr, { requireEvidence: true });
  if (facts.length === 0) {
    return { ok: false, reason: "invalid_contract" };
  }
  return { ok: true, facts };
}

/** Compatibility wrapper — failures collapse to [] for legacy callers. */
export function parseEpisodicExtractedFacts(raw: string): EpisodicExtractedFact[] {
  const outcome = parseEpisodicExtractOutcome(raw);
  return outcome.ok ? outcome.facts : [];
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
}): Promise<EpisodicExtractOutcome> {
  extractCallCountForTests += 1;
  // Provider/API-key validation belongs to the background caller.
  // Node-test network suppression only — no provider-specific key gate here.
  const runningUnderNodeTest = Boolean(process.env.NODE_TEST_CONTEXT);
  if (!extractCallerOverride && runningUnderNodeTest) {
    return { ok: false, reason: "test_network_suppressed" };
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
    return parseEpisodicExtractOutcome(text);
  } catch (e) {
    console.warn("[memory] episodic seal extract LLM failed (best-effort)", {
      start: opts.startTurn,
      end: opts.endTurn,
      error: (e as Error).message?.slice(0, 200) ?? "unknown",
    });
    return { ok: false, reason: "provider_error" };
  }
}

export type EpisodicSealExtractPersistResult = {
  extracted: number;
  persisted: number;
  calls: number;
  staleRejected?: boolean;
  extractFailed?: boolean;
  failureReason?: EpisodicExtractFailureReason;
};

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
}): Promise<EpisodicSealExtractPersistResult> {
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
  const outcome = await extractEpisodicFactsFromSealedBatch({
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
      extracted: outcome.ok ? outcome.facts.length : 0,
      persisted: 0,
      calls: 1,
      staleRejected: true,
      extractFailed: !outcome.ok,
      failureReason: outcome.ok ? undefined : outcome.reason,
    };
  }
  if (!outcome.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[EpisodicMemory] seal extract failed — preserving batch rows", {
        chat_id: opts.chatId,
        batch_start: opts.startTurn,
        batch_end: opts.endTurn,
        reason: outcome.reason,
      });
    }
    return {
      extracted: 0,
      persisted: 0,
      calls: 1,
      extractFailed: true,
      failureReason: outcome.reason,
    };
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
    facts: outcome.facts,
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
  return { extracted: outcome.facts.length, persisted, calls: 1 };
}
