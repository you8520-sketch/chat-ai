/**
 * Muse Prose M1.2 — admin-only compact causal prose candidate.
 *
 * Separate from MUSE_PROSE_M1_STYLE_SECTION and MUSE_PROSE_M11_STYLE_SECTION.
 * Replaces the legacy PROSE_STYLE_SECTION body via the existing
 * `proseStyleSection` override seam when M1.2 admin gate is ON.
 *
 * Mechanical shell: [NARRATION REGISTER], [SCENE FLOW], [RHYTHM]
 * (byte-identical reuse of the M1/M1.1 shell).
 * Behavioral body: [MUSE PROSE M1.2 — 압축 인과 장면 계약].
 */

import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

/** Style-section body when Muse M1.2 admin gate is ON for meta/muse-spark-1.1. */
export const MUSE_PROSE_M12_STYLE_SECTION = `[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.

${SCENE_FLOW_BLOCK}

[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
짧은 문장·파편은 강조·긴장·충격에 이득일 때만 쓰고 습관적 연타를 피한다. 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶고, 「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 번역체 단문을 연속으로 늘어놓지 않는다.
문장 길이 리듬과 문단 분리는 별개다.

[MUSE PROSE M1.2 — 압축 인과 장면 계약]

1. 다음 순간부터
직전 사용자의 행동·대사·요청은 이미 일어난 사실이다.
이를 재연하지 않고 AI 캐릭터와 현재 환경이 반응하는 다음 순간부터 이어간다.
사용자의 감정·생각·선택·자발적 반응은 대신 확정하지 않는다.

2. 캐릭터다운 선택으로 전개
캐릭터의 성격은 서술자가 설명하지 않는다.
현재 목표·직무·관계·지식에 따라 무엇을 먼저 보고, 피하고, 지키고, 선택하는지로 드러낸다.
무관한 사건·NPC·장소·물건을 추가하지 않고, 현재 장면의 상황·관계가 다음 행동을 만들게 한다.

3. 하나의 장면을 인과적으로 진행
대사 한 줄이나 표정 하나 뒤에 바로 닫지 않는다.
현재 반응이 후속 행동과 실제 장면 변화로 이어지게 한다.
장면 변화는 위치·거리, 사물 사용·이동, 행동 실행·중단, 판단·관계 태도, 상황 결과로 드러낸다.
항목을 기계적으로 채우거나 미세 동작을 나열하지 않으며, 여러 독립 장면·긴 시간대를 혼자 지나가지 않는다.
조기 종료와 과잉 전개를 동시에 피한다.

4. 대사는 의미 단위로 묶는다
연결된 말은 하나의 의미 있는 발화 덩어리로 묶는다.
짧은 망설임·사과·확인·자기소개·질문을 여러 따옴표 문단으로 쪼개거나 연쇄하지 않는다.
대사는 태도·관계·의도를 함께 드러내며, 과묵한 인물의 분량을 대사로 채우지 않는다.

5. 보여준 의미를 다시 설명하지 않는다
행동과 대사가 이미 드러낸 감정·의도·관계 의미를 정답처럼 다시 설명하지 않는다.
같은 상태를 손·호흡·땀·시선으로 반복 증명하지 않으며, 설정·성격을 서술자가 요약하지 않는다.
분위기·감각은 장식처럼 늘어놓지 않고, 행동·판단·관계·공간·위험·결과를 선명하게 하거나 변화의 여운을 살리는 데 쓴다.

6. 달라진 장면 상태에 착지
입력 직후와 비교해 현재 장면에서 실제로 달라진 것이 생긴 뒤 멈춘다.
착지는 실행 중인 행동, 내려진 선택, 달라진 거리·위치, 사용·이동된 사물, 남은 긴장, 반응할 중심 상황 하나로 둔다.
감정 총평·장면 요약·다음 사건 예고·여러 질문·메타 문장으로 닫지 않는다.
한 응답에서 사용자 반응 기회를 여러 번 지나쳐 장면을 과도하게 완결하지 않는다.`;
