/**
 * Canonical semantic comment-moderation policy owner.
 *
 * Production Gemini (`moderateCommentWithAi`), the Gemini benchmark baseline,
 * and the JEV benchmark criteria all derive from this single representation so
 * the shadow comparison judges the same ALLOW/BLOCK semantics.
 *
 * Non-goals: eligibility, banned-word matching, strike/ban, report threshold,
 * admin review, billing — those stay on their existing owners.
 */

export type CommentSemanticVerdict = "ALLOW" | "BLOCK";

export type CommentSemanticModerationTrigger = "banned_word" | "report_threshold";

export type CommentSemanticModerationInput = {
  content: string;
  normalized: string;
  matchedWords: string[];
  trigger: CommentSemanticModerationTrigger;
};

/**
 * Byte-stable system prompt previously inlined in commentModeration.ts.
 * Do not fork a second production Gemini prompt.
 */
export const COMMENT_SEMANTIC_MODERATION_SYSTEM = `You are a Korean community comment moderator for a character chat platform.
Analyze the comment IN CONTEXT. Reply with ONLY one word: ALLOW or BLOCK.

BLOCK when the comment clearly contains:
- Profanity, slurs, or personal attacks
- Attacks on AI creators / artists ("딸깍충", "프롬충", "파쿠리", insults toward creators)
- Harassment, hate, or severe toxicity

ALLOW when:
- The comment is constructive criticism, neutral, or benign
- A banned-word filter false-positive (innocent use of similar syllables)
- Mild disagreement without insults

Output exactly ALLOW or BLOCK on the first line. Optional second line: brief Korean reason.`;

/** JEV choice criteria — same ALLOW/BLOCK semantics as the Gemini system prompt. */
export const COMMENT_SEMANTIC_JEV_QUESTION_ID = "moderation_verdict";

export const COMMENT_SEMANTIC_JEV_CRITERIA = {
  ALLOW:
    "constructive criticism, benign use, false-positive banned-word context, or mild disagreement without personal attack",
  BLOCK:
    "profanity/slur, direct personal attack, AI creator/artist attack, harassment, hate, or severe toxicity",
} as const satisfies Record<CommentSemanticVerdict, string>;

export const COMMENT_SEMANTIC_JEV_INSTRUCTIONS =
  "Judge the synthetic Korean profile comment under the platform moderation policy. Choose exactly one criterion.";

export function buildCommentSemanticModerationUserPrompt(
  input: CommentSemanticModerationInput
): string {
  return `[TRIGGER: ${input.trigger}]
Matched filter terms: ${input.matchedWords.length ? input.matchedWords.join(", ") : "(none)"}
Normalized: ${input.normalized}

Original comment:
"""
${input.content}
"""

Verdict:`;
}

export function parseCommentSemanticModerationVerdict(text: string): {
  verdict: CommentSemanticVerdict;
  reason: string;
} | null {
  const first = text.trim().split(/\r?\n/)[0]?.trim().toUpperCase() ?? "";
  if (first === "ALLOW" || first.startsWith("ALLOW ")) {
    return { verdict: "ALLOW", reason: text.trim().split(/\r?\n/).slice(1).join(" ").trim() };
  }
  if (first === "BLOCK" || first.startsWith("BLOCK ")) {
    return { verdict: "BLOCK", reason: text.trim().split(/\r?\n/).slice(1).join(" ").trim() };
  }
  return null;
}

/** Bounded JEV state — comment judgment fields only; never account/session/ids. */
export function buildCommentSemanticJevState(
  input: CommentSemanticModerationInput
): Record<string, unknown> {
  return {
    content: input.content,
    normalized: input.normalized,
    matchedWords: [...input.matchedWords],
    trigger: input.trigger,
  };
}

export function buildCommentSemanticJevQuestions(): Record<
  string,
  {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
  }
> {
  return {
    [COMMENT_SEMANTIC_JEV_QUESTION_ID]: {
      type: "choice",
      instructions: COMMENT_SEMANTIC_JEV_INSTRUCTIONS,
      criteria: { ...COMMENT_SEMANTIC_JEV_CRITERIA },
    },
  };
}
