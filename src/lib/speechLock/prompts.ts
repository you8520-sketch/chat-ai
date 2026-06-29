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
