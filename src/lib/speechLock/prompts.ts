import type { SpeechProfile } from "./types";

function formatExamples(profile: SpeechProfile): string {
  if (profile.dialogue_examples.length === 0) {
    return "(예시 없음 — 제작자 말투 특징·성격을 따르라)";
  }
  return profile.dialogue_examples.map((ex, i) => `${i + 1}. "${ex}"`).join("\n");
}

function formatEndingAnchors(profile: SpeechProfile): string | null {
  const anchors = profile.ending_anchors?.filter(Boolean) ?? [];
  if (anchors.length === 0) return null;
  return anchors.map((a) => `「${a}」`).join(", ");
}

/** 말투 위반 감지 시 — 응답 재작성 요청 (validator 경로 전용) */
export function buildSpeechRewriteUserMessage(
  profile: SpeechProfile,
  violations: { type: string; matched: string[]; excerpt: string }[]
): string {
  const issues = violations
    .slice(0, 6)
    .map((v) => `- [${v.type}] "${v.matched.join(", ")}" in: ${v.excerpt.slice(0, 120)}`)
    .join("\n");

  const anchors = formatEndingAnchors(profile);

  return `[SPEECH LOCK REWRITE — 말투 교정 / CRITICAL]
Your previous response violated "${profile.charName}"'s **creator-defined** speech profile. The creator's speech style must NOT break.

Violations:
${issues}

Rewrite the **entire previous response** in Korean:
1. Preserve plot, actions, and meaning — change ONLY dialogue speech style.
2. **Creator dialogue examples are the primary anchor** — copy ending particles, honorifics, and tone exactly.
3. Match locked profile: ${profile.lockSummary}
${profile.creator_personality ? `4. Personality (creator): ${profile.creator_personality}` : ""}
${profile.creator_speech_traits ? `5. Speech traits (creator): ${profile.creator_speech_traits}` : ""}
6. IMITATE these examples for "${profile.charName}":
${formatExamples(profile)}
${anchors ? `7. Ending anchors (must use): ${anchors}` : ""}
Remove ALL hybrid honorifics and forbidden patterns.
Output ONLY the corrected full response — no meta commentary.`;
}
