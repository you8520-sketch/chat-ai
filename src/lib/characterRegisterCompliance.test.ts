import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyLineRegister,
  evaluateRegisterCompliance,
  isNeutralScoringLine,
} from "@/lib/characterRegisterCompliance";

describe("characterRegisterCompliance", () => {
  it("classifies common haeyo endings including 줘요/자요", () => {
    assert.equal(classifyLineRegister("…괜찮아요."), "haeyo");
    assert.equal(classifyLineRegister("조금만 더 가까이 있어 줘요."), "haeyo");
    assert.equal(classifyLineRegister("...잘 자요, 렌."), "haeyo");
    assert.equal(classifyLineRegister("아직... 눈 뜨지 말아줘요."), "haeyo");
  });

  it("treats 괜아나요 typo as haeyo intent", () => {
    assert.equal(classifyLineRegister("…괜아나요."), "haeyo");
  });

  it("marks neutral fragments as non-scorable", () => {
    assert.equal(isNeutralScoringLine("…이쪽으로."), true);
    assert.equal(isNeutralScoringLine("......."), true);
    assert.equal(isNeutralScoringLine("렌…."), true);
    assert.equal(isNeutralScoringLine("...렌."), true);
    assert.equal(isNeutralScoringLine("끄응..."), true);
    assert.equal(isNeutralScoringLine("...아직."), true);
    assert.equal(isNeutralScoringLine("…괜찮아요."), false);
    assert.equal(classifyLineRegister("부탁이에요."), "haeyo");
  });

  it("does not treat 1st-person 나 as register drift when haeyo endings present", () => {
    const text = `"……괜찮아요."\n\n"나는... 당신에게 끌리고 있어요. 부정할 수 없을 만큼."\n\n"…옆에 있어도 될까요."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("staging run 4: haeyo + short fragment passes", () => {
    const text = `"…괜찮아요."\n\n"…이쪽으로."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.complianceRate, 100);
  });

  it("staging run 8: typo-only line passes register (generation quality separate)", () => {
    const text = `"…괜아나요."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("standalone 네 is polite affirmative, not banmal drift", () => {
    const text = `"…네."\n\n"…괜찮아요."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("still flags real banmal drift", () => {
    const text = `"…됐다."\n\n"그만해."\n\n"…괜찮아요."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.ok(r.driftKinds.includes("banmal"));
    assert.ok(r.complianceRate < 70);
  });

  it("generic -요 endings count as haeyo (만요/그럼요/거든요/나요)", () => {
    assert.equal(classifyLineRegister("잠깐만요."), "haeyo");
    assert.equal(classifyLineRegister("그럼요."), "haeyo");
    assert.equal(classifyLineRegister("여긴 밤이 길어서… 대화하기엔 더없이 좋은 장소거든요."), "haeyo");
    assert.equal(classifyLineRegister("솔직하지 않은 적이 있었나요."), "haeyo");
    assert.equal(classifyLineRegister("…솔직히요."), "haeyo");
    assert.equal(classifyLineRegister("무슨 말을 하고 싶은 거예요, 렌 씨."), "haeyo");
  });

  it("vocative name fragments are neutral", () => {
    assert.equal(isNeutralScoringLine("렌 씨."), true);
    assert.equal(isNeutralScoringLine("…렌 씨는."), true);
  });

  it("banmal-expected: common casual endings match", () => {
    const text = `"…왔어?"\n\n"별일 아니야."\n\n"그만해."\n\n"먼저 가라."\n\n"같이 가자."\n\n"…뭐 하는데."\n\n"알았다고."`;
    const r = evaluateRegisterCompliance(text, "banmal");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("banmal-expected: open-ended casual endings are not misses (unmarked register)", () => {
    const text = `"무슨 말을 듣고 싶은 건데."\n\n"할 말 있으면 꺼내."\n\n"넌 여기서 기다려."\n\n"너는 빠져."\n\n"출발은 10분 뒤."\n\n"죽어도 할 말 없고."\n\n"내가 혼자 간다고 했나."\n\n"말할 마음 없으면 괜히 불러내지 마."`;
    const r = evaluateRegisterCompliance(text, "banmal");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("banmal-expected: polite markers anywhere in line still block the unmarked pass", () => {
    const text = `"그건 좀 곤란해요, 아무래도."\n\n"알겠습니다, 손님."`;
    const r = evaluateRegisterCompliance(text, "banmal");
    assert.equal(r.complianceRate, 0);
  });

  it("banmal-expected: haeyo lines are drift, not matches", () => {
    const text = `"…왔어?"\n\n"괜찮아요."`;
    const r = evaluateRegisterCompliance(text, "banmal");
    assert.ok(r.driftKinds.includes("haeyo"));
    assert.equal(r.complianceRate, 50);
  });

  it("banmal-expected: neutral fragments do not drag score down", () => {
    const text = `"…렌 씨."\n\n"……."\n\n"별일 아니야."`;
    const r = evaluateRegisterCompliance(text, "banmal");
    assert.equal(r.complianceRate, 100);
  });

  it("haeyo-expected: new banmal endings do not create false drift on -요 forms", () => {
    const text = `"괜찮아요."\n\n"기다릴게요."\n\n"그랬는데요."\n\n"갈 거예요."`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.driftKinds.length, 0);
    assert.equal(r.complianceRate, 100);
  });

  it("curly-quote dialogue is scored", () => {
    const text = `“…괜찮아요.”\n\n“들었어요.”`;
    const r = evaluateRegisterCompliance(text, "haeyo");
    assert.equal(r.dialogueCount, 2);
    assert.equal(r.complianceRate, 100);
  });
});
