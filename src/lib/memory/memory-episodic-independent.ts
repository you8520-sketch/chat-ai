/**
 * Independent per-turn episodic inference.
 *
 * Reuses the canonical post-turn runner (`relationship_only`, episodic consumer
 * only) so the episodic prompt/schema/parse owners stay single. The memory
 * layer (`scheduleMemoryUpdate`) persists the result through
 * `reconcileSharedEpisodicFactsForTurn` after canonical finalization.
 */
import type Database from "better-sqlite3";
import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import {
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { getDb } from "@/lib/db";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import {
  buildPlatformAsyncTurnLedgerContext,
  listProviderCostEventsForAssistantGeneration,
} from "@/lib/providerCostLedger";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import { POST_TURN_EPISODIC_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import type { StatusWidgetExtractCaller } from "@/lib/statusWidget/extract";
import type { EpisodicCorrectionCandidate } from "./memory-episodic-correction";
import type { EpisodicSectionParse } from "./memory-episodic-shared";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  getMemorySourceBoundaryCore,
  isMemorySourceEligible,
  type MemorySourceBoundary,
} from "./memory-source-boundary";

export type IndependentEpisodicRejectReason =
  | "stale_generation"
  | "duplicate_attempt"
  | "memory_gated"
  | "internal_error";

/**
 * - `not_requested`: the turn is not episodic-eligible; no provider call.
 * - `rejected`: no provider call and the memory layer must NOT touch stored
 *   facts (a stale or repeated invocation never replaces the current memory).
 * - `extracted`: a provider call was attempted. `episodic` is null when the
 *   call failed at transport level (regeneration then clears the replaced
 *   variant's facts, same as the former Shared Initial section failure).
 *   `boundary` is the memory boundary the call started under; the write guard
 *   compares against it so a reset/epoch change during the call blocks the write.
 */
export type IndependentEpisodicOutcome =
  | { status: "not_requested" }
  | { status: "rejected"; reason: IndependentEpisodicRejectReason }
  | {
      status: "extracted";
      episodic: EpisodicSectionParse | null;
      boundary?: MemorySourceBoundary;
    };

export type IndependentEpisodicInput = {
  eligible: boolean;
  chatId: number;
  assistantMessageId: number;
  sourceUserMessageId: number | null;
  generationScope: AssistantGenerationScope;
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  correctionCandidates: readonly EpisodicCorrectionCandidate[];
};

export type IndependentEpisodicDeps = {
  /** Test seam — production uses the background provider caller. */
  caller?: StatusWidgetExtractCaller;
  db?: Database.Database;
};

function hasEpisodicProviderAttempt(
  db: Database.Database,
  scope: AssistantGenerationScope
): boolean {
  return listProviderCostEventsForAssistantGeneration(
    scope.assistantMessageId,
    scope.generationSequence,
    db
  ).some((row) => row.request_kind === POST_TURN_EPISODIC_REQUEST_KIND);
}

/**
 * Never rejects. Safe to start before the Shared Initial call so both provider
 * requests run concurrently; this function only reads, and writes happen later
 * in the memory layer behind the generation/epoch guards.
 */
export async function startIndependentEpisodicExtraction(
  input: IndependentEpisodicInput,
  deps: IndependentEpisodicDeps = {}
): Promise<IndependentEpisodicOutcome> {
  if (!input.eligible) return { status: "not_requested" };
  try {
    const db = deps.db ?? getDb();
    if (!isMemoryFeatureEnabled() || isGeminiIsolationMode()) {
      return { status: "rejected", reason: "memory_gated" };
    }
    const boundary = getMemorySourceBoundaryCore(db, input.chatId);
    if (!isMemorySourceEligible({ sourceUserMessageId: input.sourceUserMessageId, boundary })) {
      return { status: "rejected", reason: "memory_gated" };
    }
    if (!isCurrentAssistantGeneration(input.generationScope, db)) {
      console.info("STALE_GENERATION_RESULT_REJECTED", {
        family: "episodic",
        messageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        phase: "provider_call",
      });
      return { status: "rejected", reason: "stale_generation" };
    }
    // The ledger row is written when the physical attempt starts, so it is the
    // durable per-generation record that a paid episodic call already happened
    // (including failed attempts, which are not retried).
    if (hasEpisodicProviderAttempt(db, input.generationScope)) {
      return { status: "rejected", reason: "duplicate_attempt" };
    }

    const run = await runPostTurnRelationshipOnlyInitial(
      {
        charName: input.charName,
        personaName: input.personaName,
        userMessage: input.userMessage,
        assistantProse: input.assistantProse,
        primaryModelId: BACKGROUND_OPENROUTER_MODEL,
        requestKind: POST_TURN_EPISODIC_REQUEST_KIND,
        includeSuggestions: false,
        includeRelationship: false,
        includeEpisodic: true,
        previousAssistantMessage: null,
        activePromises: [],
        episodicCorrectionCandidates: input.correctionCandidates,
      },
      deps.caller,
      buildPlatformAsyncTurnLedgerContext({
        chatId: input.chatId,
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        generationRequestId: input.generationScope.generationRequestId,
        family: "post_turn_shared_initial",
        jobAttemptOrdinal: 1,
        requestKind: POST_TURN_EPISODIC_REQUEST_KIND,
      })
    );
    if (!run.attempted) return { status: "rejected", reason: "internal_error" };
    return {
      status: "extracted",
      episodic: run.transportOk ? (run.parsed?.episodic ?? null) : null,
      boundary,
    };
  } catch (e) {
    console.warn("[memory] independent episodic extraction failed:", (e as Error).message);
    return { status: "rejected", reason: "internal_error" };
  }
}
