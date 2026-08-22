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
} from "@/lib/adultSceneRouting";
import {
  ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY,
  buildCurrentUserInputWrapper,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { buildContext } from "@/services/contextBuilder";

const OWNER = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
const EXPECTED_OWNER = `현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형과 화면에 이미 나온 장면 상태를 자연스럽게 이어, 같은 캐릭터와 같은 글의 다음 부분처럼 작성한다.
이미 다룬 감각이나 행동을 표현만 바꿔 반복하기보다 캐릭터의 새 행동·대사·반응과 그 결과로 장면을 계속 전진시킨다. 현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다.`;
const HANDOFF_WRAPPER = buildCurrentUserInputWrapper({
  mode: "interactive",
  adultHandoff: true,
});
const GEMINI_WRAPPER = buildCurrentUserInputWrapper({ mode: "interactive" });
const KOREAN_HANDOFF_MARKER = /아래 입력 전체가 현재 장면의 최신 상태/;

describe("H1-CLEAN final — user-action boundary only", () => {
  it("1. normal Gemini wrapper unchanged", () => {
    assert.match(GEMINI_WRAPPER, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(GEMINI_WRAPPER, KOREAN_HANDOFF_MARKER);
    assert.doesNotMatch(GEMINI_WRAPPER, /이미 일어난 것으로 본다/);
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
    assert.doesNotMatch(last, KOREAN_HANDOFF_MARKER);
    assert.doesNotMatch(last, /이미 일어난 것으로 본다/);
  });

  it("2. current-user events are treated as already completed state", () => {
    assert.match(HANDOFF_WRAPPER, /입력에 적힌 사건과 행동은 이미 일어난 것으로 본다/);
    assert.match(HANDOFF_WRAPPER, /그 마지막 순간 다음부터 이어 쓴다/);
    const wrapped = wrapCurrentUserInput("문을 닫고 가까이 다가온다.", {
      mode: "interactive",
      adultHandoff: true,
    });
    assert.match(wrapped, /이미 일어난 것으로 본다/);
    assert.match(wrapped, /문을 닫고 가까이 다가온다/);
  });

  it("3. 옷을 벗기며 키스 may realize the immediate undressing/kiss result", () => {
    assert.match(
      HANDOFF_WRAPPER,
      /이미 시작한 행동은 즉각적인 결과까지 자연스럽게 완성/
    );
    const wrapped = wrapCurrentUserInput("옷을 천천히 벗기며 키스한다.", {
      mode: "interactive",
      adultHandoff: true,
    });
    assert.match(wrapped, /즉각적인 결과까지 자연스럽게 완성/);
    assert.match(wrapped, /옷을 천천히 벗기며 키스한다/);
  });

  it("4. new [B] contact target is user-owned", () => {
    assert.match(HANDOFF_WRAPPER, /이어지는 의도적 행동·접촉·이동·대답·선택은 사용자가 정한다/);
    assert.doesNotMatch(HANDOFF_WRAPPER, /small movement\/contact/);
  });

  it("5. new [B] movement/relocation is user-owned", () => {
    assert.match(HANDOFF_WRAPPER, /의도적 행동·접촉·이동/);
    assert.match(HANDOFF_WRAPPER, /이동·대답·선택은 사용자가 정한다/);
  });

  it("6. new [B] dialogue/answer/choice is user-owned", () => {
    assert.match(HANDOFF_WRAPPER, /대답·선택은 사용자가 정한다/);
  });

  it("7. involuntary physiological reaction remains allowed", () => {
    assert.match(HANDOFF_WRAPPER, /비자발적 신체 반응도 묘사한다/);
  });

  it("8. system handoff owner remains exactly the current 219-char owner", () => {
    assert.equal(OWNER, EXPECTED_OWNER);
    assert.equal(OWNER.length, 219);
    const packet = buildSceneContinuityPacket({ previousSceneMode: "normal" });
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.equal((system.split(OWNER).length - 1), 1);
    assert.equal(HANDOFF_WRAPPER.includes(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY), true);
    assert.doesNotMatch(OWNER, /이미 일어난 것으로 본다/);
  });
});
