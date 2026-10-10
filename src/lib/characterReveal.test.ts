import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHARACTER_CARD_ATTR,
  CHARACTER_REVEAL_TIMING,
  REVEAL_BEATS,
  REVEAL_TAG_SCATTER,
  revealGlyphDelayMs,
  revealGlyphMotion,
  revealGlyphRanks,
  revealSettleDelta,
  splitRevealGraphemes,
  characterRevealAttrs,
  characterRevealDelayMs,
  computeRevealLayout,
  parseRevealTags,
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
  const base = { id: 7, name: "강이현", genre: "로맨스", href: "/character/7", hidden: false, hasThumb: true };

  it("marks accessible profile cards that show a public image", () => {
    const attrs = characterRevealAttrs(base);
    assert.equal(attrs[CHARACTER_CARD_ATTR], "7");
    assert.equal(attrs["data-character-name"], "강이현");
    assert.equal(attrs["data-character-genre"], "로맨스");
    assert.equal("data-character-creator" in attrs, false);
  });

  it("carries the already-public tagline and at most three tags for the dossier overlay", () => {
    const attrs = characterRevealAttrs({ ...base, tagline: "  차갑게 식은 새벽  ", tags: ["집착", " 냉미남 ", "", "경호", "연상"] });
    assert.equal(attrs["data-character-tagline"], "차갑게 식은 새벽");
    assert.deepEqual(parseRevealTags(attrs["data-character-tags"]), ["집착", "냉미남", "경호"]);
    const bare = characterRevealAttrs(base);
    assert.equal("data-character-tagline" in bare, false);
    assert.equal("data-character-tags" in bare, false);
  });

  it("never exposes unresolved {{user}}/{{char}} taglines to the overlay", () => {
    assert.equal("data-character-tagline" in characterRevealAttrs({ ...base, tagline: "{{user}}만 바라보는 사람" }), false);
    assert.equal("data-character-tagline" in characterRevealAttrs({ ...base, tagline: "{{ char }}의 아침" }), false);
  });

  it("parses malformed tag payloads as empty", () => {
    assert.deepEqual(parseRevealTags(null), []);
    assert.deepEqual(parseRevealTags("not json"), []);
    assert.deepEqual(parseRevealTags('{"a":1}'), []);
    assert.deepEqual(parseRevealTags('["a",1,null,"b"]'), ["a", "b"]);
  });

  it("never marks login/verify redirects, adult-hidden cards or cards without an image", () => {
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/login?redirect=%2Fcharacter%2F7" }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/verify?redirect=%2Fcharacter%2F7" }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, hidden: true }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, hasThumb: false }), {});
    assert.deepEqual(characterRevealAttrs({ ...base, href: "/character/8" }), {});
  });

  it("attaches only consented public dossier values and omits them when hidden", () => {
    const attrs = characterRevealAttrs({
      ...base,
      dossier: { world: "에테르노스 제국", gender: "남성", heightCm: 183, weightKg: 71 },
    });
    assert.equal(attrs["data-character-world"], "에테르노스 제국");
    assert.equal(attrs["data-character-gender"], "남성");
    assert.equal(attrs["data-character-height"], "183cm");
    assert.equal(attrs["data-character-weight"], "71kg");
    const hidden = characterRevealAttrs({
      ...base,
      hidden: true,
      dossier: { world: "에테르노스 제국", gender: "남성", heightCm: 183, weightKg: 71 },
    });
    assert.equal("data-character-gender" in hidden, false);
    assert.equal("data-character-world" in hidden, false);
    const empty = characterRevealAttrs(base);
    assert.equal("data-character-gender" in empty, false);
    assert.equal("data-character-world" in empty, false);
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
        const { frame, nameBox, nameFontPx, info } = layout;
        assert.ok(Math.abs(frame.width / frame.height - REVEAL_FRAME_ASPECT) < 0.001, `${vw}x${vh} aspect`);
        assert.ok(frame.left >= 0 && frame.left + frame.width <= vw + 0.5, `${vw}x${vh} frame x`);
        assert.ok(frame.top >= 0, `${vw}x${vh} frame top`);
        assert.ok(nameBox.left >= 0 && nameBox.left + nameBox.width <= vw + 0.5, `${vw}x${vh} name x`);
        assert.ok(nameFontPx >= 26, `${vw}x${vh} name size`);
        assert.ok(info.left >= 0 && info.left + info.width <= vw + 0.5, `${vw}x${vh} info x`);
        assert.ok(info.eyebrowTop >= 0, `${vw}x${vh} eyebrow top`);
        assert.ok(nameBox.top >= info.eyebrowTop, `${vw}x${vh} eyebrow above name`);
        assert.ok(info.subTop >= nameBox.top + nameBox.height, `${vw}x${vh} sub below name`);
        assert.ok(info.subTop + 112 <= vh + 0.5, `${vw}x${vh} dossier fits viewport height`);
        if (layout.compact) {
          assert.ok(nameBox.top >= frame.top + frame.height, `${vw}x${vh} mobile name never covers the illustration`);
        } else {
          assert.ok(nameBox.left + nameBox.width - frame.left <= frame.width * 0.05, `${vw}x${vh} name tucks only a sliver behind the illustration`);
          assert.ok(info.left + info.width <= frame.left, `${vw}x${vh} dossier stays clear of the illustration`);
        }
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

  it("keeps every overlay element wired to a profile hero element through the same key", () => {
    const preview = read("src/components/CharacterPublicPagePreview.tsx");
    const scene = read("src/components/CharacterRevealScene.tsx");
    for (const key of ["name", "eyebrow", "tagline", "world", "gender", "height", "weight"]) {
      assert.match(preview, new RegExp(`\\[HERO_ITEM_ATTR\\]: "${key}"`), `hero ${key}`);
      assert.match(scene, new RegExp(`\\[REVEAL_ITEM_ATTR\\]: "${key}"`), `overlay ${key}`);
    }
    assert.match(preview, /HERO_ITEM_ATTR\]: revealTagKey\(i\)/);
    assert.match(scene, /REVEAL_ITEM_ATTR\]: key/);
    assert.doesNotMatch(scene, /creator/i, "creator is not part of the overlay");
  });

  it("hides destination hero copy while the overlay owns the same face and text", () => {
    const css = read("src/app/globals.css");
    assert.match(
      css,
      /html:has\(\.rv-veil\)\s+\[data-character-hero\]\s+:is\(\[data-hero-item\],\s*\[data-character-hero-image\]\)/,
    );
    assert.match(css, /visibility:\s*hidden/);
    const settle = css.slice(css.indexOf("@keyframes rv-item-settle"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.doesNotMatch(settle, /opacity:\s*0/);
  });

  it("moves the gallery out of the poster hero into its own body section", () => {
    const preview = read("src/components/CharacterPublicPagePreview.tsx");
    const hero = preview.slice(preview.indexOf("const heroSection"), preview.indexOf("return (\n    <div className=\"w-full space-y-6\">"));
    assert.doesNotMatch(hero, /galleryStrip/);
    assert.match(preview, /aria-label="갤러리"/);
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

describe("character kinetic assembly choreography", () => {
  it("splits names by grapheme without breaking Hangul, jamo sequences or emoji", () => {
    assert.deepEqual(splitRevealGraphemes("강이현"), ["강", "이", "현"]);
    assert.deepEqual(splitRevealGraphemes("A-1 · 강"), ["A", "-", "1", " ", "·", " ", "강"]);
    const decomposed = "\u1100\u1161\u11a8"; // ㄱ+ㅏ+ㄱ (조합형)
    assert.equal(splitRevealGraphemes(decomposed).length, 1);
    assert.equal(splitRevealGraphemes("👩‍💻나").length, 2);
    assert.equal(splitRevealGraphemes("").length, 0);
  });

  it("converges glyphs from both ends toward the middle", () => {
    assert.deepEqual(revealGlyphRanks(0), []);
    assert.deepEqual(revealGlyphRanks(1), [0]);
    assert.deepEqual(revealGlyphRanks(3), [0, 2, 1]);
    assert.deepEqual(revealGlyphRanks(5), [0, 2, 4, 3, 1]);
    for (const n of [2, 7, 12, 44]) {
      assert.deepEqual([...revealGlyphRanks(n)].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
    }
  });

  it("gives neighbouring glyphs different entry directions (not one shared slide)", () => {
    const dirs = Array.from({ length: 6 }, (_, k) => Math.sign(revealGlyphMotion(k).y));
    assert.ok(dirs.includes(1) && dirs.includes(-1));
    for (let k = 0; k < 6; k++) assert.notEqual(Math.sign(revealGlyphMotion(k).y), Math.sign(revealGlyphMotion(k + 1).y));
    const xs = new Set(Array.from({ length: 6 }, (_, k) => revealGlyphMotion(k).x));
    assert.ok(xs.size >= 5);
  });

  it("starts tags from distinct scattered positions", () => {
    assert.equal(new Set(REVEAL_TAG_SCATTER.map((t) => `${t.x}|${t.y}`)).size, REVEAL_TAG_SCATTER.length);
    assert.ok(new Set(REVEAL_TAG_SCATTER.map((t) => Math.sign(parseFloat(t.y)))).size === 2, "both above and below");
  });

  it("keeps the whole assembly inside the existing 1.4s budget and overlaps the beats", () => {
    const B = REVEAL_BEATS;
    const { minCoverMs, holdMaxMs, revealMs } = CHARACTER_REVEAL_TIMING;
    const lastGlyphEnd = revealGlyphDelayMs(revealGlyphRanks(44).length - 1, 44) + B.nameGlyphMs;
    const tagsEnd = B.tagStartMs + 2 * B.tagStepMs + B.tagMs;
    const taglineEnd = B.taglineStartMs + B.taglineMs;
    const worldEnd = B.worldStartMs + B.worldMs;
    const weightEnd = B.weightStartMs + B.weightMs;
    for (const end of [B.inkOpenMs, B.frameFlyMs, lastGlyphEnd, tagsEnd, taglineEnd, worldEnd, weightEnd]) {
      assert.ok(end <= minCoverMs + 100, `beat ends at ${end}ms`);
    }
    assert.ok(B.worldStartMs < B.genderStartMs && B.genderStartMs < B.heightStartMs && B.heightStartMs < B.weightStartMs);
    assert.notEqual(B.worldStartMs, B.taglineStartMs);
    assert.ok(minCoverMs + revealMs <= 1500);
    assert.ok(holdMaxMs + revealMs <= CHARACTER_REVEAL_TIMING.failsafeMs);
    // beat가 시간상 겹친다: 이름이 끝나기 전에 소개·태그가 시작한다.
    const nameEnd = revealGlyphDelayMs(0, 3) + B.nameGlyphMs;
    assert.ok(B.taglineStartMs < nameEnd && B.tagStartMs < nameEnd);
    // 소개와 태그는 서로 다른 시작 시각을 갖는다.
    assert.notEqual(B.taglineStartMs, B.tagStartMs);
  });

  it("has no leftover uniform-motion keyframes and every rv animation is defined", () => {
    const css = read("src/app/globals.css");
    for (const dead of ["rv-rise", "rv-rise-fade", "rv-name-text", "rv-item-in", ".rv-chip"]) {
      assert.ok(!css.includes(dead), `${dead} should be removed`);
    }
    const defined = new Set([...css.matchAll(/@keyframes (rv-[\w-]+)/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/animation:\s*(rv-[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) assert.ok(defined.has(name), `${name} is defined`);
    for (const name of defined) assert.ok(used.has(name), `${name} is used`);
  });

  it("computes per-element settle deltas and scales only fitted elements", () => {
    const from = { left: 100, top: 300, width: 600, height: 240 };
    const to = { left: 400, top: 200, width: 300, height: 120 };
    assert.deepEqual(revealSettleDelta(from, to, true), { tx: 300, ty: -100, scale: 0.5 });
    assert.deepEqual(revealSettleDelta(from, to, false), { tx: 300, ty: -100, scale: 1 });
    assert.equal(revealSettleDelta({ ...from, width: 0 }, to, true).scale, 1);
    assert.equal(revealSettleDelta(from, { ...to, width: 100000 }, true).scale, 3);
  });
});

describe("dead public facts system is gone", () => {
  it("does not keep a reader, card marker, or CharacterRecord without public data", () => {
    assert.equal(fs.existsSync(path.join(root, "src/lib/publicProfileFacts.ts")), false);
    assert.equal(fs.existsSync(path.join(root, "src/components/CharacterRecord.tsx")), false);
    for (const rel of [
      "src/lib/characterReveal.ts",
      "src/components/CharacterRevealScene.tsx",
      "src/components/MenuTransition.tsx",
      "src/components/CharacterPublicPagePreview.tsx",
      "src/components/CharacterCard.tsx",
      "src/app/tab/[tab]/page.tsx",
      "src/app/character/[id]/page.tsx",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /publicProfileFacts|CharacterRecord|data-character-facts|readPublicProfileFacts|REVEAL_FACT_SCATTER|revealFactKey/, rel);
    }
  });
});
