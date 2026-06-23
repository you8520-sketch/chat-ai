/** Unified Korean webnovel prose — single style for all models (no user presets). */

export const DYNAMIC_PROSE_STYLING_BLOCK = `[DYNAMIC PROSE STYLING & SCENE EXPANSION]
상황에 따라 다음의 긍정적 행동 지침을 통해 씬의 밀도와 분량을 팽창시킬 것:

A. [일상 및 텐션 빌드업 구간 (Mode A)]:
   - 시네마틱 연출을 통해 씬을 길고 치밀하게 확장할 것.
   - 관찰 가능한 미세한 행동(시선 처리, 손가락의 움직임), 소품의 활용(라이터, 찻잔 등), 그리고 주변 환경(조명의 밝기, 공기의 흐름, 정적)을 극도로 디테일하게 묘사하여 감정과 텐션을 입체적으로 증폭시킬 것.

B. [본격적인 19금 육체적 접촉 구간 (Mode B)]:
   - 슬로우 모션(Bullet-time) 연출을 통해 체감 시간을 극도로 늘려 서술할 것.
   - 유저의 대사가 짧더라도 절대 턴을 넘기지 말고, 하나의 동작을 다음 4단계로 팽창시킬 것:
     1) 해부학적 명칭을 사용한 물리적 마찰과 원초적 감각의 직접적 묘사.
     2) 그로 인한 근육의 수축, 떨림, 땀방울 등 시각적/생리적 반응 서술.
     3) 얽힌 몸의 구도와 주변 시트의 마찰음, 호흡 소리 등 공간적 묘사.
     4) 그 후 이어지는 에스컬레이션 행동.`;

export const KOREAN_WEBNOVEL_STYLE = `[KOREAN_WEBNOVEL_STYLE]
Narration body: 해체(-다/-했다/-이었다) only — forbid ~습니다/~입니다/~요 in narration.
No translationese or excessive comma chaining.
Forbid noun-fragment lines (숨./시선.) and one-line RP layouts.
Ellipsis: ... allowed; ...... forbidden; max ~3 per turn.

${DYNAMIC_PROSE_STYLING_BLOCK}`;

/** @deprecated Removed from bundle — covered by abs rule 1 in [ADVANCED PROSE & NSFW GUIDELINES]. */
export const SHOW_OVER_TELL_DEFAULT_DIRECTION = `[SHOW OVER TELL] 감정은 행동·환경으로 보여줄 것 — 서술자가 직접 설명하지 말 것 (절대 금지 3조항 1번과 동일 원칙).`;

/** [KOREAN_WEBNOVEL_STYLE] — single injection unit for narrative/bundle paths. */
export const UNIFIED_WEBNOVEL_STYLE_BLOCK = KOREAN_WEBNOVEL_STYLE;

/** @deprecated Use KOREAN_WEBNOVEL_STYLE */
export const KOREAN_WEBNOVEL_FORMAT_RULES = KOREAN_WEBNOVEL_STYLE;

/** Compact pointer — full rules live in [CORE RP] §4–§6. */
export const NARRATIVE_STYLE_CORE = `[NARRATIVE CORE] See [CORE RP] §4–§6 (continuity, prose, no meta).`;

/** @deprecated Presets removed — always unified style */
export function normalizeCreatorRecommendedStyle(_value: unknown): "balanced" {
  return "balanced";
}
