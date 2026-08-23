import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_STREAM_SPEED_PRESETS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  streamCharsPerTickForInterval,
} from "@/lib/chatDisplayPrefs";
import { readFileSync } from "node:fs";
import {
  trpgGmRevealTick,
  trpgRevealContinueCount,
  trpgRevealDurationMs,
  trpgRevealImmediate,
  trpgRevealSessionChanged,
  trpgRevealTargetMs,
  TRPG_REVEAL_BOT_MAX_MS,
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

  it("maps GM reveal to the same chat stream interval and chars-per-tick", () => {
    const instant = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "즉시")!;
    const fast = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "빠름")!;
    const normal = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "보통")!;
    const slow = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "느림")!;
    assert.deepEqual(trpgGmRevealTick(fast.intervalMs), {
      intervalMs: fast.intervalMs,
      charsPerTick: streamCharsPerTickForInterval(fast.intervalMs),
    });
    assert.equal(trpgRevealDurationMs(100, "gm", instant.intervalMs), 0);
    const fastMs = trpgRevealDurationMs(100, "gm", fast.intervalMs);
    const normalMs = trpgRevealDurationMs(100, "gm", normal.intervalMs);
    const slowMs = trpgRevealDurationMs(100, "gm", slow.intervalMs);
    assert.equal(fastMs, 100 * fast.intervalMs);
    assert.equal(normalMs, 100 * normal.intervalMs);
    assert.equal(slowMs, 100 * slow.intervalMs);
    assert.ok(fastMs < normalMs && normalMs < slowMs);
    assert.equal(fast.intervalMs, DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
  });

  it("shows the full text immediately when motion is reduced, reveal is inactive, or speed is instant", () => {
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: true, charCount: 4800 }), true);
    assert.equal(trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800 }), false);
    assert.equal(trpgRevealImmediate({ active: false, reducedMotion: false, charCount: 4800 }), true);
    assert.equal(
      trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800, streamIntervalMs: 0 }),
      true
    );
    assert.equal(
      trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800, streamIntervalMs: 20 }),
      false,
      "legacy fast 20ms stays progressive after migrating to 35ms"
    );
    assert.equal(
      trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 4800, streamIntervalMs: 35 }),
      false
    );
  });

  it("keeps the shown GM count when only stream speed changes", () => {
    const session = { text: "낡은 등불이 흔들린다.", active: true, kind: "gm" as const };
    assert.equal(trpgRevealSessionChanged(session, { ...session }), false);
    assert.equal(trpgRevealSessionChanged(session, { ...session, text: "다른 장면" }), true);
    assert.equal(trpgRevealContinueCount({ sessionChanged: false, shownCount: 12, total: 40 }), 12);
    assert.equal(trpgRevealContinueCount({ sessionChanged: true, shownCount: 12, total: 40 }), 0);
    assert.equal(trpgRevealImmediate({
      active: true,
      reducedMotion: false,
      charCount: 40,
      streamIntervalMs: 0,
    }), true);
    const hook = readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
    assert.match(hook, /trpgRevealContinueCount/);
    assert.match(hook, /trpgRevealSessionChanged/);
    assert.doesNotMatch(hook, /setCount\(0\)/);
  });
});
