/**
 * #1486 Phase 3A — 6/50-turn Main RP recall preflight.
 * Plan and GPT packet shape only. No provider POST. No execute helper.
 */
import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
  type SelectedAIOptionMeta,
} from "@/lib/chatModels";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE,
} from "@/lib/memory/memoryEvidenceProvenance";
import {
  PHASE2B_MUST_KEEP_FACTS,
  PHASE2B_TURNS,
} from "@/lib/memory/monthlyRpMemoryQualityPhase2bFixture";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";

export const PHASE3A_PATHS = ["A_SEEDED_MEMORY", "B_LUNA_END_TO_END"] as const;
export type Phase3aPath = (typeof PHASE3A_PATHS)[number];

export const PHASE3A_HORIZONS = ["t6", "t50"] as const;
export type Phase3aHorizon = (typeof PHASE3A_HORIZONS)[number];

/** Existing Phase 1 A/B retrieve probes. Not new scene text. */
export const PHASE3A_REUSED_PROBES = {
  t6: {
    phase1Case: "A",
    sourceTurn: 1,
    currentTurn: 7,
    factText: "라이크와 렌이 비 오는 골목에서 우산을 같이 썼다.",
    query: "그때 우산 같이 썼던 거 기억나?",
    alreadyCoveredBy: "monthlyRpMemoryQualityPhase1.test.ts A + memory-rp-benchmark horizon-t6-01",
  },
  t50: {
    phase1Case: "B",
    sourceTurn: 1,
    currentTurn: 51,
    factText: "라이크와 렌이 옥상에서 처음으로 담배를 나눠 피웠다.",
    query: "옥상에서 담배 피웠던 첫날 기억해?",
    alreadyCoveredBy: "monthlyRpMemoryQualityPhase1.test.ts B",
  },
} as const;

/** Contrast already owned by Phase 1 / 2B. Do not add a second fixture. */
export const PHASE3A_REUSED_CONTRASTS = [
  { id: "past_vs_current", owner: "Phase 1 D", paidInPhase3a: false },
  { id: "claim_vs_fact", owner: "Phase 1 G / Phase 2B claim_vs_fact", paidInPhase3a: false },
  { id: "item_owner", owner: "Phase 2B item_owner", paidInPhase3a: false },
  { id: "promise_vs_fulfillment", owner: "Phase 2B promise", paidInPhase3a: false },
  { id: "emotion_change", owner: "Phase 1 F / Phase 2B emotion_change", paidInPhase3a: false },
  { id: "role_direction", owner: "Phase 1 E / Phase 2B role_direction", paidInPhase3a: false },
  { id: "false_shared_memory", owner: "scheduled HISTORICAL_ONLY memory_false_shared_event", paidInPhase3a: false },
] as const;

export const PHASE3A_OUT_OF_SCOPE = [
  "memory50TurnAbScript harbor 이안/서린 — different fixture family",
  "50 consecutive Main RP chat generations",
  "Phase 2C Luna re-call",
  "production character-18 / admin 렌 sheet read on this VM",
] as const;

export type Phase3aGptReviewPacket = {
  path: Phase3aPath;
  horizon: Phase3aHorizon;
  modelId: SelectedAI | null;
  sourceTurns: readonly { turnIndex: number; user: string; assistant: string }[];
  storedSummary: string | null;
  storedEpisodes: readonly string[];
  retrievalCandidates: readonly string[];
  injected: string | null;
  finalWire: string | null;
  modelResponse: string | null;
  missingFacts: string[];
  wrongTimeActorRelationOwnership: string[];
  ungroundedMemory: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  billedUsd: number | null;
  finishReason: string | null;
  originMainSha: string | null;
  provenance: "CURRENT_CODE_DETERMINISTIC" | "CURRENT_LIVE_PROVIDER";
  pathAPassMustNotImplyPathB: true;
  cursorQualityScore: null;
};

export function emptyPhase3aGptReviewPacket(
  path: Phase3aPath,
  horizon: Phase3aHorizon
): Phase3aGptReviewPacket {
  return {
    path,
    horizon,
    modelId: null,
    sourceTurns: [],
    storedSummary: null,
    storedEpisodes: [],
    retrievalCandidates: [],
    injected: null,
    finalWire: null,
    modelResponse: null,
    missingFacts: [],
    wrongTimeActorRelationOwnership: [],
    ungroundedMemory: [],
    inputTokens: null,
    outputTokens: null,
    billedUsd: null,
    finishReason: null,
    originMainSha: null,
    provenance: "CURRENT_CODE_DETERMINISTIC",
    pathAPassMustNotImplyPathB: true,
    cursorQualityScore: null,
  };
}

export const PHASE3A_CALL_PLAN = {
  paidPostsThisPhase: 0,
  paidEvaluationApproved: false,
  rerunAuthorized: false,
  activeMainRpModels: MAIN_RP_MODEL_IDS,
  pathA: {
    meaning: "Seed stored memory, retrieve, inject, then one Main RP reply.",
    lunaPosts: 0,
    mainRpPostsIfLaterApproved: MAIN_RP_MODEL_IDS.length * PHASE3A_HORIZONS.length,
    chatGenerationsToBuildHistory: 0,
  },
  pathBLite: {
    meaning:
      "Reuse the archived Phase 2C Luna 5-turn summary. No Luna re-call. Then one Main RP reply per model at the 6-turn probe.",
    newLunaPosts: 0,
    mainRpPostsIfLaterApproved: MAIN_RP_MODEL_IDS.length,
    usesPhase2cSample: true,
    phase2cRerunAuthorized: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.rerunAuthorized,
  },
  pathBFull: {
    meaning:
      "New Luna seals plus Main RP. Not approved. Do not generate 50 chat turns to obtain the same seed.",
    lunaBatchesIf50Turn: 10,
    lunaMaxAttemptsPerBatch: 3,
    mainRpPostsIfLaterApproved: MAIN_RP_MODEL_IDS.length * PHASE3A_HORIZONS.length,
    fiftyChatGenerations: 0,
  },
  identity: {
    selector: RP_QUALITY_PRECALL_TARGET_SELECTOR,
    source: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.identitySource,
    characterSheetRead: false,
    productionPersonaRead: false,
    railwayHashProbeOwner: "RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT",
    localProductionRow: "ABSENT",
  },
  phase1Evidence: MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.provenance,
} as const;

export function phase3aWireModelId(modelId: SelectedAI): string {
  return resolveMainRpPrimaryWireModelId(modelId);
}

export function phase3aProvider(modelId: SelectedAI): SelectedAIOptionMeta["provider"] {
  return selectedAIProvider(modelId);
}

/** Retrieve/inject success on Path A never licenses a Path B pass label. */
export function pathAPassIsNotPathBPass(): false {
  return false;
}

export function phase3aReusedPhase2bTurnCount(): number {
  return PHASE2B_TURNS.length;
}

export function phase3aReusedPhase2bFactCount(): number {
  return PHASE2B_MUST_KEEP_FACTS.length;
}
