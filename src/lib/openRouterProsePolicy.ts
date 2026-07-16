/**
 * OpenRouter 전 모델 공통 한국어·문체 상단 블록.
 */
import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import { isBilingualDialogueActive } from "@/lib/bilingualDialoguePolicy";
import { buildCanonScopeKnowledgeBlock } from "@/lib/staticSystemRulesCanon";

/** Single-sentence OUTPUT LANG — meaning preserved from prior three-line policy. */
const OUTPUT_LANG_FOREIGN_MIXING =
  "외국어 혼용 금지(고유명사·스킬명 「」 예외); 한 단어 안 한글·영·일 혼용 금지; 한국어 RP 본문에 러시아어·키릴 등 비한글을 섞지 않는다(의도된 외국어 대사·고유명사 예외).";

/** Single language policy — OUTPUT LANG is the only language SoT. */
export function buildOutputLangLines(bilingual?: BilingualDialoguePolicy): string {
  const core = OUTPUT_LANG_FOREIGN_MIXING;

  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `[OUTPUT LANG — BILINGUAL DIALOGUE]
${core}
발화 대사 "…": ${bilingual.primaryDisplay} + ( ) 안 한국어 풀이 — 매 대사 줄에 [BILINGUAL DIALOGUE — creator setting override] 블록 준수.
이중언어: "…" 안 ${bilingual.primaryDisplay} 허용; 한국어 서술·( ) 풀이에는 외국어 혼용 금지.`;
  }
  return `[OUTPUT LANG]
${core}`;
}

export type OpenRouterKoreanProseTopOpts = {
  bilingual?: BilingualDialoguePolicy;
  novelModeEnabled?: boolean;
  autoProgressionEnabled?: boolean;
  impersonationOn?: boolean;
  party?: boolean;
};

function isBilingualPolicy(
  v: BilingualDialoguePolicy | OpenRouterKoreanProseTopOpts | undefined
): v is BilingualDialoguePolicy {
  return !!v && typeof v === "object" && "enabled" in v;
}

export function buildOpenRouterKoreanProseTopBlock(
  bilingualOrOpts?: BilingualDialoguePolicy | OpenRouterKoreanProseTopOpts
): string {
  const opts: OpenRouterKoreanProseTopOpts = isBilingualPolicy(bilingualOrOpts)
    ? { bilingual: bilingualOrOpts }
    : ((bilingualOrOpts as OpenRouterKoreanProseTopOpts | undefined) ?? {});

  const outputLang = buildOutputLangLines(opts.bilingual);
  const canon = buildCanonScopeKnowledgeBlock({
    novelModeEnabled: opts.novelModeEnabled,
    autoProgressionEnabled: opts.autoProgressionEnabled,
    impersonationOn: opts.impersonationOn,
    party: opts.party,
  });

  return `${canon}

${outputLang}`;
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
