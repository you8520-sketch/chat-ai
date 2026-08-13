/** Background Flash — next-user RP suggestions (not widget extract). */

export const SUGGESTED_REPLY_MIN_CHARS = 50;
export const SUGGESTED_REPLY_MAX_CHARS = 200;
export const SUGGESTED_REPLY_COUNT = 3;

export const SUGGESTED_REPLIES_REQUEST_KIND = "background-suggested-replies-extract";

export const SUGGESTED_REPLY_KINDS = ["escalate", "soften", "pivot"] as const;
export type SuggestedReplyKind = (typeof SUGGESTED_REPLY_KINDS)[number];

export type SuggestedReplyItem = {
  kind: SuggestedReplyKind;
  text: string;
};

/** Static header — never copied into the composer. */
export const SUGGESTED_REPLIES_CAPTION =
  "페르소나 말투로 세 갈래입니다. 설명을 뺀 대사만 입력창에 들어갑니다.";

export type SuggestedReplyKindMeta = {
  label: string;
  hint: string;
};

export function suggestedReplyKindMeta(kind: SuggestedReplyKind): SuggestedReplyKindMeta {
  switch (kind) {
    case "escalate":
      return { label: "갈등 고조", hint: "맞서거나 날을 세워 긴장을 올립니다." };
    case "soften":
      return { label: "달래기", hint: "한 발 물러서거나 사이를 풀어 갑니다." };
    case "pivot":
      return { label: "국면 전환", hint: "화제·장소·행동을 바꿔 다른 길로 밉니다." };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export type SuggestedRepliesRecord = {
  replies: SuggestedReplyItem[];
  extractedAt: string;
  source: "background-deepseek";
  pending?: boolean;
  failed?: boolean;
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
