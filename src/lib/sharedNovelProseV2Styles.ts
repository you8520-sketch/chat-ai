/**
 * Shared Novel Prose V2 style-section bodies.
 *
 * Parallel to Legacy / VNext / Muse M1 — does not mutate production exports.
 * Gate OFF → resolver returns original sections (byte-identical).
 */

import {
  COMMON_NARRATION_REGISTER_BLOCK,
  COMMON_RHYTHM_BLOCK,
  SHARED_NOVEL_PROSE_CORE,
} from "@/lib/sharedNovelProseCore";

/** V2 scene pacing — does not shorten output. */
export const SCENE_FLOW_BLOCK_V2 = `[SCENE FLOW]
calm/tension/combat는 속도·긴장만 조절하며 분량을 줄이라는 뜻이 아니다.
현재 반응이 다음 판단·행동·관계·환경 결과로 이어지게 한다.`;

/** V2 turn continuation — injected into LENGTH when V2 canary is ON. */
export const SCENE_CONTINUATION_PRIORITY_BLOCK_V2 = `[SCENE CONTINUATION PRIORITY]
첫 반응만으로 끝내지 말고 결과와 다음 상호작용 지점까지 현재 장면 안에서 전개한다.
메인 캐릭터가 여럿이면 필요한 상호작용·판단을 이어갈 수 있다.
[B] 선택 이후를 대신 진행하거나 새 NPC·새 사건·반복 대사로 분량을 채우지 않는다.
MINIMUM_FLOOR 전 조기 종료를 피한다.`;

/** V2 narrative density — LENGTH CONTROL only. */
export const NARRATIVE_DENSITY_BLOCK_V2 = `[NARRATIVE DENSITY]
TARGET/FLOOR는 내면·메인 캐릭터 상호작용·행동·환경·관계 변화·선택·결과로 채운다.
대사/지문 비율을 기계적으로 맞추지 말고, 새 NPC·반복 보고·미세 행동·추상 재해설로 채우지 않는다.
생략은 짧게 쓰라는 뜻이 아니다.`;

const SENSATION_BLOCK = `[SENSATION]
촉·손·접촉·온기 묘사의 단일 Owner. 장면에 맞게 1~2채널만 깊게 — 질감·공간·온도·소리·대비·방향·거리.
깊이는 밀도가 아니라 구체성이다.`;

const WEBNOVEL_BREATH_BLOCK = `[WEBNOVEL BREATH]
pause·여운·턴 끝 호흡의 단일 Owner.
중요 순간 직전: 지문 한 박 pause(공간·온도·소리).
전환·분기: 공간·시간·분위기 한 줄 리셋.`;

/** Legacy route V2 — Shared Core replaces IMMERSIVE_PROSE_BLOCK. */
export const PROSE_STYLE_SECTION_V2 = `${COMMON_NARRATION_REGISTER_BLOCK}

${SCENE_FLOW_BLOCK_V2}

${COMMON_RHYTHM_BLOCK}

${SENSATION_BLOCK}

${SHARED_NOVEL_PROSE_CORE}

${WEBNOVEL_BREATH_BLOCK}`;

/**
 * VNext route V2 — Shared Core + VNext-only personality.
 * Removed duplicate show-don't-tell / dialogue-as-action / anti-repetition
 * (owned by Shared Core).
 */
export const PROSE_VNEXT_STYLE_SECTION_V2 = `${COMMON_NARRATION_REGISTER_BLOCK}

${SCENE_FLOW_BLOCK_V2}

${COMMON_RHYTHM_BLOCK}

${SHARED_NOVEL_PROSE_CORE}

[PROSE VNEXT — 장면 생동 계약]
1. 공간·사물·소리·빛·온도·거리가 행동·판단에 실제로 작용하게 한다.
2. 같은 자극에도 성격·목표·관계·지식에 따라 반응이 갈라지게 한다.
3. 확립된 기억은 설명 복창이 아니라 준비·회피·우선순위로 드러낸다.
4. 이미 있는 인물·세계는 최신 한 줄 답변만이 아니라 동기·직무에 따라 움직이되 무관한 새 사건을 만들지 않는다.
5. 새 사건 연쇄보다 현재 상황의 긴장·신뢰·거리·위험을 깊게 바꾼다.`;

/**
 * Muse M1 route V2 — Shared Core + Muse-only continuity.
 * Removed duplicate show / memory-list / world-filler / dialogue-volume clauses.
 */
export const MUSE_PROSE_M1_STYLE_SECTION_V2 = `${COMMON_NARRATION_REGISTER_BLOCK}

${SCENE_FLOW_BLOCK_V2}

${COMMON_RHYTHM_BLOCK}

${SHARED_NOVEL_PROSE_CORE}

[MUSE PROSE M1 — 장면 연속 계약]
1. 직전 입력은 완료된 사실로 두고 다음 반응부터 이어간다. 재연·대신 서술 금지.
2. 기억은 선택에 반영하되 목록 복창·없던 과거 생성을 하지 않는다.
3. 이미 있는 인물·환경은 인과적으로 움직이고 무관한 새 위기를 던지지 않는다.
4. 요약으로 닫지 말고 다음 상호작용 지점에 착지한다.`;
