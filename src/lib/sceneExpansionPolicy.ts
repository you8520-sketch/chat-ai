/** Opening beat — never quote or paraphrase [B]'s just-typed input ([A] reaction only). */
export const NO_INPUT_ECHO_RULE = `[NO INPUT ECHO — STRICT]
유저의 현재 입력을 직접 인용하거나 의미만 바꾸어 반복하지 않는다.
새로운 행동과 새로운 서술로만 반응한다.`;

/**
 * Length-control density pointer — style detail lives in [IMMERSIVE PROSE].
 * Kept short to avoid duplicating immersive fill materials.
 */
export const NARRATIVE_DENSITY_BLOCK = `[NARRATIVE DENSITY]
TARGET/FLOOR는 [AI_CAST]의 현재 심리·관찰·감각·판단·욕구·두려움·내부 갈등, AI 행동·대화·환경·NPC 변화를 먼저 깊게 전개한다. 관련할 때만 정본·기억·페르소나 fact를 현재 관찰·판단·행동·대사 선택으로 짧게 변환한다 — 과거 설명·flashback·설정 복습·문장 그대로 echo는 expansion material이 아니다. 기억이 주입되어 있다고 매 턴 callback 의무는 없다.
모든 중간 동작을 기록하지 않는다 — 생략은 짧게 쓰라는 뜻이 아니다.
미세 행동·반복 해설·같은 감정 paraphrase·같은 기억/키워드/비유의 무기능 반복으로 분량을 채우지 않는다. [B]의 새 직접 대사·중요 선택·중대 행동은 length filler가 아니다.`;

/** @deprecated Step 7.5 — merged into [NARRATIVE DENSITY]; not injected in LENGTH CONTROL */
export const MOMENT_TO_MOMENT_WRITING_BLOCK = "";

/**
 * Absorbed into [IMMERSIVE PROSE] — keep empty so LENGTH CONTROL does not re-inject.
 * @deprecated use IMMERSIVE PROSE reaction guidance
 */
export const REACTION_VARIETY_BLOCK = "";

/** @deprecated alias — responseLength / audits still import this name */
export const NO_GENERIC_REACTIONS_BLOCK = REACTION_VARIETY_BLOCK;
