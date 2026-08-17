import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  trpgRevealDurationMs,
  trpgRevealImmediate,
  trpgRevealTargetMs,
  TRPG_REVEAL_LONG_MAX_MS,
} from "./revealTiming";

describe("TRPG adaptive reveal", () => {
  it("finishes a short bot body inside the 0.8–1.8s window", () => {
    assert.equal(trpgRevealTargetMs(300), 800);
    assert.equal(trpgRevealTargetMs(800), 1800);
    assert.ok(trpgRevealDurationMs(300) <= 900);
    assert.ok(trpgRevealDurationMs(800) <= 1900);
  });

  it("does not fake-type a long GM body for ~20 seconds", () => {
    const longGm = trpgRevealDurationMs(4800);
    assert.ok(longGm <= TRPG_REVEAL_LONG_MAX_MS);
    assert.ok(longGm < 4000);
    assert.ok(trpgRevealDurationMs(5000) <= TRPG_REVEAL_LONG_MAX_MS);
    const oldFixed = Math.ceil(4800 / 4) * 16;
    assert.ok(oldFixed > 18000);
    assert.ok(longGm < oldFixed / 4);
  });

  it("shows the full text immediately when motion is reduced", () => {
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: true, charCount: 4800 }), true);
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800 }), false);
    assert.equal(trpgRevealImmediate({ active: false, reducedMotion: false, charCount: 4800 }), true);
  });
});
