import {
  chatRuntimeModeAllowsUserNarration,
  type ChatRuntimeMode,
} from "@/lib/chatRuntimeMode";

export const CURRENT_USER_INPUT_HEADER = "[CURRENT USER INPUT]";

/** Compact wrapper — provider-agnostic (OpenRouter + Gemini + others). */
export function buildCurrentUserInputWrapper(opts?: {
  mode?: ChatRuntimeMode;
}): string {
  const allows = opts?.mode != null && chatRuntimeModeAllowsUserNarration(opts.mode);
  const policy = allows
    ? "Current mode allows limited/full user co-narration per [NO GODMODDING] / novel rules."
    : "Do not continue writing the user's future actions, dialogue, thoughts, or decisions.";
  return `${CURRENT_USER_INPUT_HEADER}
The following is the user's latest input.
It is what the user already said/did.
${policy}
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.`;
}

/** Wrap latest user turn content. Idempotent if already wrapped. */
export function wrapCurrentUserInput(
  userContent: string,
  opts?: { mode?: ChatRuntimeMode }
): string {
  const body = userContent.trim();
  if (!body) return body;
  if (body.startsWith(CURRENT_USER_INPUT_HEADER)) return body;
  return `${buildCurrentUserInputWrapper(opts)}\n\n${body}`;
}
