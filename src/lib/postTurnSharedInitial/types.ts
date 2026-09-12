import type { TokenUsage } from "@/lib/ai";
import type { CombinedDualWidgetExtractParseResult } from "@/lib/statusWidget/extractNormalize";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import type { RelationshipMetaDelta } from "@/lib/chatMemory";

export const POST_TURN_SHARED_INITIAL_REQUEST_KIND = "background-post-turn-shared-initial";

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
  /**
   * Active consumers for this inference. Inactive sections are NOT requested in
   * the prompt envelope (no wasted output tokens) and are not parsed as results.
   */
  includeSuggestions: boolean;
  includeRelationship: boolean;
  /** Regen: rejected assistant draft for relationship comparison (relationship section only). */
  relationshipRegenContext?: { previousAssistantMessage: string } | null;
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
  relationship: RelationshipSectionParse;
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
