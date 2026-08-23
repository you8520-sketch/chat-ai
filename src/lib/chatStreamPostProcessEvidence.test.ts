import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStatusMessageEvidence,
  applyStreamHeartbeatEvidence,
  createEmptyPostProcessPhaseEvidence,
  hasPostProcessPhaseEvidence,
} from "@/lib/chatStreamPostProcessEvidence";

describe("chatStreamPostProcessEvidence", () => {
  it("status widget message marks postprocess + widget evidence", () => {
    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStatusMessageEvidence(evidence, "상태창 생성 중…");
    assert.equal(evidence.postprocessStarted, true);
    assert.equal(evidence.statusWidgetProcessing, true);
    assert.equal(evidence.mainGenerationComplete, true);
    assert.ok(hasPostProcessPhaseEvidence(evidence));
  });

  it("stream_heartbeat finalizing marks finalizing evidence", () => {
    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStreamHeartbeatEvidence(evidence, "finalizing");
    assert.equal(evidence.finalizing, true);
    assert.equal(evidence.postprocessStarted, true);
  });

  it("empty evidence does not qualify for extended reconcile", () => {
    assert.equal(hasPostProcessPhaseEvidence(createEmptyPostProcessPhaseEvidence()), false);
  });
});
