import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegisterPattern,
  classifyRegisterPatternHeuristic,
  extractDialogueLinesForClassification,
  resolveTagPlan,
  CONFIDENCE_GATE_THRESHOLD,
  type ClassifierInput,
  type LlmRegisterClassifier,
} from "./registerPatternClassifier";

const PLATFORM_FORBIDDEN_POLITE = [
  "어색한 혼합 존댓말 (~입니다요, ~하세요요 등)",
  "말투·존댓말 급변 (한 턴 내 격식 ↔ 반말 전환)",
  "반말·하대·친구 말투",
];

// ---- 운영 4종 축약 fixture (DB 실물 기반) ----

const LEON: ClassifierInput = {
  exampleDialog: `[공적] 유저: 적이다!
레온: …각오하십시오.
[사적] 유저: 괜찮아?
레온: …괜찮아요.
[침대] 유저: …불 끌까?
레온: …그래요.`,
  speechSection: "",
  forbiddenSpeechPatterns: PLATFORM_FORBIDDEN_POLITE,
};

const ASH: ClassifierInput = {
  exampleDialog: "",
  speechSection: "",
  forbiddenSpeechPatterns: PLATFORM_FORBIDDEN_POLITE,
};

const KALIAN: ClassifierInput = {
  exampleDialog: `[사적] 유저: 내가 뭘 잘못했는데.
칼리안: 건방진 것. 주제를 알아라.
[사적] 유저: …이제 그만 가볼게.
칼리안: 가지 마. 제발... 네 냄새가 필요해.
[사적] 유저: 아까 사히르가 상처를 봐줬어.
칼리안: 그 새끼가 널 만졌나? 그 손 당장 잘라버려야겠군.`,
  speechSection: "",
  forbiddenSpeechPatterns: PLATFORM_FORBIDDEN_POLITE,
};

// 하유진: 비꼼 존대(감~사하네요) ↔ 반말(치워/변태 새끼들) — 감정 기반 혼합
const HAYUJIN: ClassifierInput = {
  exampleDialog: `유저: 오늘부터 넌 내 소유다.
하유진: 아, 예. 위대하신 황족 나리께서 친히 살려주셔서 정말 감~사하네요.
유저: 먹어. 식기 전에.
하유진: 독이라도 탔나? ...역겨우니까 그거 치워.
유저: 아프진 않아?
하유진: 내 목에 목줄 채우니까 재밌어? 변태 새끼들.`,
  speechSection: "",
  forbiddenSpeechPatterns: PLATFORM_FORBIDDEN_POLITE,
};

describe("extractDialogueLinesForClassification", () => {
  it("keeps char lines, drops user lines and metadata sections", () => {
    const lines = extractDialogueLinesForClassification(`[예시 대사]
…괜찮아요.

[SPEECH CONSISTENCY]
Dialogue style is learned primarily from dialogue examples.

[말투 — 특징]
짧은 문장`);
    assert.deepEqual(lines, ["…괜찮아요."]);
  });

  it("strips speaker prefixes and bracket tags in pair format", () => {
    const lines = extractDialogueLinesForClassification(
      `[사적] 유저: 괜찮아?\n레온: …괜찮아요.`
    );
    assert.deepEqual(lines, ["…괜찮아요."]);
  });
});

describe("heuristic pre-pass — 운영 4종", () => {
  it("레온: existing multi-bucket tags → scene_based_multi (heuristic)", () => {
    const r = classifyRegisterPatternHeuristic(LEON);
    assert.ok(r);
    assert.equal(r.pattern, "scene_based_multi");
    assert.ok(r.confidence >= CONFIDENCE_GATE_THRESHOLD);
  });

  it("에쉬: no dialogue, forbidden bans banmal → single_haeyo (heuristic)", () => {
    const r = classifyRegisterPatternHeuristic(ASH);
    assert.ok(r);
    assert.equal(r.pattern, "single_haeyo");
    assert.ok(r.confidence >= CONFIDENCE_GATE_THRESHOLD);
  });

  it("칼리안: all-banmal lines beat shared forbidden block → single_banmal (heuristic)", () => {
    const r = classifyRegisterPatternHeuristic(KALIAN);
    assert.ok(r);
    assert.equal(r.pattern, "single_banmal");
    assert.ok(r.confidence >= CONFIDENCE_GATE_THRESHOLD);
  });

  it("하유진: mixed polite/banmal without scene evidence → heuristic abstains (LLM escalation)", () => {
    const r = classifyRegisterPatternHeuristic(HAYUJIN);
    assert.equal(r, null);
  });

  it("card context split → scene_based_multi even without tags", () => {
    const r = classifyRegisterPatternHeuristic({
      exampleDialog: "유저: hi\n캐: …네, 알겠습니다.",
      speechSection: "공적인 자리: 다나까체\n유저와 둘만: 해요체",
      forbiddenSpeechPatterns: [],
    });
    assert.ok(r);
    assert.equal(r.pattern, "scene_based_multi");
  });
});

describe("confidence gate (하유진 fixture)", () => {
  const lowConfidenceLlm: LlmRegisterClassifier = async () => ({
    pattern: "emotion_based_multi",
    confidence: 0.55,
    reason: "비꼼 존대와 반말이 감정에 따라 전환 — 장소 축 없음",
  });

  it("하유진 escalates to LLM; emotion_based_multi + low confidence → force single [사적]", async () => {
    const c = await classifyRegisterPattern(HAYUJIN, lowConfidenceLlm);
    assert.equal(c.method, "llm");
    assert.equal(c.pattern, "emotion_based_multi");

    const plan = resolveTagPlan(c);
    assert.equal(plan.mode, "force_private");
    assert.equal(plan.gateTripped, true);
    assert.match(plan.gateReason ?? "", /emotion_based_multi/);
  });

  it("emotion_based_multi trips gate even at HIGH confidence", () => {
    const plan = resolveTagPlan({
      pattern: "emotion_based_multi",
      confidence: 0.95,
      method: "llm",
      reason: "high-confidence emotion switcher",
    });
    assert.equal(plan.mode, "force_private");
    assert.equal(plan.gateTripped, true);
  });

  it("scene_based_multi below threshold trips gate", () => {
    const plan = resolveTagPlan({
      pattern: "scene_based_multi",
      confidence: 0.79,
      method: "llm",
      reason: "uncertain",
    });
    assert.equal(plan.mode, "force_private");
  });

  it("scene_based_multi at/above threshold passes gate", () => {
    const plan = resolveTagPlan({
      pattern: "scene_based_multi",
      confidence: 0.9,
      method: "heuristic",
      reason: "tags",
    });
    assert.equal(plan.mode, "register_map");
    assert.equal(plan.gateTripped, false);
  });

  it("no LLM available → unknown/confidence 0 → gate forces single [사적]", async () => {
    const c = await classifyRegisterPattern(HAYUJIN, undefined);
    assert.equal(c.method, "llm_unavailable");
    const plan = resolveTagPlan(c);
    assert.equal(plan.mode, "force_private");
  });
});
