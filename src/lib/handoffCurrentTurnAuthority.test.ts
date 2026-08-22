import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
  reconcileHandoffContinuityWithCurrentUser,
} from "@/lib/adultSceneRouting";

const PRIOR_CORRIDOR = `로비 중앙의 분수대를 지나 서쪽 통로로 접어들자, 벽면을 따라 촘촘하게 박힌 형광 라인이 긴 복도를 비추고 있었다.
"어디로 가야 하는지, 이제 슬슬 알려줄 때도 되지 않았어?"
이 기묘한 침묵과 편안함을 조금이라도 더 길게 끌고 가고 싶다는 욕심이, 그의 능글맞은 태도 아래 은밀하게 도사리고 있었다.`;

const CURRENT_PRIVATE_ROOM =
  "옆문을 열고 작은 방으로 들어간다. 문을 닫고 가까이 다가온다. 합의된 성인 장면을 이어간다. 옷을 천천히 벗기며 키스한다.";

function assembleHandoff(input: {
  priorAssistant: string;
  currentUser: string;
  characterName?: string;
  personaName?: string;
  sceneReset?: boolean;
}) {
  const characterName = input.characterName ?? "라이크";
  const personaName = input.personaName ?? "렌";
  const extracted = reconcileHandoffContinuityWithCurrentUser({
    text: input.priorAssistant,
    characterName,
    personaName,
    currentUserText: input.currentUser,
  });
  const packet = buildSceneContinuityPacket({
    previousSceneMode: "normal",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [characterName, personaName],
    currentPov: "third_person",
    sceneReset: input.sceneReset === true,
    ...(input.sceneReset ? {} : extracted),
  });
  const system = appendAdultHandoffPrompt("SYSTEM", packet);
  return { extracted, packet, system };
}

describe("H1R handoff current-turn authority + visible continuity", () => {
  it("current user final state outranks prior corridor; stale packet location omitted", () => {
    const { packet, system } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: CURRENT_PRIVATE_ROOM,
    });
    assert.equal(packet.location, undefined);
    assert.match(system, /현재 사용자 턴 전체가 최신 장면 상태다/);
    assert.match(system, /직전 장면으로 되감지 않는다/);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.doesNotMatch(system, /형광 라인이 긴 복도/);
  });

  it("old quoted speech is not injected as currentSpeechState", () => {
    const { packet } = assembleHandoff({
      priorAssistant: `그리고 이어진 나지막한 제안.\n"같이 갈래?"\n태형의 입꼬리가 올라갔다.`,
      currentUser: "그래, 같이 가자. 문을 닫고 가까이 다가온다.",
    });
    assert.equal(packet.currentSpeechState, undefined);
  });

  it("last-sentence internal thought is not unfinishedAction", () => {
    const { packet } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: CURRENT_PRIVATE_ROOM,
    });
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.positions, undefined);
  });

  it("visible Gemini scene facts are continuity, not errors to correct", () => {
    assert.match(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /보이는 이야기 연속이다/);
    assert.match(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
      /이미 화면에 나온 의상·장비·신체\/감각 상태/
    );
    assert.doesNotMatch(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /잘못된 의상/);
    assert.doesNotMatch(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /잘못된 장소·의상·신체 상태/);
    assert.doesNotMatch(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /우연한 오류보다 우선/);
    assert.doesNotMatch(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /최대한 유지/);
  });

  it("style continuity is requested without canon-repair language", () => {
    assert.match(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /직전 시점·문장 호흡·문단 구성/);
    assert.match(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /말투·호칭·감정 온도/);
    assert.match(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
      /같은 행동·감각·의미를 분량을 채우려고 반복하지 않는다/
    );
  });

  it("extract helper no longer returns heuristic physical fields", () => {
    const extracted = extractHandoffContinuityFromAssistantText({
      text: "호텔 침실에서 라이크가 렌의 허리를 감싸 안았다. 「괜찮아?」",
      characterName: "라이크",
      personaName: "렌",
    });
    assert.equal("location" in extracted, false);
    assert.equal("positions" in extracted, false);
    assert.equal("unfinishedAction" in extracted, false);
    assert.equal("currentSpeechState" in extracted, false);
    assert.equal(extracted.previousActionActor, "라이크");
  });

  it("current user location/time change cannot be outranked by prior physical state", () => {
    const { packet, system } = assembleHandoff({
      priorAssistant: "호텔 침실에서 벽에 기댄 채 숨이 가까워졌다.",
      currentUser: "다음 날 아침, 카페로 자리를 옮긴다. 창가에 앉는다.",
    });
    assert.equal(packet.location, undefined);
    assert.match(system, /현재 사용자가 바꾸거나 넘어간 상태만 덮어쓴다/);
  });
});
