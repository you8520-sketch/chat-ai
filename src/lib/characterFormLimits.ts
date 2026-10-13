/** 캐릭터 제작 폼 글자·길이 제한 (클라이언트·서버 공용) */
export const AI_LEARNING_LIMIT = 12000;
export const AI_LEARNING_MIN = 1500;

export function aiLearningLimitExceededMessage(): string {
  return `세계관/배경 + 캐릭터 설정 + 기본 말투는 합쳐서 ${AI_LEARNING_LIMIT.toLocaleString()}자 이하여야 합니다.`;
}
/** 대사 예시 / 상황별 말투 / 금지 말투 — 12,000자 AI 학습 합산에서 제외, 필드별 한도 */
export const SPEECH_EXAMPLES_LIMIT = 500;
export const SPEECH_FORBIDDEN_LIMIT = 500;
export const SPEECH_CONTEXTUAL_LIMIT = 500;
export const GREETING_LIMIT = 2000;

/**
 * Platform text the RP setting source adds around creator fields: [이름]/[정체성],
 * [예시 대화], the SPEECH CONSISTENCY block, the speech metadata headers and the contextual
 * register block (rendered twice: readable list + JSON). `characterSettingSourceCap.test`
 * pins this against the worst-case speech fixture (8 registers x 6 example lines).
 */
export const CHARACTER_SETTING_WRAPPER_RESERVE = 2800;

/**
 * Largest RP setting source (name + gender + world/system_prompt + speech block) that any
 * save accepted by the limits above can produce. The 12,000 save budget covers world,
 * system_prompt and speech personality/traits only; speech examples, forbidden and
 * contextual registers are budgeted separately and the wrapper text is added on top.
 */
export const CHARACTER_SETTING_SOURCE_LIMIT =
  AI_LEARNING_LIMIT +
  SPEECH_EXAMPLES_LIMIT +
  SPEECH_FORBIDDEN_LIMIT +
  SPEECH_CONTEXTUAL_LIMIT +
  CHARACTER_SETTING_WRAPPER_RESERVE;
export const TAGLINE_LIMIT = 50;
