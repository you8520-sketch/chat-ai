/** Opening beat — never quote or paraphrase [B]'s just-typed input ([A] reaction only). */
export const NO_INPUT_ECHO_RULE = `[NO INPUT ECHO — STRICT]
유저의 현재 입력을 직접 인용하거나 의미만 바꾸어 반복하지 않는다.
새로운 행동과 새로운 서술로만 반응한다.`;

/**
 * Length-control density pointer — style detail lives in [IMMERSIVE PROSE].
 * Kept short to avoid duplicating immersive fill materials.
 */
export const NARRATIVE_DENSITY_BLOCK = `[NARRATIVE DENSITY]
TARGET/FLOOR는 [AI_CAST]의 현재 심리·관찰·감각·판단·욕구·두려움·내부 갈등, AI 행동·대화·환경·NPC 변화를 먼저 깊게 전개한다. 정본·기억·페르소나 callback 방식은 [IMMERSIVE PROSE]를 따른다.
모든 중간 동작을 기록하지 않는다 — 생략은 짧게 쓰라는 뜻이 아니다.
[B]의 새 직접 대사·중요 선택·중대 행동은 length filler가 아니다.`;

/** @deprecated Step 7.5 — merged into [NARRATIVE DENSITY]; not injected in LENGTH CONTROL */
export const MOMENT_TO_MOMENT_WRITING_BLOCK = "";

/**
 * Absorbed into [IMMERSIVE PROSE] — keep empty so LENGTH CONTROL does not re-inject.
 * @deprecated use IMMERSIVE PROSE reaction guidance
 */
export const REACTION_VARIETY_BLOCK = "";

/** @deprecated alias — responseLength / audits still import this name */
export const NO_GENERIC_REACTIONS_BLOCK = REACTION_VARIETY_BLOCK;
