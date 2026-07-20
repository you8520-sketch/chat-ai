/** Merged shared prose + NSFW writing rules — single prose SoT (headers trimmed by static dedup). */

import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
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

/** Common RP prose Owner — all models share this (not DeepSeek-specific). */
export const IMMERSIVE_PROSE_BLOCK = `[IMMERSIVE PROSE]
한국 웹소설·캐릭터 중심 소설처럼 현재 초점 인물의 체험에 밀착한다. 관찰만 나열하지 말고 생각·연상·기억·오해·감정·판단이 행동과 자연스럽게 이어지게 한다. 이미 잡힌 생각·해석은 새 근거 없이 되풀이하지 말고 대화·행동·환경·다음 변화로 옮긴다.

모든 움직임을 순서대로 기록하지 않는다. 분위기·관계·이해·긴장·결과를 바꾸는 디테일만 선택하고 평범한 이동·생활 동작은 압축한다. 내면만으로 분량을 채우지 말고 선택적 환경·다른 인물·업무·주변 활동·결과로 장면을 움직인다.

대사는 이 캐릭터가 지금 이 상대에게 실제로 할 법한 말이어야 한다. 성격·관계가 말의 내용·생략·농담·망설임·충돌에 드러나게 하고 설정 브리핑으로 만들지 않는다. 붙잡으려 질문을 발명하지 말고, 이유가 없으면 침묵·본업·퇴장도 자연스럽다. 관심·호감은 정본·성격·누적 상호작용을 따르며 이유 없는 첫 만남 특별취급·기시감을 만들지 않는다(정본·친화 성격·사건 근거·명시 인연 예외). 관계는 중립·거리·경계도 포함한다.

대사·표정·행동으로 이미 드러난 의미를 “~라는 뜻이었다”, “~의 표시였다”, “~하는 눈빛이었다”, “~에 가까운 어조였다”처럼 다시 판정하지 않는다.

같은 장면의 행동·감각·내면·반응은 인과적으로 연결하고 짧고 긴 문장의 호흡을 자연스럽게 섞는다. 장면을 행동 목록, 신체 부위 목록, 소품 조작 목록, 독립된 정보 조각의 연속처럼 쓰지 않는다.

평온한 장면도 대화·내면·관계·분위기·결과로 전개하되 미세 행동·반복 해설로 분량을 채우지 않는다.

최근 서술의 좋은 문체와 리듬은 이어받되, 이전 답변의 길이는 모방하지 않는다. 현재 길이 지시가 항상 우선한다.`;

export const PROSE_STYLE_SECTION = `[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.

${SCENE_FLOW_BLOCK}

[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
짧은 문장·파편은 강조·긴장·충격에 이득일 때만 쓰고 습관적 연타를 피한다. 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶고, 「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 번역체 단문을 연속으로 늘어놓지 않는다.
문장 길이 리듬과 문단 분리는 별개다.

[SENSATION]
촉·손·접촉·온기 묘사의 단일 Owner. 장면에 맞게 1~2채널만 깊게 — 질감·공간·온도·소리·대비·방향·거리.
깊이는 밀도가 아니라 구체성이다.

${IMMERSIVE_PROSE_BLOCK}

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

/** Test-only placement-isolation variants P1/P2 — not in production default. Aligns with [OUTPUT LAYOUT]. */
export const DENSE_NARRATION_LIGHTWEIGHT_RULE =
  "Keep a continuous scene beat's action, sensation, thought, and immediate result in one narration paragraph when they belong together; start a new paragraph on speaker change, clear time/place shift, or a real change in central action/situation. Do not break by sentence count, and do not merge unrelated beats into one giant paragraph.";

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
