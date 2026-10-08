import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHARACTER_CARD_ATTR,
  CHARACTER_REVEAL_TIMING,
  characterRevealAttrs,
  characterRevealDelayMs,
  computeRevealLayout,
  flipClipInset,
  flipTransform,
  parseCharacterProfilePath,
  REVEAL_FRAME_ASPECT,
  splitRevealName,
} from "@/lib/characterReveal";
import { MENU_TRANSITION_TIMING } from "@/lib/menuTransitionSpec";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("character reveal path eligibility", () => {
  it("accepts only exact /character/:id profile paths", () => {
    assert.equal(parseCharacterProfilePath("/character/42"), 42);
    for (const bad of [
      "/character/",
      "/character/abc",
      "/character/42/",
      "/character/42/edit",
      "/character/0",
      "/search",
      "/creator/42",
      "/login",
      "/verify",
      "/character/99999999999999999999",
    ]) {
      assert.equal(parseCharacterProfilePath(bad), null, bad);
    }
  });
});

describe("character reveal card marker", () => {
  const base = { id: 7, name: "강이현", genre: "로맨스", creator: "운영팀", href: "/character/7", hidden: false, hasThumb: true };

  it("marks accessible profile cards that show a public image", () => {
    const attrs = characterRevealAttrs(base);
    assert.equal(attrs[CHARACTER_CARD_ATTR], "7");
    assert.equal(attrs["data-character-name"], "강이현");
  });

  it("never marks login/verify redirects, adult-hidden cards or cards without an image", () => {
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/login?redirect=%2Fcharacter%2F7" }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/verify?redirect=%2Fcharacter%2F7" }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, hidden: true }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, hasThumb: false }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/character/8" }), {});
  });
});

describe("character reveal name layout", () => {
  it("keeps short names on one line and long Korean names within three balanced lines", () => {
    assert.deepEqual(splitRevealName("강이현").lines, ["강이현"]);
    const two = splitRevealName("루시안 바스케스");
    assert.deepEqual(two.lines, ["루시안", "바스케스"]);
    const long = splitRevealName("엘레노어 폰 하이덴베르크 드 라 몽테뉴 대공녀");
    assert.ok(long.lines.length <= 3, long.lines.join("|"));
    assert.equal(long.lines.join(" "), "엘레노어 폰 하이덴베르크 드 라 몽테뉴 대공녀");
    const noSpace = splitRevealName("가".repeat(30));
    assert.ok(noSpace.lines.length <= 3);
    assert.equal(noSpace.lines.join(""), "가".repeat(30));
  });

  it("truncates absurd names and survives empty input", () => {
    const huge = splitRevealName("나".repeat(200));
    assert.ok(huge.lines.length <= 3);
    assert.ok(Array.from(huge.lines.join("")).length <= 44);
    assert.deepEqual(splitRevealName("   ").lines, ["—"]);
  });

  it("fits the name and poster inside the viewport for desktop and mobile", () => {
    for (const [vw, vh] of [
      [1440, 900],
      [1920, 1080],
      [1024, 768],
      [390, 844],
      [360, 640],
    ] as const) {
      for (const name of ["강이현", "루시안 바스케스", "엘레노어 폰 하이덴베르크 드 라 몽테뉴 대공녀"]) {
        const { lines, maxChars } = splitRevealName(name);
        const layout = computeRevealLayout(vw, vh, lines.length, maxChars);
        const { frame, nameBox, nameFontPx } = layout;
        assert.ok(Math.abs(frame.width / frame.height - REVEAL_FRAME_ASPECT) < 0.001, `${vw}x${vh} aspect`);
        assert.ok(frame.left >= 0 && frame.left + frame.width <= vw + 0.5, `${vw}x${vh} frame x`);
        assert.ok(frame.top >= 0, `${vw}x${vh} frame top`);
        assert.ok(nameBox.left >= 0 && nameBox.left + nameBox.width <= vw + 0.5, `${vw}x${vh} name x`);
        assert.ok(nameFontPx >= 26, `${vw}x${vh} name size`);
        assert.equal(layout.compact, vw < 768);
      }
    }
  });
});

describe("character reveal FLIP math", () => {
  it("maps the card image rect onto the poster frame", () => {
    const from = { left: 100, top: 200, width: 150, height: 225 };
    const frame = { left: 900, top: 60, width: 400, height: 600 };
    const { tx, ty, scale } = flipTransform(from, frame);
    assert.equal(scale, 150 / 400);
    assert.equal(tx, -800);
    assert.equal(ty, 140);
    // 변환 후 프레임 좌상단/폭이 카드 rect와 일치해야 한다.
    assert.equal(frame.left + tx, from.left);
    assert.equal(frame.width * scale, from.width);
  });

  it("clips frame overflow to the visible part of a scroll-clipped card", () => {
    const from = { left: 0, top: 0, width: 100, height: 150 };
    const frame = { left: 0, top: 0, width: 400, height: 600 };
    const scale = 0.25;
    const full = flipClipInset(from, from, frame, scale);
    assert.deepEqual(full, { top: 0, right: 0, bottom: 0, left: 0 });
    const cropped = flipClipInset({ left: 0, top: 0, width: 100, height: 75 }, from, frame, scale);
    assert.deepEqual(cropped, { top: 0, right: 0, bottom: 300, left: 0 });
  });
});

describe("character reveal timeline", () => {
  it("never delays navigation and finishes before the shared failsafe", () => {
    const { minCoverMs, holdMaxMs, revealMs, failsafeMs } = CHARACTER_REVEAL_TIMING;
    assert.equal(characterRevealDelayMs(45), minCoverMs - 45);
    assert.equal(characterRevealDelayMs(minCoverMs + 200), 0);
    assert.ok(holdMaxMs >= minCoverMs);
    assert.ok(holdMaxMs + revealMs <= failsafeMs);
    assert.equal(failsafeMs, MENU_TRANSITION_TIMING.failsafeMs);
  });
});

describe("character reveal ownership", () => {
  const host = read("src/components/MenuTransition.tsx");

  it("reuses the single MenuTransitionHost lifecycle without a second owner or router", () => {
    assert.match(read("src/app/layout.tsx"), /MenuTransitionHost/);
    assert.equal((host.match(/export default function|export function/g) ?? []).length, 1);
    for (const consumer of [
      "src/components/CharacterCard.tsx",
      "src/components/CharacterPublicPagePreview.tsx",
      "src/components/CharacterCardCarousel.tsx",
      "src/components/CharacterImageViewer.tsx",
    ]) {
      assert.doesNotMatch(read(consumer), /import[^;]*MenuTransition|import[^;]*CharacterRevealScene|className="[^"]*rv-veil/, consumer);
    }
    assert.doesNotMatch(host, /router\.push|router\.replace|ViewTransition|viewTransition|useRouter/);
    assert.doesNotMatch(host, /preventDefault/);
  });

  it("starts only from a character card click and never from pathname changes alone", () => {
    assert.match(host, new RegExp(CHARACTER_CARD_ATTR));
    assert.match(host, /parseCharacterProfilePath/);
    assert.match(host, /cur\.kind === "character" && pathname !== cur\.dest/);
    assert.match(host, /const _exhaustive: never = burst/);
  });

  it("drops a leftover character scene when the path leaves character profiles", () => {
    assert.match(host, /function dropBurst/);
    assert.match(host, /parseCharacterProfilePath\(pathname\) === null/);
    assert.match(host, /dropBurst\(cur\.id\)/);
  });

  it("marks only accessible public cards and the real hero frame", () => {
    const card = read("src/components/CharacterCard.tsx");
    assert.match(card, /characterRevealAttrs\(/);
    assert.match(read("src/app/tab/[tab]/page.tsx"), /characterRevealAttrs\(/);
    assert.match(host, /\/media\/private\//);
    assert.match(read("src/components/CharacterPublicPagePreview.tsx"), /\[CHARACTER_HERO_IMAGE_ATTR\]/);
    // 태그·제작자 링크는 reveal 마커를 갖지 않는다.
    assert.doesNotMatch(read("src/app/creator/[id]/page.tsx"), new RegExp(CHARACTER_CARD_ATTR));
  });

  it("css animates only compositor properties and disables the veil for reduced motion", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.rv-veil \{[^}]*pointer-events: none/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.rv-veil \{\s*display: none;/);
    const block = css.slice(css.indexOf("/* Phase D-1"), css.indexOf("@keyframes float-points-up"));
    assert.doesNotMatch(block, /animation:[^;]*\b(width|height|top|left)\b/);
    assert.doesNotMatch(block, /filter:\s*blur|backdrop-filter/);
  });
});
