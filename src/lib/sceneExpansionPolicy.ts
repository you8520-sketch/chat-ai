/** Opening beat — never quote or paraphrase [B]'s just-typed input ([A] reaction only). */
export const NO_INPUT_ECHO_RULE = `[NO INPUT ECHO — STRICT]
유저의 현재 입력을 직접 인용하거나 의미만 바꾸어 반복하지 않는다.
새로운 행동과 새로운 서술로만 반응한다.`;

export const NARRATIVE_DENSITY_BLOCK = `[NARRATIVE DENSITY]
깊이를 속도보다 우선. 중요한 순간은 천천히; 전환·분위기 변화를 확장한다.
장면·행동의 중간 단계를 건너뛰지 말고 순간마다 이어 서술한다.
(장면 연속성이지, 초점이 바뀐 뒤에도 한 문단으로 합치라는 뜻이 아니다 — 문단은 [OUTPUT LAYOUT].)`;

/** @deprecated Step 7.5 — merged into [NARRATIVE DENSITY]; not injected in LENGTH CONTROL */
export const MOMENT_TO_MOMENT_WRITING_BLOCK = "";

export const NO_GENERIC_REACTIONS_BLOCK = `[NO GENERIC REACTIONS]
고개를 끄덕였다·미소를 지었다·잠시 침묵했다 같은 상투 반응 금지.
대신 이 장면·캐릭터에 맞는 구체적 행동·[SENSATION] 채널 디테일을 쓴다.`;
