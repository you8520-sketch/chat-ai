import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { THINKING_BENCH_CASES, thinkingBenchCaseById } from "./thinkingBench/fixtures";
import { evaluateThinkingBenchOutput } from "./thinkingBench/quality";
import { countKoreanChars, extractRawUsage, median } from "./thinkingBench/usage";
import { TRPG_GM_SYSTEM } from "./gmPrompt";
import { TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";

describe("TRPG GM thinking bench fixtures", () => {
  it("keeps six fixed cases with identical ON/OFF prompt strings", () => {
    assert.equal(THINKING_BENCH_CASES.length, 6);
    for (const row of THINKING_BENCH_CASES) {
      assert.equal(row.system, TRPG_GM_SYSTEM);
      assert.ok(row.user.length > 200);
      assert.equal(row.system, thinkingBenchCaseById(row.id).system);
      assert.equal(row.user, thinkingBenchCaseById(row.id).user);
    }
  });

  it("covers opening, authored plan, bots, mixed dice, and resolution order", () => {
    const c1 = thinkingBenchCaseById("case1_world_opening");
    const c2 = thinkingBenchCaseById("case2_authored_opening");
    const c3 = thinkingBenchCaseById("case3_simple_round");
    const c4 = thinkingBenchCaseById("case4_human_bot");
    const c5 = thinkingBenchCaseById("case5_two_bots");
    const c6 = thinkingBenchCaseById("case6_complex_scenario");
    assert.equal(c1.opening, true);
    assert.equal(c1.actions.length, 0);
    assert.equal(c1.user.includes("[SCENARIO PLAN]"), false);
    assert.equal(c2.opening, true);
    assert.match(c2.user, /\[SCENARIO PLAN\]/);
    assert.match(c2.user, /HIDDEN_CORE_SWAP_TOKEN/);
    assert.equal(c3.actions.length, 1);
    assert.equal(c3.actions[0]?.kind, "human");
    assert.equal(c4.actions.filter((a) => a.kind === "bot").length, 1);
    assert.equal(c5.actions.filter((a) => a.kind === "bot").length, 2);
    assert.match(c5.user, /\[RESOLUTION ORDER\]/);
    assert.match(c6.user, /\[RESOLUTION ORDER\]/);
    assert.equal(c6.actions.some((a) => a.tier === "FAILURE"), true);
    assert.equal(c6.actions.some((a) => a.tier === "SUCCESS" || a.tier === "GREAT_SUCCESS"), true);
    assert.match(c6.user, /이야기 단계: ESCALATION/);
    assert.equal(TRPG_GM_MODEL, "deepseek-v4-pro-0813");
    assert.equal(TRPG_GM_MAX_TOKENS, 12288);
  });
});

describe("TRPG GM thinking bench quality", () => {
  const fixture = thinkingBenchCaseById("case6_complex_scenario");

  it("accepts a contract-valid scene", () => {
    const raw = `<<<NARRATION>>>
세린이 먼저 모퉁이를 돌아 잔류 인원 둘을 바닥에 눌렀다. 제압에 성공한 뒤 민재 쪽을 본다.
민재는 키카드를 찍고 레버를 내리려다 실패했다. 문이 꿈쩍하지 않는다.
하루: "민재, 냉각 밸브부터요. 레버는 그다음입니다."
GM: 봉인은 아직이다. 잔류 인원은 묶였고 코어 박동은 여전하다. 밸브를 잠글지, 다시 레버를 칠지 고르라.
<<<DELTA>>>
{"players":[{"participantId":1,"hp":16,"conditions":["타박상"],"inventoryAdd":[],"inventoryRemove":[],"location":"코어 접근 복도"}],"location":"코어 접근 복도","next_round_context":"냉각 밸브를 잠글지 레버를 다시 칠지","campaign_finished":false,"storyPhase":"CLIMAX_AVAILABLE"}`;
    const report = evaluateThinkingBenchOutput({ fixture, rawText: raw });
    assert.equal(report.parseSuccess, true);
    assert.equal(report.narrationPresent, true);
    assert.equal(report.deltaValid, true);
    assert.equal(report.actionOmissions.length, 0);
    assert.equal(report.diceContradictions.length, 0);
    assert.equal(report.scenarioErrors.some((e) => e.code === "hidden_plan_leak"), false);
  });

  it("flags parse failure, omission, dice invert, leak, and bad delta", () => {
    const raw = `<<<NARRATION>>>
민재는 레버를 내려 봉인에 성공했다. HIDDEN_CORE_SWAP_TOKEN 이 드러난다.
세린은 뒤에서 기다린다.
<<<DELTA>>>
{"players":[{"participantId":1,"hp":99,"inventoryRemove":["존재하지않는물건"]}],"campaign_finished":true,"storyPhase":"FINISHED"}`;
    const report = evaluateThinkingBenchOutput({ fixture, rawText: raw });
    assert.equal(report.actionOmissions.some((e) => e.detail.includes("하루")), true);
    assert.equal(report.diceContradictions.some((e) => e.code === "dice_failure_as_success"), true);
    assert.equal(report.scenarioErrors.some((e) => e.code === "hidden_plan_leak"), true);
    assert.equal(report.scenarioErrors.some((e) => e.code === "campaign_finished_abuse"), true);
    assert.equal(report.deltaValid, false);
    assert.ok(report.stateErrors.length >= 1);
  });
});

describe("TRPG GM thinking bench usage logger", () => {
  it("does not invent reasoning_tokens when the provider omits them", () => {
    const usage = extractRawUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 3 },
        mystery_field: 7,
      },
    });
    assert.equal(usage.prompt_tokens, 10);
    assert.equal(usage.completion_tokens, 20);
    assert.equal(usage.cached_tokens, 3);
    assert.equal(usage.reasoning_tokens, "unavailable");
    assert.equal(usage.extra.mystery_field, 7);
    assert.equal(countKoreanChars("안녕 hello"), 2);
    assert.equal(median([90, 10, 20]), 20);
  });
});
