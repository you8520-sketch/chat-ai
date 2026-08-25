import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionNeedsCheck,
  hasChallengeSignal,
  isHarmlessFlavorAction,
  isTalkOnlyAction,
  resolveTrpgActionCheckDecision,
  stripTalkWrappers,
} from "./actionCheck";

describe("TRPG talk-only actions skip checks", () => {
  it("skips a party question with no physical attempt", () => {
    const body =
      "안전가옥을 찾아볼까?? 아니면 약국에 쓸만한게 있나볼까??? *모두를 향해 물어본다*";
    assert.equal(isTalkOnlyAction(body), true);
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body, actionType: "persuade" }), true);
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

describe("TRPG no-check dialogue and flavor", () => {
  it("strips site dialogue wrappers without touching leftover stage text", () => {
    assert.equal(stripTalkWrappers("고개를 끄덕인다. 「알겠어.」"), "고개를 끄덕인다.");
    assert.equal(stripTalkWrappers("『그럴 수도 있겠네.』"), "");
    assert.equal(stripTalkWrappers('"알겠어."'), "");
    assert.equal(stripTalkWrappers("“알겠어.”"), "");
    assert.equal(stripTalkWrappers("[수상한 상자]를 연다."), "[수상한 상자]를 연다.");
  });

  it("A. mixed nod plus corner-quote dialogue is no-check", () => {
    assert.equal(actionNeedsCheck({ body: "고개를 끄덕인다. 「알겠어.」", actionType: "free" }), false);
    assert.equal(isHarmlessFlavorAction("고개를 끄덕인다. 「알겠어.」"), true);
  });

  it("B. harmless clothing and posture flavor is no-check", () => {
    assert.equal(actionNeedsCheck({ body: "옷깃을 정리하고 벽에 기대 선다.", actionType: "free" }), false);
    assert.equal(isHarmlessFlavorAction("옷깃을 정리하고 벽에 기대 선다."), true);
  });

  it("C. quiet laugh plus reply is no-check", () => {
    assert.equal(actionNeedsCheck({ body: "작게 웃는다. 「그럼 그렇게 하자.」", actionType: "free" }), false);
  });

  it("D. sigh and sit is no-check", () => {
    assert.equal(actionNeedsCheck({ body: "한숨을 내쉬며 자리에 앉는다.", actionType: "free" }), false);
  });

  it("E. looking at an ally and shaking a head is no-check", () => {
    assert.equal(actionNeedsCheck({ body: "강이현을 바라보며 고개를 젓는다.", actionType: "free" }), false);
  });

  it("F. pure dialogue of each supported quote style is no-check", () => {
    assert.equal(isTalkOnlyAction("「알겠어.」"), true);
    assert.equal(isTalkOnlyAction("『그럴 수도 있겠네.』"), true);
    assert.equal(isTalkOnlyAction('"알겠어."'), true);
    assert.equal(isTalkOnlyAction("“알겠어.”"), true);
    assert.equal(actionNeedsCheck({ body: "「알겠어.」", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "『그럴 수도 있겠네.』", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: '"알겠어."', actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "“알겠어.”", actionType: "free" }), false);
  });

  it("G. investigation free still rolls", () => {
    assert.equal(
      actionNeedsCheck({ body: "빛나는 조각을 집어 들고 주변 기척을 살핀다.", actionType: "free" }),
      true
    );
  });

  it("H. risky movement still rolls", () => {
    assert.equal(actionNeedsCheck({ body: "무너지는 잔해 사이를 뛰어넘는다.", actionType: "free" }), true);
  });

  it("I. forced door still rolls", () => {
    assert.equal(actionNeedsCheck({ body: "잠긴 문을 억지로 연다.", actionType: "free" }), true);
  });

  it("J. contested social still rolls", () => {
    assert.equal(actionNeedsCheck({ body: "경비병에게 거짓말로 통과하려 한다.", actionType: "free" }), true);
  });

  it("K. explicit strike still rolls", () => {
    assert.equal(actionNeedsCheck({ body: "형체의 옆구리를 향해 주먹을 내지른다.", actionType: "free" }), true);
  });

  it("L. bot risky free still rolls", () => {
    assert.equal(
      actionNeedsCheck({ body: "적의 사각으로 파고들어 칼을 찌른다.", actionType: "free" }),
      true
    );
  });

  it("M. mixed flavor plus risk still rolls", () => {
    const body = "미소를 지으며 수상한 포자낭을 맨손으로 집어 든다.";
    assert.equal(hasChallengeSignal(body), true);
    assert.equal(isHarmlessFlavorAction(body), false);
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "옷깃을 정리한 뒤 무너지는 틈을 뛰어넘는다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "미소를 지으며 경비병을 속이려 든다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "벽에 기대 주변의 숨은 기척을 탐색한다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "손을 뻗어 수상한 빛나는 조각을 집어 든다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "조용히 웃으며 잠긴 문을 딴다.", actionType: "free" }), true);
  });

  it("ordinary free movement resolves without a roll", () => {
    assert.equal(actionNeedsCheck({ body: "갑자기 그쪽으로 간다.", actionType: "free" }), false);
  });

  it("explicit resolution types cannot be skipped by vague or cosmetic prose", () => {
    assert.equal(actionNeedsCheck({ body: "가볍게 손을 뻗는다", actionType: "attack" }), true);
    assert.equal(actionNeedsCheck({ body: "주변을 본다", actionType: "investigate" }), true);
    assert.equal(actionNeedsCheck({ body: "한 발 물러선다", actionType: "defend" }), true);
    assert.equal(actionNeedsCheck({ body: "목소리를 낮춘다", actionType: "persuade" }), true);
    assert.equal(actionNeedsCheck({ body: "그림자에 선다", actionType: "stealth" }), true);
  });

  it("explicit resolution types cannot be skipped by pure dialogue", () => {
    assert.equal(actionNeedsCheck({ body: "「내가 맡을게.」", actionType: "attack" }), true);
    assert.equal(actionNeedsCheck({ body: "「막아볼게.」", actionType: "defend" }), true);
    assert.equal(actionNeedsCheck({ body: "「어디 있는지 찾아보자.」", actionType: "investigate" }), true);
    assert.equal(actionNeedsCheck({ body: "「내가 설득해 볼게.」", actionType: "persuade" }), true);
    assert.equal(actionNeedsCheck({ body: "「조용히 갈게.」", actionType: "stealth" }), true);
    assert.equal(isTalkOnlyAction("「내가 맡을게.」"), true);
    assert.equal(isTalkOnlyAction("「막아볼게.」"), true);
    assert.equal(isTalkOnlyAction("「어디 있는지 찾아보자.」"), true);
    assert.equal(isTalkOnlyAction("「내가 설득해 볼게.」"), true);
    assert.equal(isTalkOnlyAction("「조용히 갈게.」"), true);
    assert.equal(actionNeedsCheck({ body: "「알겠어.」", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "고개를 끄덕인다. 「알겠어.」", actionType: "free" }), false);
  });

  it("keeps dedicated recovery ownership without a fake extra skip", () => {
    assert.equal(actionNeedsCheck({ body: "상처를 응급처치한다.", actionType: "support" }), true);
    assert.equal(actionNeedsCheck({ body: "중독 상태를 치료하려 한다.", actionType: "support" }), true);
    assert.equal(actionNeedsCheck({ body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", actionType: "free" }), false);
    assert.equal(
      actionNeedsCheck({
        body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.",
        actionType: "attack",
      }),
      false
    );
  });
});

describe("TRPG M1 roll economy fixtures", () => {
  it("ordinary dialogue / positioning / preparation skip the check", () => {
    assert.equal(resolveTrpgActionCheckDecision({ body: "「알겠어.」", actionType: "free" }).reason, "talk");
    assert.equal(resolveTrpgActionCheckDecision({ body: "벽에 기대 선다.", actionType: "free" }).needsCheck, false);
    assert.equal(resolveTrpgActionCheckDecision({ body: "자세를 바로잡고 한 발 물러선다.", actionType: "free" }).reason, "ordinary_free");
  });

  it("explicit attack / investigate / persuade / dangerous defense roll", () => {
    assert.equal(resolveTrpgActionCheckDecision({ body: "형체를 벤다.", actionType: "attack" }).reason, "explicit_resolution");
    assert.equal(resolveTrpgActionCheckDecision({ body: "발자국을 살핀다.", actionType: "investigate" }).reason, "explicit_resolution");
    assert.equal(resolveTrpgActionCheckDecision({ body: "경비병을 설득한다.", actionType: "persuade" }).reason, "explicit_resolution");
    assert.equal(resolveTrpgActionCheckDecision({ body: "출입구를 가로막는다.", actionType: "defend" }).needsCheck, true);
  });

  it("contested free action still rolls", () => {
    const decision = resolveTrpgActionCheckDecision({
      body: "경비병에게 거짓말로 통과하려 한다.",
      actionType: "free",
    });
    assert.equal(decision.needsCheck, true);
    assert.equal(decision.reason, "contested");
  });

  it("ordinary valid item use skips a success check; hazardous item use rolls", () => {
    assert.deepEqual(
      resolveTrpgActionCheckDecision({ body: "붕대를 꺼낸다.", actionType: "use_item" }),
      { needsCheck: false, reason: "ordinary_item_use" }
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "잠긴 문에 공구를 억지로 들이민다.", actionType: "use_item" }).needsCheck,
      true
    );
  });

  it("ordinary support is setup; hazardous contested support rolls", () => {
    assert.deepEqual(
      resolveTrpgActionCheckDecision({ body: "렌의 옆을 지키며 뒤를 봐준다.", actionType: "support" }),
      { needsCheck: false, reason: "support_setup" }
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "엄호 사격으로 진입을 막는다.", actionType: "support" }).needsCheck,
      true
    );
  });

  it("bot INTENT is classified before rich visible prose", () => {
    const decision = resolveTrpgActionCheckDecision({
      body: "권태현은 허리의 마체테를  bil며 오래 바라보고 숨을 고른 뒤 옷깃을 정리한다.",
      intent: "권태현은 렌 앞을 가로막으며 출입구 형체의 진입을 막으려 했다.",
      actionType: "defend",
    });
    assert.equal(decision.reason, "explicit_resolution");
    assert.equal(decision.needsCheck, true);
  });

  it("ordinary therapeutic item use skips check; hazardous offensive item use rolls", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "해독제를 사용한다.", actionType: "use_item" }).needsCheck,
      false
    );
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: "중독 치료를 위해 해독제를 투여한다.",
        actionType: "use_item",
      }).needsCheck,
      false
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "붕대를 사용한다.", actionType: "use_item" }).needsCheck,
      false
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "구급키트를 사용한다.", actionType: "use_item" }).needsCheck,
      false
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "연막탄을 적에게 던진다.", actionType: "use_item" }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "잠긴 문에 공구를 억지로 들이민다.", actionType: "use_item" }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "상처를 응급처치한다.", actionType: "support" }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "상처를 응급처치한다.", actionType: "use_item" }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "상처를 치료한다.", actionType: "use_item" }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: "저항하는 적에게 해독제를 억지로 투여한다.",
        actionType: "use_item",
      }).needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: "움직이는 대상에게 치료제를 정밀하게 주입한다.",
        actionType: "use_item",
      }).needsCheck,
      true
    );
  });
});
