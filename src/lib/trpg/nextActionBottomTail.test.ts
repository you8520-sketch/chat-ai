/**
 * B1–B10: NEXT_ACTION bottom tail / sticky HUD occlusion regression.
 *
 * Root cause: nextActionRef (earlier container, no scroll-mb-28) was the primary
 * NEXT_ACTION scroll target, bypassing bottomRef compensation. block:end on re-run
 * decreased scrollY while user was already at document bottom.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  actionableBottomOccludedByHud,
  isTrpgNextActionTailVisibleAboveHud,
  shouldSkipTrpgNextActionTailFollow,
  simulateScrollIntoViewBlockEndScrollY,
  TRPG_NEXT_ACTION_TAIL_SCROLL_MARGIN_PX,
} from "./followLatest";

/** Desktop-like viewport from reported reproduction. */
const DESKTOP_VIEWPORT_H = 900;
const DESKTOP_HUD_TOP = 820;
const MOBILE_VIEWPORT_H = 740;
const MOBILE_HUD_TOP = 676;

function nextActionCaseBlock(room: string): string {
  const idx = room.indexOf('case "NEXT_ACTION"');
  assert.ok(idx >= 0);
  return room.slice(idx, idx + 900);
}

describe("B1 — idle bottom + NEXT_ACTION follow rerun", () => {
  it("BEFORE: block:end on earlier nextAction target decreases scrollY at document bottom", () => {
    const viewportHeight = DESKTOP_VIEWPORT_H;
    const scrollYBefore = 5200;
    const maxScrollY = 5200;
    const nextActionBottomDocument = 5800;
    const scrollYAfter = simulateScrollIntoViewBlockEndScrollY({
      targetBottomDocument: nextActionBottomDocument,
      viewportHeight,
    });
    assert.ok(scrollYAfter < scrollYBefore, "BOTTOM_UPWARD_SNAP_REPRODUCED_BEFORE");
    assert.equal(scrollYBefore, maxScrollY);
    const lastSuggestionBottom = 850;
    const occlusion = actionableBottomOccludedByHud({
      actionableBottom: lastSuggestionBottom,
      hudTop: DESKTOP_HUD_TOP,
    });
    assert.ok(occlusion > 0, "LAST_ACTIONABLE_OCCLUSION_BEFORE");
  });

  it("AFTER: canonical bottomRef tail skip prevents upward snap at max scroll", () => {
    const tailRectBottom = 708;
    const scrollYBefore = 5200;
    const maxScrollY = 5200;
    assert.equal(
      shouldSkipTrpgNextActionTailFollow({
        tailRectBottom,
        hudTop: DESKTOP_HUD_TOP,
        scrollY: scrollYBefore,
        maxScrollY,
      }),
      true
    );
    assert.equal(scrollYBefore, maxScrollY);
    assert.equal(
      isTrpgNextActionTailVisibleAboveHud({
        tailRectBottom,
        hudTop: DESKTOP_HUD_TOP,
      }),
      true
    );
    const lastSuggestionBottom = 708;
    assert.equal(
      actionableBottomOccludedByHud({
        actionableBottom: lastSuggestionBottom,
        hudTop: DESKTOP_HUD_TOP,
      }),
      0,
      "LAST_ACTIONABLE_OCCLUSION_AFTER"
    );
  });
});

describe("NEXT_ACTION bottom tail — B2–B10", () => {
  it("B2: last action suggestion fully above sticky HUD (desktop)", () => {
    const tailRectBottom = 708;
    assert.equal(
      isTrpgNextActionTailVisibleAboveHud({ tailRectBottom, hudTop: DESKTOP_HUD_TOP }),
      true
    );
    assert.equal(
      actionableBottomOccludedByHud({ actionableBottom: tailRectBottom, hudTop: DESKTOP_HUD_TOP }),
      0
    );
  });

  it("B2 mobile: compact HUD tail visibility", () => {
    const tailRectBottom = 564;
    assert.equal(
      isTrpgNextActionTailVisibleAboveHud({ tailRectBottom, hudTop: MOBILE_HUD_TOP }),
      true
    );
  });

  it("B3: new suggestions below safe area while attached may scroll (skip=false)", () => {
    const scrollY = 4000;
    const maxScrollY = 5200;
    const tailRectBottom = 860;
    assert.equal(
      shouldSkipTrpgNextActionTailFollow({
        tailRectBottom,
        hudTop: DESKTOP_HUD_TOP,
        scrollY,
        maxScrollY,
      }),
      false,
      "NEW_SUGGESTION_SCROLL_DIRECTION=down"
    );
  });

  it("B4: suggestions update while tail already visible → no follow scroll", () => {
    assert.equal(
      shouldSkipTrpgNextActionTailFollow({
        tailRectBottom: 708,
        hudTop: DESKTOP_HUD_TOP,
        scrollY: 5000,
        maxScrollY: 5200,
      }),
      true,
      "ALREADY_VISIBLE_UPDATE_SCROLL_DELTA=0"
    );
  });

  it("B5: suggestionsError tail uses same bottom anchor compensation", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const block = nextActionCaseBlock(room);
    assert.match(block, /bottomRef\.current/);
    assert.doesNotMatch(block, /nextActionRef/);
    assert.doesNotMatch(block, /suggestionsAnchorRef/);
  });

  it("B6: action input area uses bottom tail (no earlier container target)", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-trpg-next-action/);
    assert.match(room, /bottomRef/);
    assert.match(room, /scroll-mb-28/);
  });

  it("B7: manual detached — scrollToFollowOwner guard unchanged (#792)", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/
    );
    const intent = readFileSync("src/lib/trpg/idleAfterGmScrollIntent.test.ts", "utf8");
    assert.match(intent, /room-lifetime listeners always mounted/);
  });

  it("B8: explicit rejoin uses scrollToLatest → NEXT_ACTION bottom tail path", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const latest = room.match(/const scrollToLatest = useCallback\([\s\S]*?\n  \);/);
    assert.ok(latest);
    assert.match(latest[0]!, /scrollToFollowOwner\(liveFollowOwner/);
    const block = nextActionCaseBlock(room);
    assert.match(block, /bottomRef\.current/);
    assert.match(block, /block: "nearest"/);
  });

  it("B9: GM narration follow path unchanged (not block nearest tail)", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /case "GM_NARRATION_END"/);
    assert.match(room, /alignNarrationEnd/);
    assert.doesNotMatch(
      room.match(/case "GM_NARRATION_END"[\s\S]*?break;/)?.[0] ?? "",
      /block: "nearest"/
    );
  });

  it("B10: actor/declaration cinematic follow unchanged", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /case "CURRENT_ACTOR"/);
    assert.match(room, /case "ACTIVE_DECLARATION_END"/);
    assert.match(room, /block: "center"/);
  });
});

describe("production wiring — ONE NEXT_ACTION follow target owner", () => {
  it("NEXT_ACTION uses bottomRef only with sticky-HUD skip + nearest", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const block = nextActionCaseBlock(room);
    assert.match(block, /const target = bottomRef\.current/);
    assert.match(block, /shouldSkipTrpgNextActionTailFollow/);
    assert.match(block, /data-trpg-self-sheet-hud/);
    assert.match(block, /block: "nearest"/);
    assert.doesNotMatch(block, /nextActionRef/);
    assert.doesNotMatch(block, /suggestionsAnchorRef/);
    assert.doesNotMatch(block, /block: "end"/);
  });

  it("scroll-mb-28 compensation remains on canonical tail only", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /ref=\{bottomRef\}/);
    assert.match(room, /className="h-px w-full scroll-mb-28"/);
    assert.equal(TRPG_NEXT_ACTION_TAIL_SCROLL_MARGIN_PX, 112);
  });

  it("dead refs removed from production source", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(room, /nextActionRef/);
    assert.doesNotMatch(room, /suggestionsAnchorRef/);
  });
});
