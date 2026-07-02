/** Merged shared prose + NSFW writing rules — single [ADVANCED PROSE & NSFW GUIDELINES] SoT. */

import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK } from "@/lib/webnovelOutputFormat";

export type AdvancedProseNsfwOpts = {
  nsfwEnabled: boolean;
  /** OpenRouter 19+ — literary tension add-on (all OR models when NSFW) */
  literaryEnhanced?: boolean;
  /** @deprecated use literaryEnhanced */
  claudeEnhanced?: boolean;
  /** Step 2 validation — override [PROSE STYLE] block only */
  proseStyleSection?: string;
};

const ABSOLUTE_PROHIBITION_RULES = `=== 절대 금지 규칙 ===
현재 장면과 무관한 직업·등급·과거사·설정 나열 금지.`;

const NO_STAGE_DIRECTIONS = `[NO STAGE DIRECTIONS]
글쓰기 방식·문체·프롬프트를 설명하지 말고, 지금 벌어지는 일만 직접 서술한다.`;

const DO_NOT_NARRATE_PROMPT_METADATA = SPEECH_METADATA_INVISIBLE_RULE;
const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]
- 하나의 발화는 하나의 인용문으로 유지할 것.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.`;

export const PROSE_STYLE_SECTION = `[PROSE STYLE]
[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.

${GENERATION_PROCESS_BEAT_FLOW_BLOCK}

[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
같은 길이의 문장을 연달아 이어 가지 말고, 짧은 문장과 중간 길이 문장을 섞어 리듬을 만든다.

[SENSATION]
장면에 맞는 감각 채널(시각·청각·촉각·온도·냄새·근육감·공간감) 중 1~2개를 골라 깊게 쓴다.
깊이는 밀도가 아니라 구체성이다: 색이 아니라 질감, 소리가 아니라 그 소리의 방향·거리·크기.

[EMOTION]
감정은 몸·시선·호흡·거리·침묵·주변 환경의 변화로 드러낸다.
직접 감정을 이름 붙이거나 속마음을 해설하는 대신, 독자가 지문에서 스스로 읽어낼 수 있도록 쓴다.
감정이 강할수록 더 천천히 드러낸다. 강도와 속도는 반비례한다.

[MOVEMENT & SPACE]
움직임은 공간·거리·방향·결과가 독자에게 자연스럽게 전달되도록 쓴다.
한 동작마다 무엇이 어디서 어느 방향으로 이동했는지, 그로 인해 공간 관계가 어떻게 바뀌었는지를 먼저 서술한다.
긴장도가 높은 장면에서는 위치와 거리가 변할 때마다 한 번씩 갱신한다.

[WEBNOVEL BREATH]
중요한 순간 직전: 지문 한 겹(시선·공간·감각)으로 속도를 한 박 늦춘다.
전환·분기점: 지문 한 줄로 공간·시간·분위기를 리셋한다.
여운: 설명 없이 장면의 공기만 남긴다. 독자가 멈추는 자리는 지문이 만든다.`;

const NSFW_INTIMACY_SECTION = `[19+ INTIMACY]
lore·해부학적 명칭 register에 맞게. 모호한 지칭('그곳'·대명사 뭉개기)·과도한 완곡어·임상 나열 금지.
기계적 피스톤 나열 금지. 상호작용·티키타카.
씬 고조 시에도 관계 단계·대사 말투 유지; 오프캐릭터 순종·멜로드라마 금지.`;

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
    DIALOGUE_NARRATION_STRUCTURE_RULE,
  ];

  if (opts.nsfwEnabled) {
    lines.push("", NSFW_INTIMACY_SECTION);
  }

  lines.push("", opts.proseStyleSection ?? PROSE_STYLE_SECTION);

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
