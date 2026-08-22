import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
  reconcileHandoffContinuityWithCurrentUser,
} from "@/lib/adultSceneRouting";
import {
  ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY,
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { buildContext } from "@/services/contextBuilder";

const OWNER = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
const HANDOFF_WRAPPER = buildCurrentUserInputWrapper({
  mode: "interactive",
  adultHandoff: true,
});
const GEMINI_WRAPPER = buildCurrentUserInputWrapper({ mode: "interactive" });

describe("H1-CLEAN minimal positive handoff contract", () => {
  it("exactly one system handoff owner", () => {
    const packet = buildSceneContinuityPacket({ previousSceneMode: "normal" });
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.equal((system.match(/현재 사용자 턴이 확정한 장면 다음부터/g) ?? []).length, 1);
    assert.equal((system.split(OWNER).length - 1), 1);
    assert.doesNotMatch(system, /직전 assistant 출력의 바로 다음 순간부터/);
    assert.doesNotMatch(OWNER, /잘못된 의상|우연한 오류보다 우선|기능적 장소를 확정하지 않는다|일반 지배적 성인 RP/);
    assert.doesNotMatch(OWNER, /예: A가 B의 허리/);
  });

  it("normal Gemini wrapper unchanged", () => {
    assert.match(GEMINI_WRAPPER, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(GEMINI_WRAPPER, /아래 입력 전체가 현재 장면의 최신 상태다/);
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "같이 갈래?",
      nsfw: false,
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      provider: "cheaperinference",
    });
    const last = built.history.at(-1)?.content ?? "";
    assert.match(last, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(last, /아래 입력 전체가 현재 장면의 최신 상태다/);
  });

  it("handoff wrapper uses the concise variant", () => {
    assert.match(HANDOFF_WRAPPER, /아래 입력 전체가 현재 장면의 최신 상태다/);
    assert.match(HANDOFF_WRAPPER, /즉각적인 물리적 결과와 비자발적 신체 반응/);
    assert.match(HANDOFF_WRAPPER, /새로운 의도적 행동·대답·선택이 필요한 지점은 사용자에게 남겨 둔다/);
    assert.doesNotMatch(HANDOFF_WRAPPER, /small movement\/contact\/object-handling/);
    assert.equal(HANDOFF_WRAPPER.includes(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY), true);
    const wrapped = wrapCurrentUserInput("문을 닫고 가까이 다가온다.", {
      mode: "interactive",
      adultHandoff: true,
    });
    assert.match(wrapped, /아래 입력 전체가 현재 장면의 최신 상태다/);
    assert.match(wrapped, /문을 닫고 가까이 다가온다/);
  });

  it("prior corridor + user closes door => newest user state", () => {
    const extracted = reconcileHandoffContinuityWithCurrentUser({
      text: "로비 중앙의 분수대를 지나 서쪽 통로로 접어들자, 형광 라인이 긴 복도를 비추고 있었다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText:
        "문을 닫고 가까이 다가온다. 합의된 성인 장면을 이어간다. 옷을 천천히 벗기며 키스한다.",
    });
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      sexualContextActive: true,
      ...extracted,
    });
    assert.equal(packet.location, undefined);
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.currentSpeechState, undefined);
    assert.equal(packet.positions, undefined);
    assert.match(OWNER, /현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다/);
    assert.match(HANDOFF_WRAPPER, /이 입력이 끝난 지점에서 계속한다/);
  });

  it("started user kiss consequence allowed", () => {
    assert.match(HANDOFF_WRAPPER, /이미 시작한 행동의 즉각적인 물리적 결과/);
    const wrapped = wrapCurrentUserInput("옷을 천천히 벗기며 키스한다.", {
      mode: "interactive",
      adultHandoff: true,
    });
    assert.match(wrapped, /즉각적인 물리적 결과/);
    assert.match(wrapped, /옷을 천천히 벗기며 키스한다/);
  });

  it("involuntary reaction allowed", () => {
    assert.match(HANDOFF_WRAPPER, /비자발적 신체 반응까지 자연스럽게 묘사할 수 있다/);
  });

  it("new wrist grab / relocation / answer choice not assistant-owned", () => {
    assert.match(HANDOFF_WRAPPER, /새로운 의도적 행동·대답·선택/);
    assert.doesNotMatch(HANDOFF_WRAPPER, /small movement\/contact/);
    const extracted = extractHandoffContinuityFromAssistantText({
      text: "태형은 안내 스크린을 켜 둔 채 렌을 바라보았다.",
      characterName: "라이크",
      personaName: "렌",
      currentUserText: "문을 닫고 가까이 다가온다. 옷을 천천히 벗기며 키스한다.",
    });
    assert.equal(extracted.previousActionActor, undefined);
    assert.equal(extracted.contactDirection, undefined);
  });

  it("visible prior outfit/sensory continuity preserved", () => {
    assert.match(OWNER, /화면에 이미 나온 장면 상태를 자연스럽게 이어/);
    assert.match(OWNER, /직전 assistant의 말투·유머·호칭·문장 호흡·대사\/서술 균형/);
    assert.doesNotMatch(OWNER, /잘못된 의상/);
  });
});
