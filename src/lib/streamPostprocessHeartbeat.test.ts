import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS,
  createStreamPostprocessHeartbeat,
} from "@/lib/streamPostprocessHeartbeat";

describe("createStreamPostprocessHeartbeat", () => {
  it("G: emits stream_heartbeat and cleans up on stop", () => {
    const sent: object[] = [];
    const hb = createStreamPostprocessHeartbeat((obj) => sent.push(obj), {
      intervalMs: 50,
    });
    assert.equal(hb.activeTimerCount(), 0);
    hb.start("postprocess");
    assert.equal(hb.activeTimerCount(), 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { type: "stream_heartbeat", phase: "postprocess" });
    hb.setPhase("status_widget");
    hb.stop();
    assert.equal(hb.activeTimerCount(), 0);
    hb.stop();
    assert.equal(hb.activeTimerCount(), 0);
  });

  it("uses default 12s interval constant", () => {
    assert.equal(STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS, 12_000);
  });
});
