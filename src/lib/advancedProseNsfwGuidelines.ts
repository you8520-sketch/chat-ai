/** Merged shared prose + NSFW writing rules — single prose SoT (headers trimmed by static dedup). */

import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK } from "@/lib/webnovelOutputFormat";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";

export type AdvancedProseNsfwOpts = {
  nsfwEnabled: boolean;
  /** OpenRouter 19+ — literary tension add-on (all OR models when NSFW) */
  literaryEnhanced?: boolean;
  /** @deprecated use literaryEnhanced */
  claudeEnhanced?: boolean;
  /** Step 2 validation — override prose style body only */
  proseStyleSection?: string;
  /** Gemini / non-OR — keep absolute prohibition here when not in OpenRouter CANON block */
  includeAbsoluteProhibition?: boolean;
};

export const PROSE_STYLE_SECTION = `[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.

${GENERATION_PROCESS_BEAT_FLOW_BLOCK}

[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
짧은 문장은 강조·충격·급박한 순간에만 선택적으로 쓰고, 같은 길이 문장만 연달아 쓰지 않는다 — 같은 행동·감각 초점은 한 문단에서 이어 가며, 의도적 강조가 아닌 「천천히.」「뜨거웠다.」「검은 텀블러.」형 파편은 완결 문장에 통합한다.
문장 길이 리듬과 문단 분리는 별개다.

[SENSATION]
촉·손·접촉·온기 묘사의 단일 Owner. 장면에 맞게 1~2채널만 깊게 — 질감·공간·온도·소리·대비·방향·거리.
깊이는 밀도가 아니라 구체성이다.

[EMOTION]
감정 이름·해석·결론 없이, 행동·호흡·속도·선택·거리 변화로만 드러낸다.
강할수록 더 천천히 — 강도와 속도는 반비례.

[MOVEMENT & SPACE]
움직임은 공간·거리·방향·결과가 독자에게 자연스럽게 전달되도록 쓴다.
연속된 신체 동작·접촉·감각·반응은 동작마다 독립 문장으로 쪼개지 말고, 하나의 흐름이면 같은 문단에서 자연스럽게 묶는다.
긴장도가 높은 장면에서도 위치·거리 변화를 미세 동작 단위로 기계적 안무처럼 나열하지 말고, 같은 주어로 시작하는 짧은 문장의 연속 반복을 피한다.

[WEBNOVEL BREATH]
pause·여운·턴 끝 호흡의 단일 Owner.
중요 순간 직전: 지문 한 박 pause(공간·온도·소리).
전환·분기: 공간·시간·분위기 한 줄 리셋.`;

const NSFW_INTIMACY_SECTION = `[19+ INTIMACY]
lore·해부학적 명칭 register에 맞게. 모호한 지칭('그곳'·대명사 뭉개기)·과도한 완곡어·임상 나열 금지.
기계적 피스톤 나열 금지. 상호작용·티키타카.
씬 고조 시에도 관계 단계·대사 말투 유지; 오프캐릭터 순종·멜로드라마 금지.`;

const ABSOLUTE_PROHIBITION_RULES = `=== 절대 금지 규칙 ===
현재 장면과 무관한 직업·등급·과거사·설정 나열 금지.`;

/** Test-only placement-isolation variants P1/P2 — not in production default. */
export const DENSE_NARRATION_LIGHTWEIGHT_RULE =
  "Keep the same subject's immediate action and its direct result in one narration paragraph; start a new paragraph when subject, emotion direction, inner↔outer focus, spatial focus, or scene stage changes. Do not break by sentence count, and do not merge distinct beats into one giant paragraph.";

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

/** P1 — dense rule at start of prose style body (under NARRATION REGISTER). */
export function applyDenseNarrationPlacementP1(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(\[NARRATION REGISTER\]\n)/,
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
  const lines: string[] = [WEBNOVEL_OUTPUT_FORMAT_BLOCK];

  if (opts.includeAbsoluteProhibition) {
    lines.push("", ABSOLUTE_PROHIBITION_RULES);
  }

  if (opts.nsfwEnabled) {
    lines.push("", NSFW_INTIMACY_SECTION);
  }

  lines.push("", opts.proseStyleSection ?? PROSE_STYLE_SECTION);

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
