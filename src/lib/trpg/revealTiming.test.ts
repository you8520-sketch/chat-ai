import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  trpgRevealDurationMs,
  trpgRevealImmediate,
  trpgRevealTargetMs,
  TRPG_REVEAL_BOT_MAX_MS,
  TRPG_REVEAL_GM_CAP_MS,
} from "./revealTiming";

describe("TRPG adaptive reveal", () => {
  it("finishes a short bot body inside the 0.8–1.8s window", () => {
    assert.equal(trpgRevealTargetMs(300), 800);
    assert.equal(trpgRevealTargetMs(800), 1800);
    assert.ok(trpgRevealDurationMs(300) <= 900);
    assert.ok(trpgRevealDurationMs(800) <= 1900);
  });

  it("keeps bot actions on the short window even if the helper is called with a long length", () => {
    assert.equal(trpgRevealTargetMs(3000, "bot"), TRPG_REVEAL_BOT_MAX_MS);
    assert.ok(trpgRevealDurationMs(3000, "bot") <= TRPG_REVEAL_BOT_MAX_MS + 32);
  });

  it("uses a length-adaptive reading window for live GM narration", () => {
    const gm500 = trpgRevealDurationMs(500, "gm");
    const gm2000 = trpgRevealDurationMs(2000, "gm");
    const gm3000 = trpgRevealDurationMs(3000, "gm");
    const gm3500 = trpgRevealDurationMs(3500, "gm");
    const gm5000 = trpgRevealDurationMs(5000, "gm");
    const gm6000 = trpgRevealDurationMs(6000, "gm");

    assert.ok(gm500 >= 1_000 && gm500 <= 1_600, `500 chars → ${gm500}`);
    assert.ok(gm2000 >= 4_000 && gm2000 <= 5_200, `2000 chars → ${gm2000}`);
    assert.ok(gm3000 >= 6_000 && gm3000 <= 7_200, `3000 chars → ${gm3000}`);
    assert.ok(gm3500 >= 6_500 && gm3500 <= 8_200, `3500 chars → ${gm3500}`);
    assert.ok(gm5000 >= 9_000 && gm5000 <= 10_200, `5000 chars → ${gm5000}`);
    assert.equal(trpgRevealTargetMs(5000, "gm"), TRPG_REVEAL_GM_CAP_MS);
    assert.ok(gm6000 <= TRPG_REVEAL_GM_CAP_MS + 32);
    assert.ok(gm5000 < 20_000);
  });

  it("shows the full text immediately when motion is reduced or reveal is inactive", () => {
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: true, charCount: 4800 }), true);
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800 }), false);
    assert.equal(trpgRevealImmediate({ active: false, reducedMotion: false, charCount: 4800 }), true);
  });
});
