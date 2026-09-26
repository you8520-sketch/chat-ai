/**
 * Shared Initial episodic consumer — semantic parse + persistence owner helpers.
 * Physical inference: postTurnSharedInitial; DB writes: episodicMemoryFacts.
 */
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import type Database from "better-sqlite3";
import type { Route } from "@/lib/ai";
import {
  reconcileEpisodicMemoryFactsForGeneration,
  type ReconcileEpisodicMemoryFactsInput,
} from "@/lib/episodicMemoryFacts";
import { sanitizeEpisodicExtractedFacts } from "./memory-episodic-normalize";
import type { EpisodicExtractedFact } from "./memory-episodic-types";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { resolveEpisodicTurnEligibility, type TurnScopeClass } from "./memory-summary-scope";
import {
  resolveEpisodicEligibilityForSourceUserMessage,
  type EpisodicEligibilityResolution,
} from "./memory-episodic-eligibility";
import {
  getMemorySourceBoundaryCore,
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";
import { resolveMemorySourceTurnIdentityCore } from "./memory-turn-loader";

export {
  resolveEpisodicEligibilityForSourceUserMessage,
  type EpisodicEligibilityResolution,
} from "./memory-episodic-eligibility";

export const SHARED_EPISODIC_EXTRACTION = "shared_initial_per_turn" as const;
export const EPISODIC_FACTS_MAX_PER_SHARED_TURN = 3;

export type EpisodicSectionParse = {
  present: boolean;
  valid: boolean;
  facts: EpisodicExtractedFact[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Memory-layer eligibility for requesting episodic section in Shared Initial. */
export function shouldRequestEpisodicInSharedInitial(opts: {
  userMessage: string;
  memoryFeatureEnabled?: boolean;
  /** When provided, memory-scope owner resolves branch/noncanon eligibility. */
  db?: Database.Database;
  chatId?: number;
  sourceUserMessageId?: number | null;
  /** Test-only override when db/chatId omitted. */
  previousWasNoncanonOrBranch?: boolean;
}): boolean {
  if (opts.memoryFeatureEnabled === false) return false;
  if (!isMemoryFeatureEnabled() && opts.memoryFeatureEnabled !== true) return false;
  if (resolveOocSceneRenderIntent(opts.userMessage)) return false;

  if (opts.db != null && opts.chatId != null) {
    return resolveEpisodicEligibilityForSourceUserMessage(opts.db, {
      chatId: opts.chatId,
      sourceUserMessageId: opts.sourceUserMessageId ?? null,
      sourceUserText: opts.userMessage,
    }).eligible;
  }

  return resolveEpisodicTurnEligibility(opts.userMessage, {
    previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch ?? false,
  }).eligible;
}

export function isUserTurnEpisodicallyEligible(
  resolution: EpisodicEligibilityResolution
): boolean {
  return resolution.eligible;
}

export function episodicIneligibleScopeClass(
  resolution: EpisodicEligibilityResolution
): TurnScopeClass | null {
  return resolution.eligible ? null : resolution.scopeClass;
}

/** Strict JSON schema fragment for episodic.extracted_facts items (memory-owned contract). */
export function buildSharedEpisodicSectionJsonSchema(): Record<string, unknown> {
  const factItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "category",
      "subject",
      "attribute",
      "value",
      "importance",
      "fact_text",
      "evidence_type",
    ],
    properties: {
      category: {
        type: "string",
        enum: [
          "relationship",
          "character",
          "setting",
          "item",
          "preference",
          "rule",
          "quest",
          "location",
          "organization",
        ],
      },
      subject: { type: "string" },
      attribute: { type: "string" },
      value: { type: "string" },
      importance: { type: "string", enum: ["critical", "important", "normal"] },
      fact_text: { type: "string" },
      evidence_type: {
        type: "string",
        enum: ["explicit_user_statement", "explicit_scene_event", "explicit_character_claim"],
      },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["extracted_facts"],
    properties: {
      extracted_facts: {
        type: "array",
        minItems: 0,
        maxItems: EPISODIC_FACTS_MAX_PER_SHARED_TURN,
        items: factItem,
      },
    },
  };
}

/**
 * Parse top-level episodic section from Shared Initial JSON.
 * Distinguishes valid semantic empty from contract failure.
 */
export function parseSharedEpisodicSection(raw: unknown): EpisodicSectionParse {
  if (raw === undefined || raw === null) {
    return { present: false, valid: false, facts: [] };
  }
  const section = asRecord(raw);
  if (!section) return { present: true, valid: false, facts: [] };
  if (!("extracted_facts" in section)) {
    return { present: true, valid: false, facts: [] };
  }
  const rawFacts = section.extracted_facts;
  if (!Array.isArray(rawFacts)) {
    return { present: true, valid: false, facts: [] };
  }
  if (rawFacts.length === 0) {
    return { present: true, valid: true, facts: [] };
  }
  const facts = sanitizeEpisodicExtractedFacts(rawFacts, { requireEvidence: true });
  if (facts.length === 0) {
    return { present: true, valid: false, facts: [] };
  }
  return { present: true, valid: true, facts };
}

export type ReconcileSharedEpisodicFactsInput = {
  chatId: number;
  userId: number;
  characterId: number;
  assistantMessageId: number;
  sourceUserMessageId?: number | null;
  sourceUserText: string;
  boundarySnapshot?: MemorySourceBoundary;
  episodic: EpisodicSectionParse;
  isRegeneration: boolean;
  requestId?: string | null;
  generationSequence?: number;
  /** Canonical per-turn content route of the source turn; stamped into fact metadata. */
  contentRoute?: Route;
};

/**
 * Persist Shared Initial episodic facts after canonical assistant finalization.
 * Regen: always replace source-turn rows (wrong memory > missing memory).
 * Normal: valid nonempty → insert; valid empty → noop; invalid/missing → noop.
 */
export function reconcileSharedEpisodicFactsForTurn(
  db: Database.Database,
  input: ReconcileSharedEpisodicFactsInput
): { replaced: boolean; inserted: number; skipped: boolean } {
  const boundary = input.boundarySnapshot ?? getMemorySourceBoundaryCore(db, input.chatId);
  if (
    !isMemoryWriteGuardCurrentCore(db, {
      chatId: input.chatId,
      snapshot: boundary,
      sourceUserMessageIds: [input.sourceUserMessageId],
    })
  ) {
    return { replaced: false, inserted: 0, skipped: true };
  }

  const identity = resolveMemorySourceTurnIdentityCore(
    db,
    input.chatId,
    input.assistantMessageId
  );
  if (!identity) {
    return { replaced: false, inserted: 0, skipped: true };
  }

  const isRegeneration = input.isRegeneration;
  const episodic = input.episodic;

  const scopeEligibility = resolveEpisodicEligibilityForSourceUserMessage(db, {
    chatId: input.chatId,
    sourceUserMessageId: identity.sourceUserMessageId ?? input.sourceUserMessageId ?? null,
    sourceUserText: input.sourceUserText,
  });
  if (!scopeEligibility.eligible) {
    if (isRegeneration) {
      const reconcileInput: ReconcileEpisodicMemoryFactsInput = {
        chatId: input.chatId,
        userId: input.userId,
        characterId: input.characterId,
        sourceTurn: identity.memoryTurnNumber,
        sourceUserMessageId: identity.sourceUserMessageId ?? input.sourceUserMessageId,
        sourceUserText: input.sourceUserText,
        boundarySnapshot: boundary,
        facts: [],
        isRegeneration: true,
        metadata: {
          extraction: SHARED_EPISODIC_EXTRACTION,
          assistant_message_id: input.assistantMessageId,
          ...(input.requestId ? { request_id: input.requestId } : {}),
          ...(input.generationSequence != null
            ? { generation_sequence: input.generationSequence }
            : {}),
        },
      };
      const result = reconcileEpisodicMemoryFactsForGeneration(db, reconcileInput);
      return { ...result, skipped: false };
    }
    return { replaced: false, inserted: 0, skipped: true };
  }

  if (!isRegeneration) {
    if (!episodic.present || !episodic.valid) {
      return { replaced: false, inserted: 0, skipped: true };
    }
    if (episodic.facts.length === 0) {
      return { replaced: false, inserted: 0, skipped: true };
    }
  } else {
    if (episodic.present && episodic.valid) {
      // regen with valid section (empty or nonempty)
    } else {
      // source mutation + episodic failure → delete old canonical rows
    }
  }

  const facts =
    isRegeneration && (!episodic.present || !episodic.valid)
      ? []
      : episodic.valid
        ? episodic.facts
        : [];

  if (!isRegeneration && facts.length === 0) {
    return { replaced: false, inserted: 0, skipped: true };
  }

  const reconcileInput: ReconcileEpisodicMemoryFactsInput = {
    chatId: input.chatId,
    userId: input.userId,
    characterId: input.characterId,
    sourceTurn: identity.memoryTurnNumber,
    sourceUserMessageId: identity.sourceUserMessageId ?? input.sourceUserMessageId,
    sourceUserText: input.sourceUserText,
    boundarySnapshot: boundary,
    facts,
    isRegeneration,
    metadata: {
      extraction: SHARED_EPISODIC_EXTRACTION,
      assistant_message_id: input.assistantMessageId,
      ...(input.requestId ? { request_id: input.requestId } : {}),
      ...(input.generationSequence != null
        ? { generation_sequence: input.generationSequence }
        : {}),
      ...(input.contentRoute ? { content_route: input.contentRoute } : {}),
      memory_evidence_type: facts[0]?.evidence_type ?? undefined,
    },
  };

  const result = reconcileEpisodicMemoryFactsForGeneration(db, reconcileInput);
  return { ...result, skipped: false };
}
