import type { StatusWidgetReasonCode } from "@/lib/statusWidget/diagnostics";
import type {
  PostTurnSharedInitialMode,
  PostTurnSharedInitialParseResult,
} from "@/lib/postTurnSharedInitial/types";

export const SHARED_INITIAL_WIDGET_OUTCOME_OWNER =
  "postTurnSharedInitialWidgetOutcome.ts";

export type PostTurnSharedInitialWidgetOutcome = {
  succeeded: boolean;
  reasonCode: StatusWidgetReasonCode;
};

/** Widget extraction success only — independent of suggestedRepliesOk. */
export function evaluatePostTurnSharedInitialWidgetExtraction(input: {
  transportOk: boolean;
  mode: PostTurnSharedInitialMode;
  parsed: PostTurnSharedInitialParseResult | null;
}): PostTurnSharedInitialWidgetOutcome {
  if (!input.transportOk) {
    return { succeeded: false, reasonCode: "V3_EMPTY_OUTPUT" };
  }

  const parsed = input.parsed;
  if (!parsed || !parsed.jsonParseOk) {
    return { succeeded: false, reasonCode: "V3_PARSE_FAILED" };
  }

  switch (input.mode) {
    case "dual": {
      const dual = parsed.dual;
      if (dual != null && dual.characterOk && dual.userOk) {
        return { succeeded: true, reasonCode: "OK" };
      }
      return { succeeded: false, reasonCode: "V3_INITIAL_EMPTY" };
    }
    case "character":
      if (parsed.character?.ok === true) {
        return { succeeded: true, reasonCode: "OK" };
      }
      return { succeeded: false, reasonCode: "V3_INITIAL_EMPTY" };
    case "user":
      if (parsed.user?.ok === true) {
        return { succeeded: true, reasonCode: "OK" };
      }
      return { succeeded: false, reasonCode: "V3_INITIAL_EMPTY" };
    default: {
      const _exhaustive: never = input.mode;
      return _exhaustive;
    }
  }
}

export function postTurnSharedInitialSuggestedRepliesOk(
  parsed: PostTurnSharedInitialParseResult | null | undefined
): boolean {
  return parsed?.suggestedRepliesOk === true;
}

/** Preserve parsed payload for downstream partial reuse — independent of diagnostic full success. */
export function shouldPreservePostTurnSharedInitialParsed(input: {
  transportOk: boolean;
  parsed: PostTurnSharedInitialParseResult | null;
}): boolean {
  return input.transportOk === true && input.parsed != null && input.parsed.jsonParseOk === true;
}

export const SHARED_PARSED_PAYLOAD_PRESERVATION_OWNER =
  "postTurnSharedInitialWidgetOutcome.ts";
