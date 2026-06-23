/** Opening beat — never quote or paraphrase [B]'s just-typed input ([A] reaction only). */
export const NO_INPUT_ECHO_RULE = `[NO INPUT ECHO — STRICT]
NEVER quote, paraphrase, or restate [B]'s exact words from the user's current input within your response.
This includes indirect echo via "~라는 말이 들렸다" or "~그 말이 맴돌았다" patterns.
Acknowledge [B]'s input through [A]'s NEW reaction only — not by repeating what [B] said.
Begin from [A]'s perspective and reaction only.`;
