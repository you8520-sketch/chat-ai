import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  hasActiveTextSelection,
  isInteractiveRevealFinishTarget,
  isNearPresentationCard,
  liveFreshGmNarrationRow,
  resolveTrpgLiveFollowOwner,
  resolveEffectiveGmRevealComplete,
  shouldShowTrpgReplySuggestions,
  shouldSkipRevealFinishClick,
} from "./followLatest";

describe("TRPG live follow owner", () => {
  it("A: actor presentation follows the currently active actor card", () => {
    const actor1 = resolveTrpgLiveFollowOwner({
      cinematicMotion: true,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(actor1, "CURRENT_ACTOR");

    const actor2 = resolveTrpgLiveFollowOwner({
      cinematicMotion: true,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(actor2, "CURRENT_ACTOR");

    const actor3 = resolveTrpgLiveFollowOwner({
      cinematicMotion: true,
      freshGmRound: null,
      gmRevealComplete: false,
      nextActionVisible: false,
    });
    assert.equal(actor3, "CURRENT_ACTOR");

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-trpg-presentation-active/);
    assert.match(room, /activePresentationCardRef/);
    assert.match(room, /activePresentationActorId/);
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /case "CURRENT_ACTOR"/);
  });

  it("B: fresh GM with incomplete reveal follows narration end", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 3,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "GM_NARRATION_END"
    );
  });

  it("C: fresh GM with complete reveal hands off to next-action", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 3,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );
  });

  it("D: progressive history flag does not override complete reveal", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 2,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(
      room,
      /liveGmRevealStateRef\.current\.progressive && narrationEndRef\.current/
    );
    assert.match(room, /gmRevealComplete/);
  });

  it("E: hides reply suggestions during incomplete GM reveal", () => {
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 4,
        gmRevealComplete: false,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      false
    );
  });

  it("F: shows reply suggestions after GM reveal completes", () => {
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 4,
        gmRevealComplete: true,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      true
    );

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /showReplySuggestions/);
    assert.match(room, /shouldShowTrpgReplySuggestions/);
  });

  it("G: click incomplete narration finishes reveal without provider calls", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const reveal = readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
    assert.match(room, /narrationReveal\.finish\(\)/);
    assert.match(room, /data-trpg-narration-body/);
    assert.match(reveal, /finish: \(\) => void/);
    assert.match(reveal, /finishRequestedRef/);
    assert.doesNotMatch(room, /finish\(\)[\s\S]{0,120}\/api\//);
  });

  it("H: interactive child clicks do not force-finish reveal", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const follow = readFileSync("src/lib/trpg/followLatest.ts", "utf8");
    assert.match(room, /shouldSkipRevealFinishClick\(event\.target\)/);
    assert.match(follow, /isInteractiveRevealFinishTarget/);
  });

  it("I: text selection does not force-finish reveal", () => {
    assert.equal(
      hasActiveTextSelection({
        isCollapsed: false,
        toString: () => "선택된 GM 서술",
      }),
      true
    );
    assert.equal(
      hasActiveTextSelection({
        isCollapsed: true,
        toString: () => "",
      }),
      false
    );
  });

  it("J: manual scroll escape prevents growth ticks from yanking the viewport", () => {
    const growth = decideLiveFollowOnGrowth({ following: false });
    assert.equal(growth.autoFollow, false);
    assert.equal(growth.unseenLatest, true);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /if \(!followLatestRef\.current\) return/);
    assert.match(room, /scrollToFollowOwner\(liveFollowOwner/);
  });

  it("K: latest button restores the current phase owner", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /scrollToLatest\("smooth"\)/);
    assert.match(room, /scrollToFollowOwner\(liveFollowOwner/);
    assert.match(room, /data-trpg-jump-latest/);
  });

  it("L: historical GM rows do not become live follow owners", () => {
    const seen = new Set(["n:0", "n:1", "n:2"]);
    const historical = liveFreshGmNarrationRow({
      log: [
        { roundNumber: 0, narration: "시작" },
        { roundNumber: 1, narration: "과거 GM" },
        { roundNumber: 2, narration: "최신 GM" },
      ],
      seenKeys: seen,
    });
    assert.equal(historical, null);

    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound: null,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("detects when the active presentation card is near the viewport", () => {
    const el = {
      getBoundingClientRect: () => ({
        top: 120,
        bottom: 280,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as Element;
    assert.equal(isNearPresentationCard(el, 120, 800), true);
    assert.equal(isNearPresentationCard(el, 120, 150), false);
  });

  it("M: persisted previous GM complete still yields CURRENT_ACTOR during cinematic motion", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound: 3,
        gmRevealComplete: true,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("N: persisted previous GM incomplete still yields CURRENT_ACTOR during cinematic motion", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound: 3,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("O: persisted GM N remains complete after snap advances to N+1", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /trackedFreshGmRoundRef/);
    assert.match(room, /\[freshGmRow\?\.roundNumber\]/);
    assert.doesNotMatch(room, /setGmRevealComplete\(false\)[\s\S]{0,120}\[snap\.round\.number\]/);
    assert.doesNotMatch(room, /}, \[snap\.round\.number\]\);[\s\S]{0,80}setGmRevealComplete\(false\)/);

    const persistedGmRound = 3;
    const snapRoundAfterAdvance = persistedGmRound + 1;
    const live = liveFreshGmNarrationRow({
      log: [
        { roundNumber: persistedGmRound, narration: "GM turn N body" },
        { roundNumber: snapRoundAfterAdvance, narration: "" },
      ],
      seenKeys: new Set<string>(),
    });
    assert.equal(live?.roundNumber, persistedGmRound);
    assert.notEqual(live?.roundNumber, snapRoundAfterAdvance);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound: persistedGmRound,
        gmRevealComplete: true,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("P: new fresh GM session resets incomplete reveal state", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /trackedFreshGmRoundRef\.current === nextFreshGmRound/);
    assert.match(room, /setGmRevealComplete\(false\)/);
  });

  it("Q: active presentation card ref follows current presentation round, not liveFollowRound", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(
      room,
      /activePresentationCardRef=\{\s*row\.roundNumber === snap\.round\.number && activePresentationActorId != null/
    );
    assert.match(room, /narrationEndRef=\{row\.roundNumber === liveFollowRound \? narrationEndRef : undefined\}/);
    assert.doesNotMatch(
      room,
      /activePresentationCardRef=\{\s*row\.roundNumber === liveFollowRound/
    );
  });

  it("U: new fresh GM round is incomplete on first render before tracked session sync", () => {
    assert.equal(
      resolveEffectiveGmRevealComplete({
        freshGmRound: 4,
        trackedRevealRound: 3,
        gmRevealComplete: true,
      }),
      false
    );
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 4,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "GM_NARRATION_END"
    );
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 4,
        gmRevealComplete: false,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      false
    );

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /resolveEffectiveGmRevealComplete/);
    assert.match(room, /effectiveGmRevealComplete/);
  });
});
