import type { TokenUsage } from "@/lib/ai";
import type { EpisodicSectionParse } from "@/lib/memory/memory-episodic-shared";
import type { EpisodicCorrectionCandidate } from "@/lib/memory/memory-episodic-correction";
import type { CombinedDualWidgetExtractParseResult } from "@/lib/statusWidget/extractNormalize";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import type { SuggestedRepliesDecisionQualityObservation } from "@/lib/suggestedReplies/decisionQualityObservatory";
import type { RelationshipMetaDelta } from "@/lib/chatMemory";
import type { ArtifactRolesParse } from "./artifactRoles";

export const POST_TURN_SHARED_INITIAL_REQUEST_KIND = "background-post-turn-shared-initial";

/**
 * Independent episodic physical call. Prefix-matches the shared-initial kind so
 * output budget and aux provenance owners stay unchanged, while the ledger
 * `request_kind` stays distinguishable from the Shared Initial row.
 */
export const POST_TURN_EPISODIC_REQUEST_KIND = `${POST_TURN_SHARED_INITIAL_REQUEST_KIND}-episodic`;

/**
 * Canonical post-turn inference owner modes. `relationship_only` = no status
 * widget consumer (status OFF), relationship consumer active.
 */
export type PostTurnSharedInitialMode = "dual" | "character" | "user" | "relationship_only";

/** Active logical consumers requested from ONE shared physical inference. */
export type PostTurnSharedConsumerFlags = {
  /** Status widget values section (implied by mode !== "relationship_only"). */
  includeStatus: boolean;
  includeSuggestions: boolean;
  includeRelationship: boolean;
  /** Top-level episodic.extracted_facts — memory layer persistence owner. */
  includeEpisodic: boolean;
};

export type PostTurnSharedInitialInput = {
  mode: PostTurnSharedInitialMode;
  charName: string;
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
  personaName: string;
  /** Public sanitized persona identity — suggestions voice only. */
  userPersona?: string | null;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userMessage: string;
  assistantProse: string;
  previousAssistantProse?: string | null;
  characterWidget?: StatusWidget | null;
  userWidget?: StatusWidget | null;
  previousCharacterValues?: StatusWidgetValues | null;
  previousUserValues?: StatusWidgetValues | null;
  primaryModelId: string;
  /** Provider request kind override; defaults to the shared-initial kind. */
  requestKind?: string;
  /**
   * Active consumers for this inference. Inactive sections are NOT requested in
   * the prompt envelope (no wasted output tokens) and are not parsed as results.
   */
  includeSuggestions: boolean;
  includeRelationship: boolean;
  /** Top-level episodic section — durable memory facts (memory layer persists). */
  includeEpisodic: boolean;
  /** Optional historical artifact role chain (created/presented/took/wore). */
  includeArtifactRoles?: boolean;
  /** Regen: rejected assistant draft for relationship comparison (relationship section only). */
  relationshipRegenContext?: { previousAssistantMessage: string } | null;
  /**
   * Conditional relationship scene re-check. The assistant prose is a located
   * scene window (not the whole turn), and the relationship section must use
   * only that window. Only `relationship_only` callers set this.
   */
  relationshipSceneWindow?: boolean;
  /**
   * Stored `MemoryPromise.text` values of the canonical ledger as of this turn
   * (relationship section only). `promisesRemove` must copy one of these
   * verbatim — `mergePromises` removes by exact stored text.
   */
  activePromises: readonly string[];
  /**
   * Past episodic records offered under handles this turn (episodic section only).
   * `corrects` may only copy one of these handles; the server maps it back to the record.
   */
  episodicCorrectionCandidates?: readonly EpisodicCorrectionCandidate[];
};

export type PostTurnSharedSingleWidgetParse = {
  values: StatusWidgetValues | null;
  ok: boolean;
  echoDroppedKeys: string[];
};

/**
 * Section-level parse evidence for the relationship section. Distinguishes a
 * valid no-op (present + valid + empty arrays) from a section failure
 * (missing/malformed), which must route to independent relationship recovery.
 */
export type RelationshipSectionParse = {
  present: boolean;
  valid: boolean;
  delta: RelationshipMetaDelta;
};

export type PostTurnSharedInitialParseResult = {
  jsonParseOk: boolean;
  dual: CombinedDualWidgetExtractParseResult | null;
  character: PostTurnSharedSingleWidgetParse | null;
  user: PostTurnSharedSingleWidgetParse | null;
  suggestedReplies: SuggestedReplyItem[];
  suggestedRepliesOk: boolean;
  /** Read-only quality classification of the raw suggested-replies section. */
  suggestedRepliesDecisionQuality: SuggestedRepliesDecisionQualityObservation | null;
  relationship: RelationshipSectionParse;
  /** Parsed independently — section failure must not discard other consumers. */
  episodic: EpisodicSectionParse;
  /** Optional artifact role chain; invalid entries are skipped per entry. */
  artifactRoles: ArtifactRolesParse;
};

export type PostTurnSharedInitialRunResult = {
  /** Physical provider invocation was started (success or transport failure). */
  attempted: boolean;
  transportOk: boolean;
  text: string;
  usage: TokenUsage | null;
  parsed: PostTurnSharedInitialParseResult | null;
  httpStatus: number | null;
  finishReason: string | null;
  errorCode: string | null;
};

export type CoalesceSuggestedRepliesOpts = {
  enabled: boolean;
};
