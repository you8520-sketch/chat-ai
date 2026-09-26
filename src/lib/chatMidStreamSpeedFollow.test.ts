import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CHAT_DISPLAY_PREFS,
  isStreamSpeedOnlyDisplayPrefsChange,
  withStreamSpeed,
} from "@/lib/chatDisplayPrefs";
import { resolveChatLiveFollowMotionProfile } from "@/lib/chatLiveFollow";
import { createStreamReveal } from "@/lib/streamReveal";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

describe("mid-stream speed change must not manual-detach follow", () => {
  it("C1: stream-speed-only prefs change is detected and layout prefs unchanged", () => {
    const prev = DEFAULT_CHAT_DISPLAY_PREFS;
    const next = withStreamSpeed(prev, 40);
    assert.equal(isStreamSpeedOnlyDisplayPrefsChange(prev, next), true);
    assert.equal(isStreamSpeedOnlyDisplayPrefsChange(next, prev), true);
  });

  it("C1: font/layout prefs change is not stream-speed-only", () => {
    const prev = DEFAULT_CHAT_DISPLAY_PREFS;
    const next = { ...prev, fontSizePreset: "large" as const };
    assert.equal(isStreamSpeedOnlyDisplayPrefsChange(prev, next), false);
  });

  it("C2/C3: camera profile ignores stream cadence — speed click cannot alter motion owner", () => {
    const fastProfile = resolveChatLiveFollowMotionProfile({
      streamIntervalMs: 16,
      streamCharsPerTick: 1,
    });
    const normalProfile = resolveChatLiveFollowMotionProfile({
      streamIntervalMs: 40,
      streamCharsPerTick: 1,
    });
    assert.deepEqual(fastProfile, normalProfile);
    assert.equal(fastProfile.mode, "geometry-damped");
    assert.equal(fastProfile.streamIntervalMs, undefined);
  });

  it("S3/S4: active reveal interval switches on syncOptions during streaming", async () => {
    let intervalMs = 16;
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      () => streamRevealOptionsFromInterval(intervalMs)
    );
    reveal.enqueue("x".repeat(100));
    await new Promise((r) => setTimeout(r, 48));
    const atFast = [...shown].length;

    intervalMs = 40;
    reveal.syncOptions();
    await new Promise((r) => setTimeout(r, 120));
    const atNormal = [...shown].length;

    intervalMs = 16;
    reveal.syncOptions();
    await new Promise((r) => setTimeout(r, 48));
    const atFastAgain = [...shown].length;

    assert.ok(atNormal - atFast <= 4);
    assert.ok(atFastAgain - atNormal >= 2);
    reveal.flush();
  });
});
