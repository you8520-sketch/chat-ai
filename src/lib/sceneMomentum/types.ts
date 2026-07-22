/**
 * Scene Momentum Support (Candidate A) — COMMON, model-agnostic data contract.
 *
 * Phase 1 rollout is MODEL-GATED to the DeepSeek D2 canary (see contextBuilder wiring),
 * but this module is deliberately COMMON: it has no DeepSeek-specific schema and no
 * knowledge of the canon compiler / ACTIVE selector / Scene Engine. It only reads
 * already-existing scene context (recent raw history + current cue + already-parsed
 * current location/promises + peeled creator greeting at cold-start) and distills a
 * compact, descriptive, present-tense, current-scene-only snapshot.
 *
 * The block is DATA/CONTEXT only: it states what the current scene state IS so the
 * model can continue it. It never says what should happen next, never introduces a new
 * element, and never copies raw history verbatim (the last ~4 raw turns are extraction
 * EVIDENCE ONLY — never re-injected).
 */

/** One raw RP turn used as extraction evidence. */
export type SceneMomentumTurn = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Inputs to `buildSceneMomentumBlock`. All fields are already-existing scene signals;
 * the extractor performs NO new data collection and NO LLM call.
 *
 * - `recentHistory`: bounded recent raw scene history (last ~4 turns) — extraction
 *   evidence only. Never copied verbatim into the block.
 * - `currentUserMessage`: the current user cue for THIS turn — evidence aid only; it is
 *   already present as the final user turn, so it is NEVER re-injected as content.
 * - `currentLocation`: already-parsed current location from `memoryMeta.currentLocation`
 *   (parsed by the memory pipeline from turn 1 but NOT currently rendered elsewhere).
 *   Read-only reuse; used only as a WHERE fallback.
 * - `promises`: active promises from `memoryMeta.promises` — read-only reuse; used only
 *   as an UNFINISHED fallback. Items/promises are NOT re-rendered (owned by [3b]).
 * - `openingGreeting`: the peeled creator greeting (cold-start WHERE/WHAT/RELATIONSHIP
 *   source). Only its scene-local slice is used; greeting-embedded dormant hooks are
 *   filtered out.
 */
export type SceneMomentumInput = {
  recentHistory: SceneMomentumTurn[];
  currentUserMessage: string;
  currentLocation?: string | null;
  promises?: string[];
  openingGreeting?: string | null;
};

/** The five optional momentum fields. `null`/empty = field omitted (no clear evidence). */
export type SceneMomentumFields = {
  /** Currently established location/posture. */
  where: string | null;
  /** Current in-progress activity/stance, present tense. */
  whatIsHappening: string | null;
  /** Open immediate interaction thread (unanswered question / open offer / active promise). */
  unfinished: string | null;
  /** Current affective distance/tension carried by the most recent exchange (descriptive). */
  relationshipState: string | null;
  /** Concrete objects/physical givens already present in the scene (bounded, up to 4). */
  availableAffordances: string[];
};

/** Full extraction result (rendered block + structured fields + observability meta). */
export type SceneMomentumResult = {
  fields: SceneMomentumFields;
  /** Rendered bracketed block, or `null` when no usable scene state was found. */
  block: string | null;
  meta: {
    /** Which of the 5 fields were non-empty, in canonical order. */
    fieldsPresent: string[];
    /** Number of recent turns the extraction read (bounded, e.g. last 4). */
    sourceCount: number;
    /** Number of recent assistant turns that contributed (drives auto-disable). */
    activeTurns: number;
    /** Whether the cold-start peeled greeting was used as a source. */
    greetingSourced: boolean;
    /** Total chars of the rendered block (0 when block is null). */
    blockChars: number;
  };
};

/** Canonical field order used for `fieldsPresent` and rendering. */
export const SCENE_MOMENTUM_FIELD_ORDER = [
  "where",
  "whatIsHappening",
  "unfinished",
  "relationshipState",
  "availableAffordances",
] as const;

/** Neutral data-label header (bracketed). NOT the OPENING SCENE CONTEXT label. */
export const SCENE_MOMENTUM_HEADER = "[CURRENT SCENE CONTINUITY]";

/** Maximum recent turns read as extraction evidence. */
export const SCENE_MOMENTUM_RECENT_WINDOW = 4;

/** Maximum affordances rendered. */
export const SCENE_MOMENTUM_AFFORDANCES_MAX = 4;
