import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionNeedsCheck, isTalkOnlyAction } from "./actionCheck";

describe("TRPG talk-only actions skip checks", () => {
  it("skips a party question with no physical attempt", () => {
    const body =
      "안전가옥을 찾아볼까?? 아니면 약국에 쓸만한게 있나볼까??? *모두를 향해 물어본다*";
    assert.equal(isTalkOnlyAction(body), true);
    assert.equal(actionNeedsCheck({ body, actionType: "persuade" }), false);
    assert.equal(actionNeedsCheck({ body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "휴식한다", actionType: "support" }), false);
  });

  it("skips stage direction plus quoted speech", () => {
    assert.equal(isTalkOnlyAction('*창가에 붙어 낮게* "먼저 나가지 마. 내가 볼게."'), true);
  });

  it("still checks real attempts", () => {
    assert.equal(actionNeedsCheck({ body: "문을 민다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "조심스럽게 문을 민다.", actionType: "investigate" }), true);
    assert.equal(actionNeedsCheck({ body: "칼을 뽑는다.", actionType: "attack" }), true);
    assert.equal(
      actionNeedsCheck({
        body: "지도를 훑고 약국을 함정으로 판단한 뒤 안전 가옥을 제안한다.",
        actionType: "free",
      }),
      true
    );
  });

  it("does not treat a quoted question inside a physical beat as talk-only", () => {
    const body =
      '이현은 석궁을 약국 쪽으로 틀며 말했다. "약국은 함정이야. 안전 가옥 먼저 갈까?" 그는 지도를 훑었다.';
    assert.equal(isTalkOnlyAction(body), false);
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), true);
  });
});
