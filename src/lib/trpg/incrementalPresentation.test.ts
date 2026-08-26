import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLiveRoundPresentationReady,
  liveRoundCanonicalVisibleCount,
  shouldGateLiveRoundPresentation,
  shouldShowLiveRoundWaitCopy,
  walkLiveRoundSnapshots,
} from "./roundPresentation";

const order = [10, 20, 30];
const human = { participantId: 10, name: "유저", kind: "human" as const, body: "문을 연다.", revealed: true };
const bot1 = { participantId: 20, name: "동료1", kind: "ai_character" as const, body: "뒤를 본다.", revealed: true };
const bot2 = { participantId: 30, name: "동료2", kind: "ai_character" as const, body: "조용히 움직인다.", revealed: true };
const humanRoll = { participantId: 10, d20: 14, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 16 };
const bot1Roll = { participantId: 20, d20: 8, dc: 12, tier: "FAILURE" as const, statKey: "dex", finalScore: 10 };
const bot2Roll = { participantId: 30, d20: 17, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 19 };

describe("TRPG incremental partial round client lifecycle", () => {
  it("SNAPSHOT 1: human persisted — visible, processing non-blocking", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human],
        rolls: [],
        resolutionOrder: order,
      },
    ]);
    const step = walked.steps[0]!;
    assert.equal(isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }), true);
    assert.equal(step.ready, true);
    assert.equal(step.mode, "cinematic");
    assert.equal(step.started, true);
    assert.deepEqual(step.visibleCanonicalActionIds, [10]);

    const gate = shouldGateLiveRoundPresentation({
      mode: "idle",
      previewReady: true,
      livePending: false,
      presentationStarting: true,
    });
    assert.equal(gate, true);
    const preCinematicVisible = liveRoundCanonicalVisibleCount({
      gated: gate,
      mode: "idle",
      actions: [human],
      revealedActorIds: [],
    });
    assert.equal(preCinematicVisible, 0);
    assert.equal(
      liveRoundCanonicalVisibleCount({
        gated: false,
        mode: "idle",
        actions: [human],
        revealedActorIds: [],
      }),
      1
    );
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "bots",
        mode: "cinematic",
        presentationStarting: false,
      }),
      false
    );
  });

  it("SNAPSHOT 2: human + bot1 — human session continues, bot1 appended", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: order,
      },
    ]);
    const [s1, s2] = walked.steps;
    assert.equal(s1?.sessionKey, s2?.sessionKey);
    assert.equal(s2?.restarted, false);
    assert.deepEqual(s2?.actors.map((a) => a.actorId), [10, 20]);
    assert.deepEqual(s2?.visibleCanonicalActionIds, [10]);
  });

  it("SNAPSHOT 3: human + bot1 + bot2 + rolls — session stable, dice path available", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "GENERATING_NARRATION",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
    ]);
    const [s2, s3] = walked.steps;
    assert.equal(s2?.restarted, false);
    assert.equal(s3?.restarted, false);
    assert.equal(s2?.sessionKey, s3?.sessionKey);
    assert.deepEqual(s3?.actors.map((a) => a.actorId), order);
    assert.ok(s3?.actors.every((a) => a.action));
    assert.ok(s3?.actors.filter((a) => a.roll).length === 3);
  });

  it("SNAPSHOT 4: GM phase — presentation continues without reload", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "GENERATING_NARRATION",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
      {
        phase: "GENERATING_NARRATION",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
    ]);
    assert.equal(walked.restartCount, 0);
    assert.equal(walked.steps[1]?.sessionKey, walked.steps[0]?.sessionKey);
  });
});
