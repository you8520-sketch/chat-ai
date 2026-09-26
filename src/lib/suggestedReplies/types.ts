/** Background Flash — next-user RP suggestions (not widget extract). */

export const SUGGESTED_REPLY_MIN_CHARS = 50;
export const SUGGESTED_REPLY_MAX_CHARS = 200;
export const SUGGESTED_REPLY_COUNT = 3;

export const SUGGESTED_REPLIES_REQUEST_KIND = "background-suggested-replies-extract";

export const SUGGESTED_REPLY_KINDS = ["natural", "twist", "banter"] as const;
export type SuggestedReplyKind = (typeof SUGGESTED_REPLY_KINDS)[number];

export type SuggestedReplyItem = {
  kind: SuggestedReplyKind;
  text: string;
};

/** Static header — never copied into the composer. */
export const SUGGESTED_REPLIES_CAPTION =
  "페르소나 말투로 세 갈래입니다. 선택한 행동과 대사가 입력창에 들어갑니다.";

export type SuggestedReplyKindMeta = {
  label: string;
  hint: string;
};

export function suggestedReplyKindMeta(kind: SuggestedReplyKind): SuggestedReplyKindMeta {
  switch (kind) {
    case "natural":
      return {
        label: "정석",
        hint: "지금 장면과 관계를 자연스럽게 이어가는 다음 반응.",
      };
    case "twist":
      return {
        label: "한 수",
        hint: "개연성은 유지하되 뻔하지 않게 각도를 바꾸는 반응.",
      };
    case "banter":
      return {
        label: "드립",
        hint: "페르소나 말투를 유지한 재치·장난·빈정거림.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export type SuggestedRepliesRecordSource = "post-turn-shared" | "standalone-extract";

export type SuggestedRepliesRecord = {
  replies: SuggestedReplyItem[];
  extractedAt: string;
  source: SuggestedRepliesRecordSource;
  pending?: boolean;
  failed?: boolean;
  /** Terminal logical outcome; this task was never eligible for the generation. */
  terminalReason?: "original_turn_ineligible";
  generationSequence?: number;
  generationRequestId?: string | null;
};

export type SuggestedRepliesClientFields = {
  suggestedReplies: SuggestedReplyItem[];
  suggestedRepliesPending: boolean;
  suggestedRepliesRequested: boolean;
  suggestedRepliesFailed: boolean;
};

export const EMPTY_SUGGESTED_REPLIES_CLIENT: SuggestedRepliesClientFields = {
  suggestedReplies: [],
  suggestedRepliesPending: false,
  suggestedRepliesRequested: false,
  suggestedRepliesFailed: false,
};
