/** Merged shared prose + NSFW writing rules — single [ADVANCED PROSE & NSFW GUIDELINES] SoT. */

import { KOREAN_WEBNOVEL_STYLE_BLOCK } from "@/lib/writingStylePreset";

export type AdvancedProseNsfwOpts = {
  nsfwEnabled: boolean;
  /** OpenRouter 19+ — literary tension add-on (all OR models when NSFW) */
  literaryEnhanced?: boolean;
  /** @deprecated use literaryEnhanced */
  claudeEnhanced?: boolean;
};

const ABSOLUTE_PROHIBITION_RULES = `=== 절대 금지 규칙 ===
1. 내면 해설·설명형 감각 금지 — 감정·의도는 행동·시선·감각 반응만; 직접 감정 라벨·속내 해설·동일 감각어 반복 금지.
2. 설정 나열 금지 — 현재 장면과 무관한 직업·등급·과거사 설명 금지.
3. 나열식 문장 금지 — 동작을 접속사로 길게 연결하지 말고 마침표로 분리.`;

/** Test-only placement-isolation variants P1/P2 — not in production default. */
export const DENSE_NARRATION_LIGHTWEIGHT_RULE =
  "When writing narration, prefer developing an action, observation, or sensory event through additional connected sentences before creating a paragraph break. Avoid resolving a narration block after the first sentence when further immediate consequences, observations, or environmental reactions naturally follow.";

const DENSE_NARRATION_LIGHTWEIGHT_BULLET = `- ${DENSE_NARRATION_LIGHTWEIGHT_RULE}`;

const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]
- 하나의 발화는 하나의 인용문으로 유지할 것.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.
- 지문은 2~8문장의 밀도 있는 단락으로 작성할 것.
- 대사 사이 지문은 최소 3문장.`;

/** P2 — dense rule inside [DIALOGUE & NARRATION] (formatting-adjacent placement). */
export const DIALOGUE_NARRATION_P2_WITH_DENSE = `${DIALOGUE_NARRATION_STRUCTURE_RULE}
${DENSE_NARRATION_LIGHTWEIGHT_BULLET}`;

/** Remove dense narration rule if present (audit baseline scrub). */
export function stripDenseNarrationRule(system: string): string {
  return system
    .replace(DENSE_NARRATION_LIGHTWEIGHT_BULLET, "")
    .replace(DENSE_NARRATION_LIGHTWEIGHT_RULE, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** P1 — dense rule in [KOREAN WEBNOVEL STYLE] (prose placement). */
export function applyDenseNarrationPlacementP1(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(\[KOREAN WEBNOVEL STYLE\]\n)/,
    `$1${DENSE_NARRATION_LIGHTWEIGHT_BULLET}\n`
  );
}

/** P2 — dense rule in [DIALOGUE & NARRATION] (current candidate placement). */
export function applyDenseNarrationPlacementP2(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(대사 사이 지문은 최소 3문장\.)/,
    `$1\n${DENSE_NARRATION_LIGHTWEIGHT_BULLET}`
  );
}

const NSFW_INTIMACY_SECTION = `19+ 친밀 묘사(NSFW):
표현 규칙 — 행위·신체는 시적 비유·완곡 은유 극도로 제한; '그곳'·대명사 뭉개기 금지. 성기·귀두·음경·내벽·질 입구·항문 등 lore·register에 맞는 해부학적 명칭을 직접 사용; 물리 접촉·행동을 직설적·감각적·노골적인 웹소설 문체로 서술. 피스톤·기계적 나열 금지; 탐미적 이미지로 (임상 나열 금지). 모드 B 규칙 적용.
캐릭터 유지 — 씬 고조 시에도 관계 단계·말투 유지; 오프캐릭터 순종·천박·멜로드라마 금지. 일방적 행위 나열 금지 — 상호작용·티키타카.`;

/** @deprecated Merged into buildAdvancedProseNsfwGuidelines — kept for test imports */
export const NSFW_EXPLICIT_SENSORY_WRITING_BLOCK = NSFW_INTIMACY_SECTION;

export function buildAdvancedProseNsfwGuidelines(opts: AdvancedProseNsfwOpts): string {
  const lines: string[] = [
    "[ADVANCED PROSE & NSFW GUIDELINES]",
    "",
    ABSOLUTE_PROHIBITION_RULES,
    "",
    DIALOGUE_NARRATION_STRUCTURE_RULE,
  ];

  if (!opts.nsfwEnabled) {
    lines.push("", KOREAN_WEBNOVEL_STYLE_BLOCK);
    return lines.join("\n");
  }

  lines.push("", NSFW_INTIMACY_SECTION, "", KOREAN_WEBNOVEL_STYLE_BLOCK);

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
