import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { splitRevealName } from "@/lib/characterReveal";
import { recentTrpgCampaignHref } from "@/lib/recentActivity";
import {
  TRPG_RESUME_ATTR,
  TRPG_RESUME_BEATS,
  TRPG_RESUME_SEAM,
  TRPG_RESUME_TIMING,
  TRPG_ROOM_ID_ATTR,
  computeTrpgResumeLayout,
  decideTrpgBurstAction,
  isSameTrpgRoom,
  parseTrpgResumeHref,
  parseTrpgRoomPath,
  resolveTrpgArrival,
  resolveTrpgResumeTarget,
  trpgResumeAttrs,
  trpgResumeGlyphDelayMs,
  trpgResumeInkRadius,
  trpgResumeIris,
  trpgResumePageLooksFailed,
  trpgResumeRevealDelayMs,
  trpgResumeSeamX,
  trpgRoomAttrs,
} from "@/lib/trpgResumeTransition";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const dest = { campaignId: 12 };

describe("trpg resume identity", () => {
  it("parses exactly the recent-activity campaign href", () => {
    assert.equal(recentTrpgCampaignHref(12), "/trpg/12");
    assert.deepEqual(parseTrpgResumeHref("/trpg/12", ""), dest);
    assert.equal(parseTrpgRoomPath("/trpg/12"), 12);
  });

  it("rejects lobby, nested, query, and non-campaign hrefs", () => {
    for (const [p, q] of [
      ["/trpg", ""],
      ["/trpg/", ""],
      ["/trpg/12", "?fresh=1"],
      ["/trpg/12/extra", ""],
      ["/trpg/0", ""],
      ["/trpg/abc", ""],
      ["/chat/12", ""],
      ["/login", ""],
    ] as const) {
      assert.equal(parseTrpgResumeHref(p, q), null, `${p}${q}`);
    }
  });

  it("requires the row marker and href to point at the same campaign", () => {
    assert.deepEqual(
      resolveTrpgResumeTarget({ markerCampaignId: "12", destPathname: "/trpg/12", destSearch: "" }),
      dest,
    );
    assert.equal(
      resolveTrpgResumeTarget({ markerCampaignId: "11", destPathname: "/trpg/12", destSearch: "" }),
      null,
    );
    assert.equal(
      resolveTrpgResumeTarget({ markerCampaignId: "12", destPathname: "/trpg", destSearch: "" }),
      null,
    );
  });

  it("marks only a matching public title and campaign id", () => {
    const attrs = trpgResumeAttrs({ campaignId: 12, title: "안개 성채", href: "/trpg/12" });
    assert.equal(attrs[TRPG_RESUME_ATTR], "12");
    assert.equal(attrs["data-trpg-resume-name"], "안개 성채");
    assert.equal(Object.keys(attrs).length, 2);
    assert.deepEqual(trpgResumeAttrs({ campaignId: 12, title: "안개 성채", href: "/trpg" }), {});
    assert.deepEqual(trpgResumeAttrs({ campaignId: 0, title: "안개 성채", href: "/trpg/0" }), {});
    assert.deepEqual(trpgResumeAttrs({ campaignId: 12, title: "   ", href: "/trpg/12" }), {});
  });

  it("exposes the real room identity through one marker", () => {
    assert.deepEqual(trpgRoomAttrs(12), { [TRPG_ROOM_ID_ATTR]: "12" });
  });

  it("judges the same room by campaignId, never by pathname alone", () => {
    assert.equal(isSameTrpgRoom(dest, { campaignId: 12 }), true);
    assert.equal(isSameTrpgRoom(dest, { campaignId: 13 }), false);
    assert.equal(isSameTrpgRoom(dest, null), false);
  });
});

describe("trpg resume arrival", () => {
  const room = (campaignId: number) => ({ campaignId });
  const origin = room(3);

  const arrive = (input: {
    room: { campaignId: number } | null;
    origin?: { campaignId: number } | null;
    pathname: string;
    search?: string;
    superseded?: string[];
  }) =>
    resolveTrpgArrival({
      dest,
      origin: input.origin === undefined ? origin : input.origin,
      room: input.room,
      pathname: input.pathname,
      url: `${input.pathname}${input.search ?? ""}`,
      superseded: input.superseded,
    });

  it("arrives only when the destination room marker is mounted", () => {
    assert.equal(arrive({ origin: null, room: dest, pathname: "/trpg/12" }), "arrived");
    assert.equal(arrive({ room: dest, pathname: "/trpg/12" }), "arrived");
    assert.equal(arrive({ room: null, pathname: "/trpg/12" }), "pending");
  });

  it("keeps waiting while the old campaign is still mounted or the marker is missing", () => {
    assert.equal(arrive({ room: origin, pathname: "/trpg/3" }), "pending");
    assert.equal(arrive({ room: null, pathname: "/trpg/12" }), "pending");
  });

  it("keeps holding while a delayed navigation is still on the page that was clicked", () => {
    assert.equal(
      resolveTrpgArrival({
        dest,
        origin: null,
        room: null,
        pathname: "/",
        url: "/",
        from: "/",
      }),
      "pending",
    );
    assert.equal(
      resolveTrpgArrival({
        dest,
        origin: null,
        room: null,
        pathname: "/login",
        url: "/login",
        from: "/",
      }),
      "abandoned",
    );
    assert.equal(
      resolveTrpgArrival({
        dest,
        origin: null,
        room: null,
        pathname: "/",
        url: "/",
        from: "/",
        leftOrigin: true,
      }),
      "abandoned",
    );
  });

  it("abandons on login, lobby, and other campaigns", () => {
    for (const pathname of ["/login", "/verify", "/trpg", "/chat/7", "/"]) {
      assert.equal(arrive({ room: null, pathname }), "abandoned", pathname);
    }
    assert.equal(arrive({ room: room(9), pathname: "/trpg/9" }), "abandoned");
  });

  it("holds the cover when the destination room is not ready", () => {
    assert.equal(decideTrpgBurstAction("pending", false), "hold");
    assert.equal(decideTrpgBurstAction("arrived", false), "reveal");
    assert.equal(decideTrpgBurstAction("abandoned", false), "drop");
    assert.equal(decideTrpgBurstAction("pending", true), "drop");
  });

  it("treats a 404 heading without a room marker as a failed page", () => {
    const failed = {
      querySelector(sel: string) {
        if (sel.includes("data-trpg-room-id") || sel.includes("data-next")) return null;
        if (sel.includes("h1")) return { textContent: "404" };
        return null;
      },
    };
    const ready = {
      querySelector(sel: string) {
        if (sel.includes("data-trpg-room-id")) return { getAttribute: () => "12" };
        return null;
      },
    };
    assert.equal(trpgResumePageLooksFailed(failed as unknown as ParentNode), true);
    assert.equal(trpgResumePageLooksFailed(ready as unknown as ParentNode), false);
    assert.equal(trpgResumePageLooksFailed(failed as unknown as ParentNode, "/"), false);
    assert.equal(trpgResumePageLooksFailed(failed as unknown as ParentNode, "/trpg/12"), true);
  });

  it("waits through rooms that rapid consecutive clicks superseded", () => {
    const superseded = ["/trpg/9", "/trpg/11"];
    assert.equal(arrive({ room: room(9), pathname: "/trpg/9", superseded }), "pending");
    assert.equal(arrive({ room: dest, pathname: "/trpg/12", superseded }), "arrived");
    assert.equal(arrive({ room: null, pathname: "/login", superseded }), "abandoned");
  });
});

describe("trpg resume timeline", () => {
  it("fits the 0.7–1s feel and keeps the failsafe above a late reveal", () => {
    const { minCoverMs, holdMaxMs, revealMs, failsafeMs } = TRPG_RESUME_TIMING;
    assert.ok(minCoverMs + revealMs >= 700 && minCoverMs + revealMs <= 1000);
    assert.ok(holdMaxMs >= minCoverMs);
    assert.ok(holdMaxMs + revealMs <= failsafeMs);
    assert.equal(trpgResumeRevealDelayMs(0), minCoverMs);
    assert.equal(trpgResumeRevealDelayMs(minCoverMs + 80), 0);
  });

  it("finishes every cover beat before reveal and overlaps the identity beats", () => {
    const B = TRPG_RESUME_BEATS;
    const { minCoverMs, revealMs } = TRPG_RESUME_TIMING;
    const glyphEnd = trpgResumeGlyphDelayMs(43, 44) + B.nameGlyphMs;
    for (const end of [
      B.inkOpenMs,
      B.lineMs,
      B.ringMs,
      B.frameStartMs + B.frameMs,
      B.seamStartMs + B.seamMs,
      B.eyebrowStartMs + B.eyebrowMs,
      glyphEnd,
    ]) {
      assert.ok(end <= minCoverMs + 40, `cover beat ends at ${end}ms`);
    }
    assert.ok(B.splitUpMs <= revealMs);
    assert.ok(B.splitDownDelayMs + B.splitDownMs <= revealMs);
    assert.ok(B.eyebrowStartMs < B.nameStartMs + 80);
  });

  it("staggers glyphs inside the name spread", () => {
    assert.equal(trpgResumeGlyphDelayMs(0, 1), TRPG_RESUME_BEATS.nameStartMs);
    const delays = [0, 1, 2, 3].map((i) => trpgResumeGlyphDelayMs(i, 4));
    assert.ok(delays[0]! < delays[3]!);
    assert.ok(delays[3]! <= TRPG_RESUME_BEATS.nameStartMs + TRPG_RESUME_BEATS.nameSpreadMs + 1);
  });
});

describe("trpg resume layout", () => {
  it("tilts the seam opposite D-2 and keeps the crest and title on opposite sides", () => {
    assert.ok(TRPG_RESUME_SEAM.bottom > TRPG_RESUME_SEAM.top);
    assert.equal(trpgResumeSeamX(0), TRPG_RESUME_SEAM.top);
    assert.equal(trpgResumeSeamX(1), TRPG_RESUME_SEAM.bottom);
    const layout = computeTrpgResumeLayout(1440, 900, 1, 6);
    assert.equal(layout.compact, false);
    assert.ok(layout.frame.left + layout.frame.width <= layout.nameBox.left);
    const mobile = computeTrpgResumeLayout(390, 844, 2, 10);
    assert.equal(mobile.compact, true);
    assert.ok(mobile.frame.width >= 60);
    assert.ok(mobile.nameBox.width >= 80);
  });

  it("opens the crest from the D20 circle and covers the viewport with ink", () => {
    const origin = { left: 20, top: 240, width: 36, height: 36 };
    const frame = { left: 200, top: 280, width: 180, height: 180 };
    const iris = trpgResumeIris(origin, frame);
    assert.ok(iris.scale < 1);
    assert.ok(iris.r1 >= Math.hypot(180, 180) - 1);
    assert.equal(trpgResumeIris(origin, { ...frame, width: 0 }).scale, 1);
    assert.ok(trpgResumeInkRadius(32, 240, 1440, 900) >= Math.hypot(1440 - 32, 900 - 240));
  });

  it("splits long Korean campaign titles without overflowing the viewport", () => {
    const long = splitRevealName("안개 낀 북쪽 성채의 마지막 연회");
    const layout = computeTrpgResumeLayout(1440, 900, long.lines.length, long.maxChars);
    assert.ok(layout.nameBox.left + layout.nameBox.width <= 1440);
    assert.ok(layout.nameBox.top + layout.nameBox.height <= 900);
  });
});

describe("trpg resume ownership", () => {
  const host = read("src/components/MenuTransition.tsx");
  const row = read("src/components/SidebarRecentChatIcons.tsx");
  const css = read("src/app/globals.css");
  const room = read("src/app/trpg/[id]/TrpgRoomClient.tsx");
  const scene = read("src/components/TrpgResumeScene.tsx");
  const logic = read("src/lib/trpgResumeTransition.ts");

  it("reuses the single MenuTransitionHost lifecycle without a second owner or router", () => {
    assert.match(read("src/app/layout.tsx"), /MenuTransitionHost/);
    assert.equal((host.match(/export default function|export function/g) ?? []).length, 1);
    assert.doesNotMatch(host, /router\.push|router\.replace|useRouter|ViewTransition|viewTransition/);
    assert.doesNotMatch(host, /preventDefault/);
    for (const consumer of [
      "src/components/SidebarRecentChatIcons.tsx",
      "src/app/trpg/[id]/TrpgRoomClient.tsx",
      "src/app/trpg/[id]/page.tsx",
    ]) {
      assert.doesNotMatch(
        read(consumer),
        /import[^;]*MenuTransition|import[^;]*TrpgResumeScene|className="[^"]*tr-veil/,
        consumer,
      );
    }
  });

  it("starts only from a marked TRPG recent row and never from location changes alone", () => {
    assert.match(host, /anchor\.hasAttribute\(TRPG_RESUME_ATTR\)/);
    assert.match(host, /resolveTrpgResumeTarget\(/);
    const effect = host.slice(host.indexOf("// BEAT 3"));
    assert.doesNotMatch(effect, /scheduleTrpgBurst\(/);
    assert.match(row, /trpgResumeAttrs\(/);
    assert.match(row, /TRPG_RESUME_GLYPH_ATTR/);
  });

  it("confirms the real campaign room before the transition lifts", () => {
    assert.match(host, /resolveTrpgArrival\(/);
    assert.match(host, /decideTrpgBurstAction\(/);
    assert.match(host, /trpgResumePageLooksFailed\(document, window\.location\.pathname\)/);
    assert.match(host, /readTrpgRoom\(\)/);
    assert.match(host, /trpgRevealArmed/);
    assert.match(host, /trpgLeftOrigin/);
    assert.match(host, /next\.kind !== "trpg"/);
    assert.match(host, /TRPG_ROOM_ID_ATTR/);
    assert.match(room, /trpgRoomAttrs\(snap\.id\)/);
    assert.equal((room.match(/trpgRoomAttrs\(/g) ?? []).length, 2, "setup and active branches both mark the room");
  });

  it("never serializes private world, participants, costs, or source thumbs into the overlay", () => {
    const builder = host.slice(host.indexOf("function buildTrpgResumeScene"), host.indexOf("function buildChatResumeScene"));
    assert.doesNotMatch(builder, /getAttribute\("title"\)|world_brief|gm_secret|participant|billing|last_content/);
    assert.doesNotMatch(scene, /world_brief|gm_secret|participant|billing|last_content|dice result/);
    assert.doesNotMatch(logic, /getDb|better-sqlite3|fetch\(/);
    assert.doesNotMatch(host, /fetch\(|XMLHttpRequest|sendBeacon/);
    assert.match(scene, /Campaign/);
    assert.doesNotMatch(scene, /eyebrow-label">Resume/);
  });

  it("keeps the recent row a plain Link and does not create campaigns or rounds", () => {
    const trpg = row.slice(row.indexOf("function RecentTrpgRow"), row.indexOf("function RecentActivityRow"));
    assert.match(trpg, /<Link\s+href=\{entry\.href\}/);
    assert.doesNotMatch(trpg, /chatResume|CHAT_RESUME/);
    assert.doesNotMatch(logic, /INSERT|UPDATE|createCampaign|advanceRound|ensureDefaultPublicPersona/);
    assert.doesNotMatch(read("src/app/trpg/[id]/page.tsx"), /trpgResume|TrpgResumeScene/);
  });

  it("css uses only compositor properties, never blocks input and is off for reduced motion", () => {
    const block = css.slice(css.indexOf("/* Phase D-3"), css.indexOf("@keyframes float-points-up"));
    assert.match(block, /\.tr-veil \{[^}]*pointer-events: none/);
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tr-veil \{\s*display: none;/);
    assert.doesNotMatch(block, /animation:[^;]*\b(width|height|top|left)\b/);
    assert.doesNotMatch(block, /filter:\s*blur|backdrop-filter/);
    const defined = new Set([...block.matchAll(/@keyframes (tr-[\w-]+)/g)].map((m) => m[1]));
    const used = new Set([...block.matchAll(/animation:\s*(tr-[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) assert.ok(defined.has(name), `${name} is defined`);
    for (const name of defined) assert.ok(used.has(name), `${name} is used`);
  });

  it("does not paint the Phase C slab or D-1/D-2 class names", () => {
    const block = css.slice(css.indexOf("/* Phase D-3"), css.indexOf("@keyframes float-points-up"));
    assert.doesNotMatch(block, /menu-|\brv-|\bcr-/);
    assert.doesNotMatch(scene, /menu-veil|rv-veil|cr-veil|--menu-accent/);
  });
});
