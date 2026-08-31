/**
 * R1–R14: user scroll-intent listeners must survive idle ACTION_INPUT after GM.
 *
 * #768/#790 covered detach *after* manualDetached was set (queueSessionKey reset,
 * smooth cancellation, passive rejoin). Missing case: user attempts detach while
 * idle but physical intent listeners were unmounted behind liveRevealActive.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  shouldDetachLiveFollowOnKey,
  shouldDetachLiveFollowOnTouchDelta,
  shouldDetachLiveFollowOnWheel,
} from "./followLatest";
import { trpgRoundPresentationSessionKey } from "./roundPresentation";

const ROUND_KEY = trpgRoundPresentationSessionKey({
  roundNumber: 4,
  rolls: [{ participantId: 1, d20: 10, dc: 12, tier: "FAIL" }],
  actions: [{ participantId: 1 }],
  ready: true,
});

type IdleRoomModel = {
  roundShowMode: "idle" | "cinematic";
  presentationStarting: boolean;
  activeDeclarationActorId: number | null;
  currentNarration: string;
  intentListenersMounted: boolean;
  manualDetached: boolean;
  followLatest: boolean;
  programmaticScrollCount: number;
  queueSessionKey: string;
};

function liveRevealActive(model: Pick<
  IdleRoomModel,
  "roundShowMode" | "presentationStarting" | "activeDeclarationActorId" | "currentNarration"
>): boolean {
  return (
    model.roundShowMode === "cinematic" ||
    model.presentationStarting ||
    model.activeDeclarationActorId != null ||
    Boolean(model.currentNarration.trim())
  );
}

/** Pre-fix: physical intent listeners gated behind liveRevealActive. */
function mountIntentListenersBefore(model: IdleRoomModel): IdleRoomModel {
  return {
    ...model,
    intentListenersMounted: liveRevealActive(model),
  };
}

/** Post-fix: room-lifetime listeners always mounted while TrpgCampaignRoom is mounted. */
function mountIntentListenersAfter(model: IdleRoomModel): IdleRoomModel {
  return { ...model, intentListenersMounted: true };
}

function idleAfterGmModel(): IdleRoomModel {
  return {
    roundShowMode: "idle",
    presentationStarting: false,
    activeDeclarationActorId: null,
    currentNarration: "",
    intentListenersMounted: false,
    manualDetached: false,
    followLatest: true,
    programmaticScrollCount: 0,
    queueSessionKey: "",
  };
}

function wheelUpIntent(model: IdleRoomModel): IdleRoomModel {
  if (!model.intentListenersMounted || !shouldDetachLiveFollowOnWheel(-120)) return model;
  return { ...model, manualDetached: true, followLatest: false };
}

function keyUpIntent(model: IdleRoomModel, key: string): IdleRoomModel {
  if (!model.intentListenersMounted || !shouldDetachLiveFollowOnKey(key)) return model;
  return { ...model, manualDetached: true, followLatest: false };
}

function touchOlderIntent(model: IdleRoomModel): IdleRoomModel {
  if (!model.intentListenersMounted || !shouldDetachLiveFollowOnTouchDelta(-40)) return model;
  return { ...model, manualDetached: true, followLatest: false };
}

function gutterPointerIntent(model: IdleRoomModel, clientX: number, viewportWidth = 1200): IdleRoomModel {
  if (!model.intentListenersMounted) return model;
  const gutter = viewportWidth - clientX;
  if (gutter > 24) return model;
  return { ...model, manualDetached: true, followLatest: false };
}

function contentPointerIntent(model: IdleRoomModel, clientX: number, viewportWidth = 1200): IdleRoomModel {
  return gutterPointerIntent(model, clientX, viewportWidth);
}

function scrollToFollowOwnerAttempt(model: IdleRoomModel): IdleRoomModel {
  if (!model.followLatest || model.manualDetached) return model;
  return { ...model, programmaticScrollCount: model.programmaticScrollCount + 1 };
}

function explicitRejoin(model: IdleRoomModel): IdleRoomModel {
  const restored = { ...model, manualDetached: false, followLatest: true };
  return scrollToFollowOwnerAttempt(restored);
}

function extractUserIntentListenerEffect(source: string): string {
  const wheelIdx = source.indexOf('window.addEventListener("wheel", onWheel');
  assert.ok(wheelIdx >= 0, "wheel listener registration must exist");
  const effectStart = source.lastIndexOf("useEffect(() => {", wheelIdx);
  assert.ok(effectStart >= 0, "user-intent useEffect must exist");
  const effectEnd = source.indexOf("}, [detachLiveFollow]", effectStart);
  assert.ok(effectEnd >= 0, "user-intent effect must depend on detachLiveFollow only");
  return source.slice(effectStart, effectEnd);
}

describe("idle after GM — listener lifetime root cause", () => {
  it("R1 BEFORE: idle after GM + wheel-up cannot detach when listeners gated", () => {
    let model = mountIntentListenersBefore(idleAfterGmModel());
    assert.equal(liveRevealActive(model), false);
    assert.equal(model.intentListenersMounted, false);
    model = wheelUpIntent(model);
    assert.equal(model.manualDetached, false);
    assert.equal(model.followLatest, true);
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1, "auto-follow yanks while still attached");
  });

  it("R1 AFTER: idle after GM + wheel-up detaches via room-lifetime listeners", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    assert.equal(model.intentListenersMounted, true);
    model = wheelUpIntent(model);
    assert.equal(model.manualDetached, true);
    assert.equal(model.followLatest, false);
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R2: idle + PageUp detaches when listeners mounted", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = keyUpIntent(model, "PageUp");
    assert.equal(model.manualDetached, true);
    assert.equal(model.followLatest, false);
  });

  it("R3: idle + touch toward older detaches when listeners mounted", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = touchOlderIntent(model);
    assert.equal(model.manualDetached, true);
  });

  it("R4: idle + scrollbar gutter pointer detaches", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = gutterPointerIntent(model, 1190);
    assert.equal(model.manualDetached, true);
  });

  it("R5: manual detached idle + NEXT_ACTION update → 0 scrolls", () => {
    let model = mountIntentListenersAfter({ ...idleAfterGmModel(), manualDetached: true, followLatest: false });
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R6: manual detached idle + suggestions arrive → 0 scrolls", () => {
    let model = mountIntentListenersAfter({ ...idleAfterGmModel(), manualDetached: true, followLatest: false });
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R7: manual detached idle + layout growth → 0 scrolls", () => {
    let model = mountIntentListenersAfter({ ...idleAfterGmModel(), manualDetached: true, followLatest: false });
    const growth = decideLiveFollowOnGrowth({ following: model.followLatest });
    assert.equal(growth.autoFollow, false);
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R8: manual detached + same campaign snapshot polling → remains detached", () => {
    let model = mountIntentListenersAfter({
      ...idleAfterGmModel(),
      manualDetached: true,
      followLatest: false,
      queueSessionKey: ROUND_KEY,
    });
    model = { ...model, queueSessionKey: ROUND_KEY };
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.manualDetached, true);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R9: manual detached + queueSessionKey change → remains detached", () => {
    let model = mountIntentListenersAfter({
      ...idleAfterGmModel(),
      manualDetached: true,
      followLatest: false,
      queueSessionKey: "3|live-cinematic",
    });
    model = { ...model, queueSessionKey: "4|live-cinematic" };
    const activity = decideLiveFollowUpdate({ following: model.followLatest, activityChanged: true });
    assert.equal(activity.autoFollow, false);
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.manualDetached, true);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("R10: explicit rejoin → exactly one intended scroll", () => {
    let model = mountIntentListenersAfter({ ...idleAfterGmModel(), manualDetached: true, followLatest: false });
    model = explicitRejoin(model);
    assert.equal(model.manualDetached, false);
    assert.equal(model.followLatest, true);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("R11: attached user + GM reveal → auto-follow preserved", () => {
    let model = mountIntentListenersAfter({
      ...idleAfterGmModel(),
      roundShowMode: "idle",
      currentNarration: "GM still revealing…",
      manualDetached: false,
      followLatest: true,
    });
    assert.equal(liveRevealActive(model), true);
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("R12: attached user + NEXT_ACTION → intended auto-follow preserved", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("R13: first room entry → latest positioning preserved", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("R14: ordinary content click does NOT detach", () => {
    let model = mountIntentListenersAfter(idleAfterGmModel());
    model = contentPointerIntent(model, 400);
    assert.equal(model.manualDetached, false);
    assert.equal(model.followLatest, true);
  });
});

describe("production wiring — room-lifetime user scroll intent owner", () => {
  it("USER_SCROLL_INTENT_LISTENER_OWNER has no liveRevealActive gate", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const effect = extractUserIntentListenerEffect(room);
    assert.doesNotMatch(effect, /liveRevealActive/);
    assert.doesNotMatch(effect, /roundShow\.mode/);
    assert.doesNotMatch(effect, /presentationStarting/);
    assert.doesNotMatch(effect, /currentNarrationRef/);
    assert.doesNotMatch(effect, /liveDeclaration\.activeDeclarationActorId/);
    assert.match(effect, /shouldDetachLiveFollowOnWheel/);
    assert.match(effect, /shouldDetachLiveFollowOnTouchDelta/);
    assert.match(effect, /shouldDetachLiveFollowOnKey/);
    assert.match(effect, /detachLiveFollow\(\)/);
  });

  it("exactly one wheel listener owner registers detachLiveFollow", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const matches = room.match(/window\.addEventListener\("wheel", onWheel/g) ?? [];
    assert.equal(matches.length, 1);
    const effect = extractUserIntentListenerEffect(room);
    assert.match(effect, /window\.addEventListener\("wheel", onWheel/);
    assert.match(effect, /gutter <= 24/);
  });

  it("ResizeObserver growth gate may remain liveRevealActive-scoped separately", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /new ResizeObserver/);
    assert.match(room, /if \(!sceneEl \|\| !liveRevealActive\) return/);
  });
});
