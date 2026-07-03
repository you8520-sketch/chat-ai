import type { SpeechProfile } from "./types";

/** 말투 위반 감지 시 — 응답 재작성 요청 (validator 경로 전용) */
export function buildSpeechRewriteUserMessage(
  profile: SpeechProfile,
  violations: { type: string; matched: string[]; excerpt: string }[]
): string {
  const issues = violations
    .slice(0, 6)
    .map((v) => `- [${v.type}] "${v.matched.join(", ")}" in: ${v.excerpt.slice(0, 120)}`)
    .join("\n");

  return `[SPEECH LOCK REWRITE]
Rewrite ONLY dialogue style. Preserve plot, actions, meaning.
Match creator speech examples exactly.
Output rewritten response only.

Violations:
${issues}`;
}

/** Group A — register lexicon leaked into narration */
export function buildNarrationLexiconRewriteUserMessage(hits: string[]): string {
  return `[NARRATION LEXICON REWRITE]
The previous response named speech register in narration (forbidden).
Remove ALL register labels from narration: ${hits.slice(0, 6).join(", ")}.
Do NOT describe honorific level, speech register, or tone labels in story text.
Show register only through quoted dialogue and action — never label it.
Preserve plot, dialogue meaning, and paragraph layout.
Output the full rewritten response only.`;
}
