/** Merged shared prose + NSFW writing rules — single [ADVANCED PROSE & NSFW GUIDELINES] SoT. */

import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK } from "@/lib/webnovelOutputFormat";

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

const NO_STAGE_DIRECTIONS = `[NO STAGE DIRECTIONS]
아무것도 설명하지 마라. 지금 벌어지는 일만 직접 서술한다.
글쓰기 방식·문체·감정·대사·서술 방식을 설명·평가하지 마라.
장면 자체만 서술한다.`;

const NO_ABSTRACT_SUMMARIES = `[NO ABSTRACT SUMMARIES]
순간을 요약하지 마라. 행동·대사·몸짓·감각 디테일로 직접 묘사한다.`;

const NATURAL_PROSE = `[NATURAL PROSE]
Vary sentence length naturally.
Avoid repetitive rhythm.`;

const SHOW_BEFORE_TELL = `[SHOW BEFORE TELL]
Prefer actions, sensations, and atmosphere before explanation.`;

const NO_TEMPLATE_WRITING = `[NO TEMPLATE WRITING]
Do not reuse the same reaction patterns, paragraph rhythm, or sentence structures across turns.`;

const DO_NOT_NARRATE_PROMPT_METADATA = SPEECH_METADATA_INVISIBLE_RULE;

const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]
- 하나의 발화는 하나의 인용문으로 유지할 것.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.`;

export const PROSE_STYLE_SECTION = `[PROSE STYLE]
서술: 해체(-다/-했다/-이었다)만; 번역투·과도한 쉼표 나열·명사 단편 행 금지; 말줄임 ... 허용(...... 금지, 턴당 ~3).
일상·대화: 미세 행동·소품·환경을 구체적으로 — 분위기·긴장감은 행동·감각으로.
긴장·고조: 반응·호흡·시선·거리·침묵을 촘촘히 — 감정 라벨 대신 신체·환경 반응.`;

const NSFW_INTIMACY_SECTION = `[19+ INTIMACY]
lore·register에 맞는 해부학적 명칭을 사용한다. 모호한 지칭('그곳'·대명사 뭉개기)·과도한 완곡어·임상 나열 금지.
행위·접촉은 직설적·감각적으로; 기계적 피스톤 나열 금지. 상호작용·티키타카.
씬 고조 시에도 관계 단계·말투 유지; 오프캐릭터 순종·멜로드라마 금지.
친밀 접촉: 슬로 모션 — 한 동작을 마찰·감각·근육·구도·공간·에스컬레이션 순으로 팽창.`;

/** Test-only placement-isolation variants P1/P2 — not in production default. */
export const DENSE_NARRATION_LIGHTWEIGHT_RULE =
  "When writing narration, prefer developing an action, observation, or sensory event through additional connected sentences before creating a paragraph break. Avoid resolving a narration block after the first sentence when further immediate consequences, observations, or environmental reactions naturally follow.";

const DENSE_NARRATION_LIGHTWEIGHT_BULLET = `- ${DENSE_NARRATION_LIGHTWEIGHT_RULE}`;

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

/** P1 — dense rule in [PROSE STYLE] (prose placement). */
export function applyDenseNarrationPlacementP1(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(\[PROSE STYLE\]\n)/,
    `$1${DENSE_NARRATION_LIGHTWEIGHT_BULLET}\n`
  );
}

/** P2 — dense rule in [DIALOGUE & NARRATION] (formatting-adjacent placement). */
export function applyDenseNarrationPlacementP2(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것\.)/,
    `$1\n${DENSE_NARRATION_LIGHTWEIGHT_BULLET}`
  );
}

/** @deprecated Merged into buildAdvancedProseNsfwGuidelines — kept for test imports */
export const NSFW_EXPLICIT_SENSORY_WRITING_BLOCK = NSFW_INTIMACY_SECTION;

export function buildAdvancedProseNsfwGuidelines(opts: AdvancedProseNsfwOpts): string {
  const lines: string[] = [
    "[ADVANCED PROSE & NSFW GUIDELINES]",
    "",
    WEBNOVEL_OUTPUT_FORMAT_BLOCK,
    "",
    ABSOLUTE_PROHIBITION_RULES,
    "",
    NO_STAGE_DIRECTIONS,
    "",
    DO_NOT_NARRATE_PROMPT_METADATA,
    "",
    NO_ABSTRACT_SUMMARIES,
    "",
    NATURAL_PROSE,
    "",
    SHOW_BEFORE_TELL,
    "",
    NO_TEMPLATE_WRITING,
    "",
    DIALOGUE_NARRATION_STRUCTURE_RULE,
  ];

  if (opts.nsfwEnabled) {
    lines.push("", NSFW_INTIMACY_SECTION);
  }

  lines.push("", PROSE_STYLE_SECTION);

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
