import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { observeSuggestedRepliesDecisionQuality } from "./decisionQualityObservatory";

function reply(seed: string, length = 80): string {
  return (seed + "가".repeat(length)).slice(0, length);
}

describe("P3-A suggested replies decision quality observatory", () => {
  it("accepts a canonical three-kind raw decision without changing it", () => {
    const raw = JSON.stringify({
      items: [
        { kind: "natural", text: reply("*고개를 기울이며* 자연스럽게 다음 말을 건넨다. ") },
        { kind: "twist", text: reply("*잠시 생각하다* 예상 밖의 질문으로 방향을 튼다. ") },
        { kind: "banter", text: reply("*피식 웃으며* 가볍게 빈정대면서도 대화를 잇는다. ") },
      ],
    });

    assert.deepEqual(observeSuggestedRepliesDecisionQuality(raw), {
      contractValid: true,
      issues: [],
      observedKinds: ["natural", "twist", "banter"],
      itemCount: 3,
    });
  });

  it("reports category disagreement instead of repairing or relabeling it", () => {
    const raw = JSON.stringify({
      items: [
        { kind: "natural", text: reply("정석 반응 ") },
        { kind: "natural", text: reply("다른 정석 반응 ") },
        { kind: "escalate", text: reply("레거시 분류 반응 ") },
      ],
    });

    const observation = observeSuggestedRepliesDecisionQuality(raw);
    assert.equal(observation.contractValid, false);
    assert.ok(observation.issues.includes("duplicate_kind"));
    assert.ok(observation.issues.includes("unknown_kind"));
    assert.ok(observation.issues.includes("missing_kind"));
    assert.deepEqual(observation.observedKinds, ["natural"]);
  });

  it("reports malformed, incomplete, duplicate, and length-invalid raw output", () => {
    assert.deepEqual(observeSuggestedRepliesDecisionQuality("not-json"), {
      contractValid: false,
      issues: ["malformed_json"],
      observedKinds: [],
      itemCount: 0,
    });

    const duplicated = reply("같은 답변 ");
    const raw = JSON.stringify({
      items: [
        { kind: "natural", text: duplicated },
        { kind: "twist", text: duplicated },
        { kind: "banter", text: "짧음" },
        { kind: "banter", text: reply("초과 항목 ") },
      ],
    });
    const observation = observeSuggestedRepliesDecisionQuality(raw);
    assert.equal(observation.contractValid, false);
    assert.ok(observation.issues.includes("wrong_item_count"));
    assert.ok(observation.issues.includes("duplicate_kind"));
    assert.ok(observation.issues.includes("duplicate_text"));
    assert.ok(observation.issues.includes("text_out_of_bounds"));
  });
});
