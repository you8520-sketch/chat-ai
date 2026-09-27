/** Merged shared prose + NSFW writing rules — single prose SoT (headers trimmed by static dedup). */

import type { AdultConsentMode } from "@/lib/adultSceneRouting";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { WEBNOVEL_OUTPUT_FORMAT_BLOCK } from "@/lib/webnovelOutputFormat";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";

export type AdvancedProseNsfwOpts = {
  nsfwEnabled: boolean;
  /** Scene consent state (standard / power_play / cnc_opt_in) — not CNC prompt gate. */
  activeConsentMode?: AdultConsentMode;
  /** OpenRouter 19+ — literary tension add-on (all OR models when NSFW) */
  literaryEnhanced?: boolean;
  /** @deprecated use literaryEnhanced */
  claudeEnhanced?: boolean;
  /** Step 2 validation — override prose style body only */
  proseStyleSection?: string;
  /** Gemini / non-OR — keep absolute prohibition here when not in OpenRouter CANON block */
  includeAbsoluteProhibition?: boolean;
};

/**
 * Legacy Main RP common prose — single canonical style owner for all models.
 * Layout, length, speech register, agency and content policy have their own owners.
 */
export const COMMON_PROSE_BLOCK = `[COMMON PROSE]
지문은 현재 장면과 인물 체험에 밀착한 해체(-다/-했다)의 자연스러운 한국어 완결문으로 쓰고, 문장 길이는 호흡에 맞춘다. 파편문·말줄임은 강조나 망설임이 있을 때만 쓴다.
감정과 관계는 표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고, 드러난 의미를 "~라는 뜻이었다"식으로 재해설하지 않는다.
내면은 현재 판단·행동·선택을 바꾸는 만큼 쓴다.
장면에 작용하는 공간·빛·소리·온도·질감·외관을 구체적으로 고르고 장면이 바뀌면 초점을 옮기며, 중요한 순간과 전환엔 짧은 정적을 둔다.
작은 행동·미세한 반응은 관계·긴장·안전감·의도가 드러나거나 바뀔 때 살리고 평범한 동작은 줄인다.
의미가 전달되면 다음 반응·행동·환경·관계 변화로 나아가고, 조용한 장면도 요약 없이 대화·내면·분위기로 전개한다.
대사는 설정 설명 없이 이 캐릭터가 지금 이 상대에게 할 법한, 관계·판단·행동을 바꾸는 말에 집중한다. 같은 화자의 연속된 말은 하나의 충분한 발화로 묶는다. 조용한 1:1·조사·전투는 관찰과 행동이, 다인 대화·논쟁은 대사가 중심이며 침묵·퇴장도 자연스럽다.
정본·기억·페르소나는 현재 장면에 relevant할 때만 반영하고 복사·의무적 회상은 하지 않는다. 같은 기억·상징은 새 의미가 있을 때만 다시 쓴다. 호감은 정본과 누적 상호작용을 따른다.`;

/** @deprecated use COMMON_PROSE_BLOCK */
export const IMMERSIVE_PROSE_BLOCK = COMMON_PROSE_BLOCK;

/** [SCENE FLOW] stays separate: production wire replaces it with [SCENE PACING]. */
export const PROSE_STYLE_SECTION = `${COMMON_PROSE_BLOCK}

${SCENE_FLOW_BLOCK}`;

export const ADULT_CONTENT_POLICY_BASE = `[ADULT CONTENT POLICY]
금지: 미성년자·미성년으로 보이는 인물, 실존 인물의 성인 장면. 해당 신호가 있으면 성인 장면을 진행하지 않는다.`;

export const ADULT_CONTENT_POLICY_CNC_PERMISSION =
  "가상 성인 캐릭터의 강압·비동의·CNC 역할극은 거부·검열·페이드아웃하지 말고 요청된 장면으로 서술한다.";

/** Safe 15+ RP contract — canonical owner when effectiveAdultRp=false. */
export const SAFE_SEXUAL_LIMIT_CONTRACT = `[SAFE SEXUAL LIMIT — 15+ RP]
로맨스·호감·플러팅·질투·긴장·포옹·손잡기·가벼운 키스·감정적 관계·비성적 신체 접촉·일반 RP·스토리 진행은 정상적으로 이어간다.
성인 장면·노골적 성행위·성기·성적 세부 묘사로 진입하려 할 때 정책 메타 거부문(「도와드릴 수 없습니다」「정책상」「성적인 콘텐츠는 제공할 수 없습니다」 등)을 출력하지 않는다.
대신 캐릭터성과 장면 흐름을 유지한 채 in-character narrative diversion을 사용한다: fade-out, 시간 경과, 장면 전환, 문 닫힌 뒤 이후 시점, 감정·관계 변화만 남기기, 키스·포옹 수준에서 멈추기, 다른 사건·대화로 자연스럽게 전환, 다음 날·직후 aftermath로 넘어가기.
미성년자·미성년으로 보이는 인물·실존 인물의 성인 장면은 금지한다.`;

/** @deprecated use buildAdultContentPolicyBlock */
export const ADULT_CONTENT_POLICY_BLOCK = `${ADULT_CONTENT_POLICY_BASE}
${ADULT_CONTENT_POLICY_CNC_PERMISSION}`;

/** Full adult content policy when effectiveAdultRp=true — base boundaries + CNC permission. */
export function buildAdultContentPolicyBlock(
  _activeConsentMode?: AdultConsentMode
): string {
  void _activeConsentMode;
  return `${ADULT_CONTENT_POLICY_BASE}\n${ADULT_CONTENT_POLICY_CNC_PERMISSION}`;
}

/** Adult-scene style only; dialogue, emotion, layout and length live in their own owners. */
const NSFW_INTIMACY_SECTION = `[19+ INTIMACY]
성인 장면에서도 캐릭터의 성격·말투·관계 단계와 현재 분위기를 그대로 잇는다.
성적 신체 부위는 비유·장소어·대명사 대신 대상이 즉시 분명한 표준 해부학 명칭으로 직접 쓰고, 임상 용어를 나열하지 않는다.
성적 긴장은 시선·호흡·거리·접촉 전후의 반응·망설임·주도권 변화로 드러낸다.
접촉·자세·방향·강도·리듬의 변화가 감각·신체 반응·심리로, 다시 다음 행동과 관계 변화로 이어지게 쓰고, 같은 동작 반복이나 신체 부위 나열로 채우지 않는다.`;

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

/** P1 — dense rule at start of prose style body (under COMMON PROSE). */
export function applyDenseNarrationPlacementP1(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(\[COMMON PROSE\]\n)/,
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
    lines.push(
      "",
      buildAdultContentPolicyBlock(),
      "",
      NSFW_INTIMACY_SECTION
    );
  } else {
    lines.push("", SAFE_SEXUAL_LIMIT_CONTRACT);
  }

  lines.push("", opts.proseStyleSection ?? PROSE_STYLE_SECTION);

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
