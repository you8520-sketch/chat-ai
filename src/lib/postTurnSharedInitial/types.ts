import type { TokenUsage } from "@/lib/ai";
import type { CombinedDualWidgetExtractParseResult } from "@/lib/statusWidget/extractNormalize";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";

export const POST_TURN_SHARED_INITIAL_REQUEST_KIND = "background-post-turn-shared-initial";

export type PostTurnSharedInitialMode = "dual" | "character" | "user";

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
};

export type PostTurnSharedSingleWidgetParse = {
  values: StatusWidgetValues | null;
  ok: boolean;
  echoDroppedKeys: string[];
};

export type PostTurnSharedInitialParseResult = {
  jsonParseOk: boolean;
  dual: CombinedDualWidgetExtractParseResult | null;
  character: PostTurnSharedSingleWidgetParse | null;
  user: PostTurnSharedSingleWidgetParse | null;
  suggestedReplies: SuggestedReplyItem[];
  suggestedRepliesOk: boolean;
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
