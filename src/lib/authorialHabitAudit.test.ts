import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeAuthorialHabits, summarizeAuthorialHabits } from "@/lib/authorialHabitAudit";

describe("authorialHabitAudit", () => {
  it("detects turn-end wait and hand anchors", () => {
    const text = `그는 조용히 서 있었다.\n\n"…알겠습니다."\n\n백하율은 렌의 반응을 기다렸다. 손끝이 차가웠고, 손가락이 떨렸다.`;
    const m = analyzeAuthorialHabits("t1", "test", text);
    assert.ok(m.hitsByCategory.turn_end_wait >= 1);
    assert.ok(m.hitsByCategory.hand_anchor >= 2);
    assert.ok(m.hitsByCategory.finger_anchor >= 1);
  });

  it("detects enumeration and simile", () => {
    const text = `빛도, 그림자도, 소리도 모두 멎었다. 마치 시간이 멈춘 것처럼 공기가 굳었다.`;
    const m = analyzeAuthorialHabits("t2", "test", text);
    assert.ok(m.hitsByCategory.enumeration_triple >= 1);
    assert.ok(m.hitsByCategory.simile_machi >= 1);
  });

  it("summarizes corpus prevalence", () => {
    const a = analyzeAuthorialHabits("a", "s", "손끝. 손끝. 기다렸다.");
    const b = analyzeAuthorialHabits("b", "s", "평범한 문장.");
    const sum = summarizeAuthorialHabits([a, b]);
    assert.equal(sum.sampleCount, 2);
    assert.ok(sum.samplePrevalence.hand_anchor > 0);
  });
});
