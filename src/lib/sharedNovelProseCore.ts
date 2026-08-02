/**
 * Shared Novel Prose Core — single owner for immersion / dialogue economy /
 * multi-character interaction / show-vs-reexplain / anti-micro-repeat.
 *
 * Used only by Shared Novel Prose V2 canary style sections.
 * Does not mutate legacy IMMERSIVE_PROSE_BLOCK.
 *
 * Wording preserves PHASE 3 semantics; compacted to fit prose token band.
 */

/** Shared shell — narration register (extracted from Legacy). */
export const COMMON_NARRATION_REGISTER_BLOCK = `[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.`;

/** Shared shell — rhythm (extracted from Legacy). */
export const COMMON_RHYTHM_BLOCK = `[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
짧은 문장·파편은 강조·긴장·충격에 이득일 때만 쓰고 습관적 연타를 피한다. 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶고, 「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 번역체 단문을 연속으로 늘어놓지 않는다.
문장 길이 리듬과 문단 분리는 별개다.`;

/** Shared Novel Prose Core — PHASE 3 meaning, compact. */
export const SHARED_NOVEL_PROSE_CORE = `[NOVEL PROSE CORE — SHARED]
1. 내면과 체험 — 웹소설·캐릭터 중심처럼 초점 인물 체험에 밀착한다. 생각·연상·기억·오해·감정적 모순·판단·선택 갈등은 충분히 묘사하고 행동만 나열하지 않는다. 같은 결론을 표현만 바꿔 반복하거나 설정 문장을 복창하지 않는다. 내면은 이후 대사·행동·거리·우선순위·선택에 영향을 준다.
2. 대사와 발언권 — 성격·관계를 살린 농담·잡담·망설임·도발·회피를 효율만으로 제거하지 않는다. 같은 정보·입장·질문을 여러 발화로 반복하지 않는다. 유저 응답·선택이 필요한 지점을 추가 질문·발화·사건으로 대신 진행하지 않는다.
3. 다캐릭터 상호작용 — 장면·정본의 메인 캐릭터들은 성격·지식·목표·관계에 따라 대화·충돌·협력한다. 티키타카·작전·의견 차이는 유효하다. 유저를 장시간 배제하거나 선택을 대신 확정하지 않는다. 분량용 신규 NPC·반복 보고·무의미한 NPC 회의를 늘리지 않는다.
4. 장면 확장 — 이미 있는 인물·환경·사물·업무·사건 결과와 내면·행동으로 깊게 전개한다. 무관한 새 사건·임무·비밀·위기를 만들지 않는다. 평범한 이동·생활 동작은 압축하고 관계·이해·긴장·위험·결과를 바꾸는 디테일만 고른다.
5. 보여주기와 새 판단 — 이미 보여준 감정·동기·관계 의미를 추상 정답 해설로 반복하지 않는다. 새 판단·모순된 속마음·오해·기억·이후 선택을 바꾸는 사고는 허용한다.
6. 비반복과 리듬 — 시선·손짓·호흡·침묵·소품 조작을 대사 사이마다 기계적으로 반복하지 않는다. 행동·감각·내면·환경은 인과로 잇고, 전달됐으면 다음 변화로 넘어간다.`;
