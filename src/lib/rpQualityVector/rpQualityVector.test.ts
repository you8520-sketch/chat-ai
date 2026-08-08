import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLengthBand,
  computeCompositionMetrics,
  computeContinuityAutoAudit,
  computeRpQualityVectorV2,
  computeSettingExactOverlapAudit,
  CONTINUITY_FIXTURE_MEASURES,
  CONTINUITY_HUMAN_SCHEMA,
  SETTING_RECITAL_HUMAN_SCHEMA,
  QUALITY_GATE_HUMAN_SCHEMA,
  KNOWLEDGE_LEAK_HARD_GATE,
} from "./index";

describe("RP Quality Vector V2", () => {
  it("classifies length bands including known C2-R collapses", () => {
    assert.equal(classifyLengthBand(380), "DENSITY_COLLAPSE");
    assert.equal(classifyLengthBand(769), "DENSITY_COLLAPSE");
    assert.equal(classifyLengthBand(1900), "STRONG_LENGTH_REGRESSION");
    assert.equal(classifyLengthBand(2500), "REVIEW_REQUIRED");
    assert.equal(classifyLengthBand(3000), "SOFT_ACCEPT");
    assert.equal(classifyLengthBand(3500), "IDEAL");
  });

  it("computes dialogue/narration char shares (production quotes only)", () => {
    const text = [
      "에녹은 안개 너머를 응시했다. 금속 마찰음이 가까워지고 있었다.",
      "",
      "“저쪽이에요. 같이 가요?”",
      "",
      "그는 고개를 저었다.",
    ].join("\n");
    const c = computeCompositionMetrics(text);
    assert.ok(c.dialogue_char_share > 0 && c.dialogue_char_share < 0.5);
    assert.ok(c.narration_char_share > 0.5);
    assert.equal(
      Number((c.dialogue_char_share + c.narration_char_share).toFixed(4)),
      1
    );
    assert.ok("dialogue_paragraph_share" in c);
  });

  it("flags CURRENT_INPUT_REPLAY when user action/speech is re-enacted", () => {
    const user =
      "*렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞춘다.* …괜찮아요? 제가 좀 도와드릴게요.";
    const bad = [
      "렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞췄다.",
      "",
      "“괜찮아요? 제가 좀 도와드릴게요.”",
      "",
      "에녹은 차갑게 내려다보았다.",
    ].join("\n");
    const audit = computeContinuityAutoAudit({
      output: bad,
      currentUserInput: user,
      priorAssistantText: "에녹은 벽에 기대어 서 있었다.",
    });
    assert.equal(audit.current_input_dialogue_echo || audit.current_input_overlap_alarm, true);
    assert.equal(audit.continuity_review_required, true);
  });

  it("flags RECENT_SCENE_REPLAY when opening mirrors prior assistant", () => {
    const prior =
      "에녹은 무너진 상가의 콘크리트 잔해 너머로 짙은 회색 안개를 응시했다. 비명과 금속 마찰음이 겹쳐 들렸다.";
    const replay = [
      "에녹은 무너진 상가의 콘크리트 잔해 너머로 짙은 회색 안개를 응시했다. 비명과 금속 마찰음이 겹쳐 들렸다.",
      "",
      "그제야 렌의 질문을 들었다.",
    ].join("\n");
    const audit = computeContinuityAutoAudit({
      output: replay,
      currentUserInput: "누구세요?",
      priorAssistantText: prior,
    });
    assert.equal(audit.opening_paragraph_mirrors_prior || audit.recent_assistant_overlap_alarm, true);
  });

  it("setting exact-overlap alarms on long contiguous copy", () => {
    const canon =
      "전 성채 최정예 저격수였으며 통제를 중시하고 총성을 극도로 경계한다. 방독면 없이 포자 안개에 노출되지 않는다.";
    const out = `그는 ${canon} 그것이 그의 전부였다.`;
    const audit = computeSettingExactOverlapAudit({
      output: out,
      sources: [{ bucket: "CHARACTER_CANON", text: canon }],
    });
    assert.equal(audit.alarm_18_plus, true);
  });

  it("human schemas are documented for recital + continuity", () => {
    assert.ok(SETTING_RECITAL_HUMAN_SCHEMA.KNOWLEDGE_LEAK.includes("HARD"));
    assert.ok(CONTINUITY_HUMAN_SCHEMA.CURRENT_INPUT_REPLAY.includes("재연"));
    assert.ok(CONTINUITY_HUMAN_SCHEMA.RECENT_SCENE_REPLAY.includes("재연"));
    assert.ok(QUALITY_GATE_HUMAN_SCHEMA.CHARACTER_FIDELITY.includes("1–5"));
    assert.deepEqual(CONTINUITY_FIXTURE_MEASURES.G5, [
      "INTRO_REPLAY",
      "CURRENT_INPUT_REPLAY",
      "SETTING_RECITAL",
      "FIRST_TURN_SPECIAL_TREATMENT",
      "SCENE_ADVANCEMENT",
    ]);
    assert.deepEqual(CONTINUITY_FIXTURE_MEASURES.G6, ["TURN1_REPLAY_ON_TURN2"]);
    assert.ok(KNOWLEDGE_LEAK_HARD_GATE.includes("hard fail"));
  });

  it("computeRpQualityVectorV2 wires continuity + length alarms", () => {
    const short = "짧은 출력.";
    const v = computeRpQualityVectorV2({
      text: short,
      currentUserInput: "안녕",
      incomplete: true,
    });
    assert.equal(v.length.length_band, "DENSITY_COLLAPSE");
    assert.ok(v.hard_alarms.includes("DENSITY_COLLAPSE"));
    assert.ok(v.hard_alarms.includes("INCOMPLETE"));
    assert.ok(v.continuity);
  });
});
