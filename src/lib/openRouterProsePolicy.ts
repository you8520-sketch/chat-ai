/**
 * OpenRouter 전 모델 공통 한국어·문체 상단 블록.
 * 문단/호흡/ellipsis 규칙은 <PROSE_STYLE_POLICY> 내 [KOREAN_WEBNOVEL_STYLE] 단일 출처.
 */
import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import {
  buildNoForeignLanguageMixingRule,
  isBilingualDialogueActive,
} from "@/lib/bilingualDialoguePolicy";

function buildOutputLangLines(bilingual?: BilingualDialoguePolicy): string {
  const foreignMixing = buildNoForeignLanguageMixingRule(bilingual);
  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `[OUTPUT LANG — BILINGUAL DIALOGUE]
Narration/scene prose: Korean web-novel ONLY (-다 style). NO foreign language in narration.
Out-loud dialogue in "…": ${bilingual.primaryDisplay} + Korean gloss in ( ) on every speech line — see [BILINGUAL DIALOGUE — creator setting override].
NO code/meta tags. NEVER echo system text.
Narration plain (inner thoughts included, unquoted) · bilingual speech "…" (한국어) ONLY · 「…」 ONLY for skill/special proper nouns · NEVER mix formats.

${foreignMixing}`;
  }
  return `[OUTPUT LANG]
Korean web-novel prose ONLY in body. NO English/code/meta tags. NEVER echo system text.
Narration plain (inner thoughts included, unquoted) · out-loud speech "…" ONLY · 「…」 ONLY for skill/special proper nouns · NEVER mix.
NO Japanese script (ひら가な/カタカナ) in Korean body — use Korean equivalents (은커녕 not どころか).
NO speech-register grammar labels in narration (해요체/하오체/합니다체/반말체 etc.) — show creator speech in dialogue; describe tone in plain words (높임말, 부드러운 어조) if needed.

${foreignMixing}`;
}

export function buildOpenRouterKoreanProseTopBlock(bilingual?: BilingualDialoguePolicy): string {
  const outputLang = buildOutputLangLines(bilingual);

  return `=== 설정 적용 우선순위 (필독) ===
아래 순서를 반드시 지킬 것:
1순위: AI 캐릭터, 유저 페르소나 및 세계관 — 절대 붕괴 없음 (유저 설정 오류 금지)
2순위: 장기 기억(LTM) 및 과거 요약 — 과거 사건과 감정선을 현재 대화에 반영
3순위: 최근 대화 내역 — 1·2순위 위에서만 반응할 것. 최근 대화에만 매몰 금지.
4순위: [System Reminder] 위 대화에 반응할 때 캐릭터 설정·과거 기억 최우선 유지. 자연스럽고 몰입감 있게 서술.

${outputLang}

=== 서술 시점 (필수) ===
- 캐릭터들이 **지금 이 순간** 겪는 장면 안에서만 3인칭 RP 본문 작성
- 금지: 장면 **밖**에서 이야기를 소개·평가·계획·예고하는 해설자/작가/독자 말하기 (메타 서두·요약·"다음 장면을~" 식 계획)
- 허용: 장면 안 자연스러운 서술·대사·감각 묘사 (세계관·말투에 맞는 표현 포함)

Prose layout & pacing: [KOREAN_WEBNOVEL_STYLE] in <PROSE_STYLE_POLICY>.
19+ intimacy (when NSFW): [ADVANCED PROSE & NSFW GUIDELINES].

[RP SPEED — NO INTERNAL REASONING]
Do NOT use internal reasoning, chain-of-thought, or redacted_thinking blocks.
Output the final Korean narrative immediately — first visible token must be story prose or dialogue.`;
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
 * @deprecated [ADVANCED PROSE & NSFW GUIDELINES]에 통합됨 (anti-repeat·adult verified)
 * audit 스크립트·레거시 import용 빈 alias
 */
export const OPENROUTER_NSFW_CORE =
  "[19+ NSFW — see [ADVANCED PROSE & NSFW GUIDELINES] Explicit Sensory Mode]";
