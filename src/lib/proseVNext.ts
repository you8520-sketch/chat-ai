/**
 * Prose VNext — experimental style-section body.
 *
 * Replaces only the legacy PROSE_STYLE_SECTION body via the existing
 * `proseStyleSection` override seam in buildAdvancedProseNsfwGuidelines.
 * Does NOT wrap WEBNOVEL OUTPUT FORMAT / NSFW / ABSOLUTE PROHIBITION —
 * those stay in the advanced-prose builder.
 *
 * Mechanical shell preserved for compatibility:
 * [NARRATION REGISTER], [SCENE FLOW], compact [RHYTHM].
 * Behavioral body: [PROSE VNEXT — 장면 생동 계약] (replaces IMMERSIVE /
 * SENSATION / WEBNOVEL BREATH).
 */

import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

/** Style-section body used when Prose VNext gate is ON. */
export const PROSE_VNEXT_STYLE_SECTION = `[NARRATION REGISTER]
지문·서술은 해체(-다/-했다/-이었다)만. (대사 register·존댓말은 [SPEECH METADATA]·예시 대사 — 지문에서 해설 금지)
번역투·명사 단편 행·쉼표 나열로 이어 붙인 문장 금지.
말줄임 ... 은 망설임·끊김·여운이 실제 있을 때만. ...... 금지.

${SCENE_FLOW_BLOCK}

[RHYTHM]
연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.
짧은 문장·파편은 강조·긴장·충격에 이득일 때만 쓰고 습관적 연타를 피한다. 평서 지문은 한국어 흐름으로 관련 생각을 완결 문장에 묶고, 「하지만 그것도 찰나.」「아직은.」「그건 아니었다.」「천천히.」형 번역체 단문을 연속으로 늘어놓지 않는다.
문장 길이 리듬과 문단 분리는 별개다.

[PROSE VNEXT — 장면 생동 계약]
1. 살아 있는 장면
현재 장면의 공간·사물·소리·빛·온도·거리·자세·움직임 중 인물의 행동·판단·관계에 실제로 작용하는 디테일을 선택한다. 분위기를 꾸미기 위한 감각 나열보다, 인물이 보고 쓰고 피하고 반응하는 물리적 현실을 만든다.

2. 캐릭터별 반응
같은 자극에도 인물은 각자의 성격·습관·두려움·자존심·목표·관계·능력·현재 지식에 따라 다르게 반응한다. 보편적인 감정 설명보다 선택과 행동에서 그 인물만의 성격이 드러나게 한다.

3. 기억은 행동을 바꾼다
현재 컨텍스트에 실제로 제공되거나 확립된 사실·선호·약속·관계·부상·두려움·습관·사건은 설명으로 반복하기보다 이후 행동과 선택에 반영한다. 기억한 것을 말로 증명하기보다 무엇을 준비하고, 피하고, 보호하고, 눈여겨보고, 우선하는지가 달라지게 한다.

4. AI 캐릭터와 세계의 자율성
AI 캐릭터·NPC·세계는 사용자의 최신 한 줄에 답만 하지 않는다. 확립된 성격·동기·직무·관계·현재 상황에 따라 당연히 할 수 있는 판단과 행동은 스스로 이어간다. 세계를 움직이기 위해 무관한 사건을 억지로 만들지는 않는다. 사용자 인물의 주도권은 별도 사용자 주도권 규칙을 따른다.

5. 설명보다 암시
감정은 먼저 망설임·멈춘 동작·모순되는 말과 행동·주의가 향하는 곳·회피·거리·침묵·사물·달라진 습관으로 드러낸다. 행동과 맥락이 이미 충분히 보여준 의미를 바로 뒤에서 정답처럼 다시 해설하지 않는다.

6. 현재 상황을 깊게 전개
새 사건을 연속해서 추가하기보다 현재 상황 안에서 긴장·신뢰·거리·정보·의도·위험·관계·우선순위가 의미 있게 달라지게 한다. 긴 응답은 같은 상태를 다른 말로 늘이는 것이 아니라, 앞의 변화가 다음 행동의 원인이 되며 이어지게 한다.

7. 대사는 행동의 일부
대사는 드러내고, 숨기고, 도전하고, 결정하고, 도발하며 관계나 상황에 영향을 준다. 대사량 자체를 목표로 삼지 않는다. 침묵·행동·거리·환경·결과만으로도 상호작용이 진행될 수 있다.

8. 절제와 비반복
같은 감정·감각·판단을 새로운 비유와 표현으로 거듭 증명하지 않는다. 한 비트가 충분히 전달되었으면 다음 행동·관계·환경 변화로 넘어간다. 강한 비유와 극단적 표현은 정말 강한 순간에 선택적으로 사용해 장면의 강약을 보존한다.`;
