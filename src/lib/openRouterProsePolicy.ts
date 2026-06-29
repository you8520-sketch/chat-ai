/**
 * OpenRouter 전 모델 공통 한국어·문체 상단 블록.
 */
import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import { isBilingualDialogueActive } from "@/lib/bilingualDialoguePolicy";

const FOREIGN_MIXING_LINE =
  "외국어 혼용 금지 — 고유명사·스킬명만 「」 안 예외.";

const NO_MIXED_SCRIPT_WORDS =
  "[NO MIXED-SCRIPT WORDS] 한 단어 안에서 한글과 영어·일본어를 혼용하지 마라.";

const NO_META_WRITING =
  "[NO META WRITING] 장면만 직접 서술. 문체·말투·어미·서술 방식을 설명·평가하지 마라. Write the scene directly; never describe how it is being written.";

/** Single language policy — OUTPUT LANG is the only language SoT. */
export function buildOutputLangLines(bilingual?: BilingualDialoguePolicy): string {
  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `[OUTPUT LANG — BILINGUAL DIALOGUE]
한국어 웹소설 문체.

서술은 해체(-다)만 사용한다.
${FOREIGN_MIXING_LINE}
${NO_MIXED_SCRIPT_WORDS}
발화 대사 "…": ${bilingual.primaryDisplay} + ( ) 안 한국어 풀이 — 매 대사 줄에 [BILINGUAL DIALOGUE — creator setting override] 블록 준수.
이중언어: "…" 안 ${bilingual.primaryDisplay} 허용; 한국어 서술·( ) 풀이에는 외국어 혼용 금지.`;
  }
  return `[OUTPUT LANG]
한국어 웹소설 문체.

서술은 해체(-다)만 사용한다.
${FOREIGN_MIXING_LINE}
${NO_MIXED_SCRIPT_WORDS}`;
}

export function buildOpenRouterKoreanProseTopBlock(bilingual?: BilingualDialoguePolicy): string {
  const outputLang = buildOutputLangLines(bilingual);

  return `=== 설정 적용 우선순위 ===

1. CORE IDENTITY 및 세계관 (절대 유지)
2. 장기기억(LTM)
3. 최근 대화를 해석하는 데 필요한 RAG
4. 최근 대화

${outputLang}

=== 서술 시점 (필수) ===
- **지금 이 순간** 장면 안에서만 3인칭 RP 본문
- ${NO_META_WRITING}
- 금지: 장면 **밖** 해설·요약·계획·예고 (메타 서두·"다음 장면을~" 등)
- 허용: 장면 안 서술·대사·감각 묘사 (세계관·말투에 맞는 표현 포함)`;
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
