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
import {
  classifyCurrentUserMajorRewind,
  classifyNewUserActionBeat,
  classifySameBeatMicroContinuation,
  classifyTrueNewUserActionBeat,
} from "@/lib/handoffUserActionTaxonomy";
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

describe("H1-CLEAN FINAL-B — same-beat micro continuation", () => {
  it("1. normal Gemini wrapper unchanged", () => {
    assert.match(GEMINI_WRAPPER, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(GEMINI_WRAPPER, KOREAN_HANDOFF_MARKER);
    assert.doesNotMatch(GEMINI_WRAPPER, /같은 의도와 방향 안에서/);
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
  });

  it("2. 옷을 벗기며 키스한다 → completing that clothing-removal beat allowed", () => {
    assert.match(HANDOFF_WRAPPER, /이미 시작한 행동과 상호작용은 같은 의도와 방향 안에서/);
    assert.match(HANDOFF_WRAPPER, /즉각적인 결과까지 이어 묘사할 수 있고/);
    const wrapped = wrapCurrentUserInput("옷을 벗기며 키스한다", {
      mode: "interactive",
      adultHandoff: true,
    });
    assert.match(wrapped, /옷을 벗기며 키스한다/);
    const judged = classifySameBeatMicroContinuation(
      "렌이 태형의 재킷을 천천히 벗기며 입술을 맞췄다."
    );
    assert.equal(judged.value, true);
    assert.equal(
      classifyNewUserActionBeat("렌이 태형의 재킷을 천천히 벗기며 입술을 맞췄다.").value,
      false
    );
  });

  it("3. same kiss small posture/contact adjustment → SAME_BEAT_MICRO_CONTINUATION allowed", () => {
    assert.match(HANDOFF_WRAPPER, /자연스러운 작은 움직임과 즉각적인 결과/);
    const judged = classifySameBeatMicroContinuation(
      "키스 중에 고개를 기울이며 입술을 더 가까이 맞췄다."
    );
    assert.equal(judged.value, true);
    assert.equal(
      classifyNewUserActionBeat("키스 중에 고개를 기울이며 입술을 더 가까이 맞췄다.")
        .value,
      false
    );
  });

  it("4. involuntary physiology → allowed", () => {
    assert.match(HANDOFF_WRAPPER, /비자발적 신체 반응도 묘사한다/);
    const judged = classifySameBeatMicroContinuation("렌의 숨이 짧게 떨렸다.");
    assert.equal(judged.value, true);
    assert.equal(classifyNewUserActionBeat("렌의 숨이 짧게 떨렸다.").value, false);
  });

  it("5. suddenly choosing a new accessory/body target → NEW_USER_ACTION_BEAT", () => {
    assert.match(HANDOFF_WRAPPER, /새로운 행동의 목적·종류·대상/);
    const judged = classifyNewUserActionBeat("렌이 전자 초커를 잡아당겼다.");
    assert.equal(judged.value, true);
  });

  it("6. [A] relocating [B] is NOT TRUE_NEW_USER_ACTION_BEAT", () => {
    assert.match(HANDOFF_WRAPPER, /새로운 행동의 목적·종류·대상/);
    const judged = classifyTrueNewUserActionBeat(
      "태형은 렌을 회의실 탁자 쪽으로 밀어 올렸다."
    );
    assert.equal(judged.value, false);
    assert.equal(judged.actor, null);
    assert.equal(classifyNewUserActionBeat("태형은 렌을 회의실 탁자 쪽으로 밀어 올렸다.").value, false);
  });

  it("7. answering a real question for [B] → NEW_USER_ACTION_BEAT", () => {
    assert.match(HANDOFF_WRAPPER, /대답이나 중요한 선택은 사용자가 정한다/);
    const judged = classifyNewUserActionBeat("렌이 대답했다. 「응.」");
    assert.equal(judged.value, true);
  });

  it("8. new consent/refusal/important choice → NEW_USER_ACTION_BEAT", () => {
    assert.match(HANDOFF_WRAPPER, /중요한 선택은 사용자가 정한다/);
    const judged = classifyNewUserActionBeat("렌은 그 제안에 동의했다.");
    assert.equal(judged.value, true);
  });

  it("9. current 219-char system owner byte-identical", () => {
    assert.equal(OWNER, EXPECTED_OWNER);
    assert.equal(OWNER.length, 219);
    const packet = buildSceneContinuityPacket({ previousSceneMode: "normal" });
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.equal(system.split(OWNER).length - 1, 1);
    assert.equal(HANDOFF_WRAPPER.includes(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY), true);
    assert.doesNotMatch(OWNER, /같은 의도와 방향 안에서/);
    assert.doesNotMatch(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY, /예:|회의실|라이크/);
  });

  it("10. H1CFB-R2 correction: 태형은 렌의 몸을 벽 쪽으로 → actor [A]", () => {
    const judged = classifyTrueNewUserActionBeat(
      "태형은 렌의 몸을 벽 쪽으로 밀어 붙이며 자세를 바꿨다."
    );
    assert.equal(judged.value, false);
    assert.equal(classifyCurrentUserMajorRewind("태형은 렌의 몸을 벽 쪽으로 밀어 붙이며 자세를 바꿨다.").value, false);
  });

  it("11. H1CFB-R3 correction: 그는 렌의 몸을 벽 쪽으로 → actor [A]", () => {
    const judged = classifyTrueNewUserActionBeat(
      "태형이 낮게 웃으며 물었다. 그는 렌의 몸을 벽 쪽으로 돌려 세웠다."
    );
    assert.equal(judged.value, false);
  });

  it("12. H1CFB-R3 door chain: [B] re-opens closed door → TRUE + REWIND", () => {
    const text =
      "렌은 이미 근처 비상용 보조실의 문고리를 틀어쥐고 있었다. 렌의 손이 그의 가슴팍을 밀쳐 안으로 들여보냈다. 곧이어 문이 닫히는 무거운 마찰음이 좁은 공간에 퍼졌다.";
    const judged = classifyTrueNewUserActionBeat(text);
    assert.equal(judged.value, true);
    assert.equal(judged.actor, "렌 [B]");
    assert.equal(judged.target, "문고리");
    assert.equal(judged.action, "문고리를 잡음");
    assert.match(judged.passage ?? "", /문고리/);
    assert.equal(classifyCurrentUserMajorRewind(text).value, true);
  });
});
