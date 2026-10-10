import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHAT_RESUME_ATTR,
  CHAT_RESUME_BEATS,
  CHAT_RESUME_SEAM,
  CHAT_RESUME_TIMING,
  CHAT_ROOM_ID_ATTR,
  chatResumeAttrs,
  chatResumeGlyphDelayMs,
  chatResumeInkRadius,
  chatResumeIris,
  chatResumeRevealDelayMs,
  chatResumeSeamX,
  chatRoomAttrs,
  computeChatResumeLayout,
  isSameChatRoom,
  parseChatResumeHref,
  parseChatRoomPath,
  resolveChatArrival,
  resolveChatResumeTarget,
} from "@/lib/chatResume";
import { recentCharacterChatHref } from "@/lib/recentActivity";
import { splitRevealName } from "@/lib/characterReveal";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const dest = { characterId: 7, chatId: 70 };

describe("chat resume identity", () => {
  it("parses exactly the recent-activity room href", () => {
    const href = recentCharacterChatHref({ character_id: 7, chat_id: 70 });
    assert.equal(href, "/chat/7?chat=70");
    assert.deepEqual(parseChatResumeHref("/chat/7", "?chat=70"), dest);
    assert.equal(parseChatRoomPath("/chat/7"), 7);
  });

  it("rejects hrefs that are not a single owned-room link", () => {
    for (const [p, q] of [
      ["/chat/7", ""],
      ["/chat/7", "?chat=abc"],
      ["/chat/7", "?chat=0"],
      ["/chat/7", "?chat=70&fresh=1"],
      ["/chat/7", "?chat=70&chat=71"],
      ["/chat/7", "?fresh=1"],
      ["/chat/7/extra", "?chat=70"],
      ["/character/7", "?chat=70"],
      ["/trpg/7", ""],
      ["/verify", ""],
    ] as const) {
      assert.equal(parseChatResumeHref(p, q), null, `${p}${q}`);
    }
  });

  it("requires the row marker and href to point at the same room", () => {
    const ok = resolveChatResumeTarget({
      markerCharacterId: "7",
      markerChatId: "70",
      destPathname: "/chat/7",
      destSearch: "?chat=70",
    });
    assert.deepEqual(ok, dest);
    for (const bad of [
      { markerCharacterId: "8", markerChatId: "70" },
      { markerCharacterId: "7", markerChatId: "71" },
      { markerCharacterId: null, markerChatId: "70" },
      { markerCharacterId: "7", markerChatId: null },
    ]) {
      assert.equal(
        resolveChatResumeTarget({ ...bad, destPathname: "/chat/7", destSearch: "?chat=70" }),
        null,
      );
    }
    assert.equal(
      resolveChatResumeTarget({
        markerCharacterId: "7",
        markerChatId: "70",
        destPathname: "/verify",
        destSearch: "",
      }),
      null,
    );
  });

  it("judges the same room by characterId and chatId, never by pathname alone", () => {
    assert.equal(isSameChatRoom(dest, { characterId: 7, chatId: 70 }), true);
    assert.equal(isSameChatRoom(dest, { characterId: 7, chatId: 71 }), false);
    assert.equal(isSameChatRoom(dest, { characterId: 8, chatId: 70 }), false);
    assert.equal(isSameChatRoom(dest, null), false);
    assert.equal(isSameChatRoom(null, null), false);
  });

  it("marks hidden (adult-blurred, /verify) rows with nothing so they keep default navigation", () => {
    assert.deepEqual(chatResumeAttrs({ characterId: 7, chatId: 70, name: "A", hidden: true }), {});
    const attrs = chatResumeAttrs({ characterId: 7, chatId: 70, name: "하루", hidden: false });
    assert.equal(attrs[CHAT_RESUME_ATTR], "7");
    assert.equal(attrs["data-chat-resume-chat"], "70");
    assert.equal(attrs["data-chat-resume-name"], "하루");
    assert.equal(Object.keys(attrs).length, 3, "no message text, title or settings are exposed");
  });

  it("exposes the real room identity through one marker", () => {
    assert.deepEqual(chatRoomAttrs(dest), { "data-chat-room-character": "7", [CHAT_ROOM_ID_ATTR]: "70" });
  });
});

describe("chat resume arrival", () => {
  const room = (characterId: number, chatId: number) => ({ characterId, chatId });
  const origin = room(3, 30);

  const arrive = (input: {
    room: { characterId: number; chatId: number } | null;
    origin?: { characterId: number; chatId: number } | null;
    pathname: string;
    search?: string;
    superseded?: string[];
  }) =>
    resolveChatArrival({
      dest,
      origin: input.origin === undefined ? origin : input.origin,
      room: input.room,
      pathname: input.pathname,
      url: `${input.pathname}${input.search ?? ""}`,
      superseded: input.superseded,
    });

  it("arrives only when the destination room marker is mounted", () => {
    assert.equal(arrive({ origin: null, room: dest, pathname: "/chat/7", search: "?chat=70" }), "arrived");
    assert.equal(arrive({ room: dest, pathname: "/chat/7", search: "?chat=70" }), "arrived");
  });

  it("keeps waiting while the old room is still mounted or the marker is missing", () => {
    assert.equal(arrive({ room: origin, pathname: "/chat/3", search: "?chat=30" }), "pending");
    assert.equal(arrive({ room: null, pathname: "/chat/7", search: "?chat=70" }), "pending");
  });

  it("treats a query-only move to another session of the same character as the same flow", () => {
    const sameCharacterOrigin = room(7, 69);
    assert.equal(
      arrive({ origin: sameCharacterOrigin, room: sameCharacterOrigin, pathname: "/chat/7", search: "?chat=69" }),
      "pending",
    );
    assert.equal(
      arrive({ origin: sameCharacterOrigin, room: dest, pathname: "/chat/7", search: "?chat=70" }),
      "arrived",
    );
  });

  it("accepts the server's redirect to the character's existing room as arrival", () => {
    assert.equal(arrive({ origin: null, room: room(7, 72), pathname: "/chat/7", search: "?chat=72" }), "arrived");
  });

  it("abandons on redirects away from the room and on other characters' rooms", () => {
    for (const pathname of ["/login", "/verify", "/character/7", "/tab/new", "/"]) {
      assert.equal(arrive({ room: null, pathname }), "abandoned", pathname);
    }
    assert.equal(arrive({ room: room(9, 90), pathname: "/chat/9", search: "?chat=90" }), "abandoned");
  });

  it("waits through rooms and pages that rapid consecutive clicks superseded", () => {
    const superseded = ["/chat/9?chat=90", "/character/4", "/chat/7?chat=71"];
    assert.equal(arrive({ room: room(9, 90), pathname: "/chat/9", search: "?chat=90", superseded }), "pending");
    assert.equal(arrive({ room: null, pathname: "/character/4", superseded }), "pending");
    assert.equal(arrive({ room: room(7, 71), pathname: "/chat/7", search: "?chat=71", superseded }), "pending");
    assert.equal(arrive({ room: dest, pathname: "/chat/7", search: "?chat=70", superseded }), "arrived");
    assert.equal(arrive({ room: null, pathname: "/login", superseded }), "abandoned");
  });
});

describe("chat resume timeline", () => {
  it("fits the 0.7–1s feel and keeps the failsafe above a late reveal", () => {
    const { minCoverMs, holdMaxMs, revealMs, failsafeMs } = CHAT_RESUME_TIMING;
    assert.ok(minCoverMs + revealMs >= 700 && minCoverMs + revealMs <= 1000);
    assert.ok(holdMaxMs >= minCoverMs);
    assert.ok(holdMaxMs + revealMs <= failsafeMs);
    assert.equal(chatResumeRevealDelayMs(45), minCoverMs - 45);
    assert.equal(chatResumeRevealDelayMs(minCoverMs + 100), 0);
  });

  it("finishes every cover beat before the reveal starts and every split beat inside revealMs", () => {
    const B = CHAT_RESUME_BEATS;
    const { minCoverMs, revealMs } = CHAT_RESUME_TIMING;
    const glyphEnd = chatResumeGlyphDelayMs(43, 44) + B.nameGlyphMs;
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
    assert.notEqual(B.splitUpMs, B.splitDownMs, "the two halves open with different timing");
    assert.ok(B.splitDownDelayMs > 0, "the halves open at different moments");
  });

  it("spreads glyph starts in order inside the spread window", () => {
    assert.equal(chatResumeGlyphDelayMs(0, 1), CHAT_RESUME_BEATS.nameStartMs);
    const delays = Array.from({ length: 12 }, (_, k) => chatResumeGlyphDelayMs(k, 12));
    assert.deepEqual([...delays].sort((a, b) => a - b), delays);
    assert.ok(delays[11]! <= CHAT_RESUME_BEATS.nameStartMs + CHAT_RESUME_BEATS.nameSpreadMs + 1);
  });
});

describe("chat resume choreography geometry", () => {
  const viewports: Array<[number, number]> = [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [800, 600],
    [600, 900],
    [390, 844],
  ];
  const names = ["강이현", "엘레노어 폰 하이덴베르크 드 라 몽테뉴 대공녀", "A-1·쿠로 ✦ 레이", "김가나다라마바사아자차"];

  it("keeps the portrait inside the left face and the name inside the right face of the split", () => {
    for (const [vw, vh] of viewports) {
      for (const name of names) {
        const { lines, maxChars } = splitRevealName(name);
        const L = computeChatResumeLayout(vw, vh, lines.length, maxChars);
        const label = `${vw}x${vh} ${name}`;
        const f = L.frame;
        assert.ok(f.left >= 0 && f.top >= 0 && f.top + f.height <= vh, `${label} frame in viewport`);
        const frameBottom = (f.top + f.height) / vh;
        assert.ok(f.left + f.width <= chatResumeSeamX(frameBottom) * vw, `${label} frame left of seam`);
        const n = L.nameBox;
        assert.ok(n.left >= chatResumeSeamX(L.eyebrow.top / vh) * vw, `${label} name right of seam`);
        assert.ok(n.left + n.width <= vw, `${label} name inside viewport`);
        assert.ok(n.top >= 0 && n.top + n.height <= vh, `${label} name inside viewport height`);
        assert.ok(L.eyebrow.top >= 0, `${label} eyebrow visible`);
        assert.ok(L.nameFontPx >= 11, `${label} readable`);
        assert.ok(L.nameFontPx * maxChars <= n.width + 1, `${label} longest line fits its column`);
      }
    }
  });

  it("keeps the seam slanted so the two faces are unequal", () => {
    assert.ok(CHAT_RESUME_SEAM.top > CHAT_RESUME_SEAM.bottom);
    assert.equal(chatResumeSeamX(0), CHAT_RESUME_SEAM.top);
    assert.equal(chatResumeSeamX(1), CHAT_RESUME_SEAM.bottom);
    assert.equal(chatResumeSeamX(5), CHAT_RESUME_SEAM.bottom);
  });

  it("opens the portrait from the clicked thumbnail circle", () => {
    const frame = { left: 400, top: 200, width: 240, height: 320 };
    const origin = { left: 14, top: 300, width: 36, height: 36 };
    const iris = chatResumeIris(origin, frame);
    assert.equal(iris.scale, 0.15);
    assert.equal(iris.r0, 120);
    // pivot(frame-local w/2,w/2)이 원 중심으로 이동한다.
    assert.equal(iris.tx, 14 + 18 - (400 + 120));
    assert.equal(iris.ty, 300 + 18 - (200 + 120));
    assert.ok(iris.r1 >= Math.hypot(240 / 2, 320 - 120), "final circle covers the whole portrait");
    assert.equal(chatResumeIris(origin, { ...frame, width: 0 }).scale, 1);
  });

  it("grows the ink mask from the thumbnail to the farthest viewport corner", () => {
    assert.equal(chatResumeInkRadius(0, 0, 300, 400), 502);
    assert.ok(chatResumeInkRadius(32, 500, 1440, 900) >= Math.hypot(1440 - 32, 500));
  });
});

describe("chat resume ownership", () => {
  const host = read("src/components/MenuTransition.tsx");
  const row = read("src/components/SidebarRecentChatIcons.tsx");
  const css = read("src/app/globals.css");

  it("reuses the single MenuTransitionHost lifecycle without a second owner or router", () => {
    assert.match(read("src/app/layout.tsx"), /MenuTransitionHost/);
    assert.equal((host.match(/export default function|export function/g) ?? []).length, 1);
    assert.doesNotMatch(host, /router\.push|router\.replace|useRouter|ViewTransition|viewTransition/);
    assert.doesNotMatch(host, /preventDefault/);
    for (const consumer of [
      "src/components/SidebarRecentChatIcons.tsx",
      "src/components/SidebarShell.tsx",
      "src/app/chat/[id]/ChatClient.tsx",
    ]) {
      assert.doesNotMatch(read(consumer), /import[^;]*MenuTransition|import[^;]*ChatResumeScene|className="[^"]*cr-veil/, consumer);
    }
  });

  it("starts only from a marked character chat row and never from location changes alone", () => {
    assert.match(host, /anchor\.hasAttribute\(CHAT_RESUME_ATTR\)/);
    assert.match(host, /resolveChatResumeTarget\(/);
    const effect = host.slice(host.indexOf("// BEAT 3"));
    assert.doesNotMatch(effect, /scheduleChatBurst\(/);
    assert.match(host, /const _exhaustive: never = burst/);
    assert.match(row, /chatResumeAttrs\(/);
    const trpg = row.slice(row.indexOf("function RecentTrpgRow"), row.indexOf("function RecentActivityRow"));
    assert.doesNotMatch(trpg, /chatResume|CHAT_RESUME/, "TRPG recent rows keep default navigation");
  });

  it("confirms the real room before the transition lifts, and never reads the clicked row's message text", () => {
    assert.match(host, /resolveChatArrival\(/);
    assert.match(host, /readChatRoom\(\)/);
    assert.match(host, /dropBurst\(cur\.id\)/);
    assert.match(read("src/app/chat/[id]/ChatClient.tsx"), /chatRoomAttrs\(/);
    const scene = read("src/components/ChatResumeScene.tsx");
    const builder = host.slice(host.indexOf("function buildChatResumeScene"), host.indexOf("let burstSeq"));
    assert.doesNotMatch(builder, /getAttribute\("title"\)|\.title\b|last_content/);
    assert.equal((builder.match(/textContent/g) ?? []).length, 1);
    assert.match(builder, /thumb\.textContent/);
    assert.doesNotMatch(scene, /last_content|preview|snippet|message/i);
  });

  it("never mutates sessions: the row is a plain existing Link and no fetch is added", () => {
    assert.match(row, /<Link\s+href=\{href\}/);
    assert.doesNotMatch(host, /fetch\(|XMLHttpRequest|sendBeacon/);
    assert.doesNotMatch(read("src/lib/chatResume.ts"), /getDb|better-sqlite3|fetch\(/);
  });

  it("css uses only compositor properties, never blocks input and is off for reduced motion", () => {
    const block = css.slice(css.indexOf("/* Phase D-2"), css.indexOf("@keyframes float-points-up"));
    assert.match(block, /\.cr-veil \{[^}]*pointer-events: none/);
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cr-veil \{\s*display: none;/);
    assert.doesNotMatch(block, /animation:[^;]*\b(width|height|top|left)\b/);
    assert.doesNotMatch(block, /filter:\s*blur|backdrop-filter/);
    const defined = new Set([...block.matchAll(/@keyframes (cr-[\w-]+)/g)].map((m) => m[1]));
    const used = new Set([...block.matchAll(/animation:\s*(cr-[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) assert.ok(defined.has(name), `${name} is defined`);
    for (const name of defined) assert.ok(used.has(name), `${name} is used`);
  });

  it("does not paint the Phase C primary-colour slab or the D-1 reveal classes", () => {
    const block = css.slice(css.indexOf("/* Phase D-2"), css.indexOf("@keyframes float-points-up"));
    assert.doesNotMatch(block, /menu-|\brv-/);
    assert.doesNotMatch(read("src/components/ChatResumeScene.tsx"), /menu-veil|rv-veil|--menu-accent/);
  });
});
