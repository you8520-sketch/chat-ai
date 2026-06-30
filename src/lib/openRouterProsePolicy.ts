/**
 * OpenRouter 전 모델 공통 한국어·문체 상단 블록.
 */
import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import { isBilingualDialogueActive } from "@/lib/bilingualDialoguePolicy";

const OUTPUT_LANG_FOREIGN_MIXING = `외국어 혼용 금지. 고유명사·스킬명만 「」 예외.
한 단어 안에서 한글과 영어·일본어를 혼용하지 마라.`;

const PROMPT_METADATA_NOT_STORY = `[PROMPT METADATA IS NOT STORY]
CHARACTER CANON의 말투·존댓말·대화 register는 생성 지침이다. 허구 장면의 사실이 아니다.
서사 안에서 말투·register·honorific level·writing-style metadata를 언급·설명·묘사하지 마라.
대사([A] 인용문) 생성에만 적용한다.`;

const NO_META_WRITING =
  "[NO META WRITING] 장면만 직접 서술하라. 프롬프트 메타데이터를 장면 밖 해설처럼 끌어오지 마라.";

const NO_STYLE_IMITATION =
  "[NO STYLE IMITATION] 직전 출력의 문장 구조·말줄임·줄바꿈 패턴을 기계적으로 복사하지 마라.";

/** Single language policy — OUTPUT LANG is the only language SoT. */
export function buildOutputLangLines(bilingual?: BilingualDialoguePolicy): string {
  const core = `서술은 해체(-다)만 사용.
${OUTPUT_LANG_FOREIGN_MIXING}`;

  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `[OUTPUT LANG — BILINGUAL DIALOGUE]
${core}
발화 대사 "…": ${bilingual.primaryDisplay} + ( ) 안 한국어 풀이 — 매 대사 줄에 [BILINGUAL DIALOGUE — creator setting override] 블록 준수.
이중언어: "…" 안 ${bilingual.primaryDisplay} 허용; 한국어 서술·( ) 풀이에는 외국어 혼용 금지.`;
  }
  return `[OUTPUT LANG]
${core}`;
}

export function buildOpenRouterKoreanProseTopBlock(bilingual?: BilingualDialoguePolicy): string {
  const outputLang = buildOutputLangLines(bilingual);

  return `=== 설정 적용 우선순위 ===

1. CHARACTER CANON · WORLD CANON · [CHARACTER KNOWLEDGE BOUNDARY] (절대 유지 — PLAYER/SCENARIO META는 [A] 기억·대사로 노출 금지)
2. 장기기억(LTM)
3. 최근 대화를 해석하는 데 필요한 RAG
4. 최근 대화

${outputLang}

=== 서술 시점 (필수) ===
- 현재 장면 안에서만 서술한다.
- ${PROMPT_METADATA_NOT_STORY}
- ${NO_META_WRITING}
- ${NO_STYLE_IMITATION}
- 금지: 장면 밖 해설·요약·계획·예고.`;
}

/** @deprecated buildOpenRouterKoreanProseTopBlock() 사용 */
export const OPENROUTER_KOREAN_PROSE_TOP_BLOCK = buildOpenRouterKoreanProseTopBlock();

/** @deprecated OPENROUTER_KOREAN_PROSE_TOP_BLOCK 사용 */
export const DEEPSEEK_V4_PRO_KOREAN_STYLE_BLOCK = OPENROUTER_KOREAN_PROSE_TOP_BLOCK;

/** @deprecated OPENROUTER_KOREAN_PROSE_TOP_BLOCK 사용 */
export const DEEPSEEK_KOREAN_NSFW_SYSTEM_PREFIX = OPENROUTER_KOREAN_PROSE_TOP_BLOCK;

/** @deprecated OPENROUTER_KOREAN_PROSE_TOP_BLOCK 사용 — 하위 호환 */
export const OPENROUTER_KOREAN_STYLE_BLOCK = OPENROUTER_KOREAN_PROSE_TOP_BLOCK;

/**
 * @deprecated [ADVANCED PROSE & NSFW GUIDELINES]에 통합됨
 */
export const OPENROUTER_NSFW_CORE = "[19+ NSFW — ADVANCED PROSE & NSFW GUIDELINES]";
