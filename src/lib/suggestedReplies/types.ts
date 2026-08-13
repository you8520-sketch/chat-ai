/** Background Flash — next-user RP suggestions (not widget extract). */

export const SUGGESTED_REPLY_MIN_CHARS = 50;
export const SUGGESTED_REPLY_MAX_CHARS = 200;
export const SUGGESTED_REPLY_COUNT = 3;

export const SUGGESTED_REPLIES_REQUEST_KIND = "background-suggested-replies-extract";

/** Static UI caption — never copied into the composer. */
export const SUGGESTED_REPLIES_CAPTION =
  "페르소나 성격·말투에 맞춰, 갈등을 고조시키는 세 갈래 진행입니다.";

export type SuggestedRepliesRecord = {
  replies: string[];
  extractedAt: string;
  source: "background-deepseek";
  pending?: boolean;
  failed?: boolean;
};

export type SuggestedRepliesClientFields = {
  suggestedReplies: string[];
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
