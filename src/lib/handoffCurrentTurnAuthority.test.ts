import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
  reconcileHandoffContinuityWithCurrentUser,
  SCENE_RESET_HANDOFF_INSTRUCTION,
} from "@/lib/adultSceneRouting";
import { wrapCurrentUserInput } from "@/lib/currentUserInputLabel";

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
  const currentWrapped = wrapCurrentUserInput(input.currentUser, { mode: "interactive" });
  return { extracted, packet, system, currentWrapped };
}

describe("H1 current-turn handoff authority", () => {
  it("A1 — current user private-room close outranks corridor; stale location omitted", () => {
    const { packet, system } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: CURRENT_PRIVATE_ROOM,
    });
    assert.equal(packet.location, undefined);
    assert.match(system, /현재 사용자 턴 전체가 최신 장면 상태다/);
    assert.match(system, /그 이전 박스로 되감거나/);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.doesNotMatch(system, /벽면의 안내판을 훑고 지나갔다/);
    assert.doesNotMatch(system, /형광 라인이 긴 복도/);
  });

  it("A2 — old quoted speech is not injected as currentSpeechState", () => {
    const prior = `그리고 이어진 나지막한 제안.\n"같이 갈래?"\n태형의 입꼬리가 올라갔다.`;
    const { packet } = assembleHandoff({
      priorAssistant: prior,
      currentUser:
        "그래, 같이 가자. 문을 닫고 가까이 다가온다. 옷을 천천히 벗기며 키스한다.",
    });
    assert.equal(packet.currentSpeechState, undefined);
  });

  it("A3 — last-sentence internal thought is not unfinishedAction", () => {
    const { packet } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: CURRENT_PRIVATE_ROOM,
    });
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.positions, undefined);
  });

  it("A4 — a multi-thousand-character current user turn stays fully authoritative", () => {
    const longTurn = `${CURRENT_PRIVATE_ROOM}\n${"한 장면을 더 진행한다. ".repeat(200)}`;
    assert.ok(longTurn.length > 2000);
    const { currentWrapped, system } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: longTurn,
    });
    assert.ok(currentWrapped.includes(longTurn.trim()));
    assert.ok(currentWrapped.includes(CURRENT_PRIVATE_ROOM));
    assert.ok(currentWrapped.includes("한 장면을 더 진행한다."));
    assert.match(system, /사용자 턴을 자르거나 다시 해석하지 않는다/);
    assert.doesNotMatch(system, /직전 출력에서 완료되지 않은 행동이나 대화가 있다면/);
  });

  it("A5 — current user location/time change cannot be outranked by prior physical state", () => {
    const { packet, system } = assembleHandoff({
      priorAssistant: "호텔 침실에서 벽에 기댄 채 숨이 가까워졌다.",
      currentUser: "다음 날 아침, 카페로 자리를 옮긴다. 창가에 앉는다.",
    });
    assert.equal(packet.location, undefined);
    assert.equal(packet.positions, undefined);
    assert.match(system, /이미 바꾼 장소·시간·행동·대사·장면 진행을 덮어쓰거나/);
  });

  it("style continuity is narrow — no 최대한 유지 of prior facts/errors", () => {
    assert.match(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /캐릭터 말투/);
    assert.match(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /유효한 문장 호흡만 참고한다/);
    assert.doesNotMatch(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION, /최대한 유지/);
    assert.match(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
      /잘못된 장소·의상·신체 상태·대행 오류·날조된 사용자 의도를 연속성 때문에 복제하지 않는다/
    );
    assert.match(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
      /캐릭터 정본과 현재 사용자 상태가 직전 모델 출력의 우연한 오류보다 우선한다/
    );
  });

  it("extract helper no longer returns heuristic physical fields", () => {
    const extracted = extractHandoffContinuityFromAssistantText({
      text: '호텔 침실에서 라이크가 렌의 허리를 감싸 안았다. 「괜찮아?」',
      characterName: "라이크",
      personaName: "렌",
    });
    assert.equal("location" in extracted, false);
    assert.equal("positions" in extracted, false);
    assert.equal("unfinishedAction" in extracted, false);
    assert.equal("currentSpeechState" in extracted, false);
    assert.equal(extracted.previousActionActor, "라이크");
  });

  it("scene-reset instruction remains available and drops physical packet fields", () => {
    const { packet, system } = assembleHandoff({
      priorAssistant: PRIOR_CORRIDOR,
      currentUser: "OOC: 기존RP종료 새로운 에피소드시작. 카페에서 다시 만난다.",
      sceneReset: true,
    });
    assert.equal(packet.sceneReset, true);
    assert.equal(packet.location, undefined);
    assert.equal(packet.previousActionActor, undefined);
    assert.match(system, new RegExp(SCENE_RESET_HANDOFF_INSTRUCTION.slice(0, 24)));
  });
});
