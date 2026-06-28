/** Unified Korean webnovel prose — single style for all models (no user presets). */

export const KOREAN_WEBNOVEL_STYLE_BLOCK = `[KOREAN WEBNOVEL STYLE]
서술: 해체(-다/-했다/-이었다)만; 번역투·과도한 쉼표 나열·명사 단편 행 금지; 말줄임 ... 허용(...... 금지, 턴당 ~3).
모드 A (일상·텐션): 미세 행동·소품·환경을 시네마틱으로 치밀하게 — 감정·텐션 증폭.
모드 B (19금 접촉): 슬로 모션 — 짧은 유저 대사도 턴 넘기지 말고 한 동작을 (1)해부학적 마찰·감각 (2)근육·땀 반응 (3)구도·공간음 (4)에스컬레이션으로 4단 팽창.`;

/** @deprecated Use KOREAN_WEBNOVEL_STYLE_BLOCK */
export const KOREAN_WEBNOVEL_STYLE = KOREAN_WEBNOVEL_STYLE_BLOCK;

/** @deprecated Merged into [KOREAN WEBNOVEL STYLE] Mode A/B */
export const DYNAMIC_PROSE_STYLING_BLOCK = KOREAN_WEBNOVEL_STYLE_BLOCK;

/** @deprecated Use KOREAN_WEBNOVEL_STYLE_BLOCK */
export const UNIFIED_WEBNOVEL_STYLE_BLOCK = KOREAN_WEBNOVEL_STYLE_BLOCK;

/** @deprecated Use KOREAN_WEBNOVEL_STYLE_BLOCK */
export const KOREAN_WEBNOVEL_FORMAT_RULES = KOREAN_WEBNOVEL_STYLE_BLOCK;

/** @deprecated Presets removed — always unified style */
export function normalizeCreatorRecommendedStyle(_value: unknown): "balanced" {
  return "balanced";
}
