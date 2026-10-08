import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { characterHueAccent, normalizeCharacterHue } from "@/lib/characterHueAccent";

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const lum = (rgb: [number, number, number]) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const lighter = Math.max(lum(fg), lum(bg));
  const darker = Math.min(lum(fg), lum(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("character hue accent", () => {
  it("normalizes decorative hue without inventing a semantic color", () => {
    assert.equal(normalizeCharacterHue(260), 260);
    assert.equal(normalizeCharacterHue(380), 20);
    assert.equal(normalizeCharacterHue(-20), 340);
    assert.equal(normalizeCharacterHue(Number.NaN), 260);
  });

  it("keeps the editorial label color readable on the charcoal card", () => {
    const card: [number, number, number] = [12, 14, 18];
    for (let hue = 0; hue < 360; hue += 15) {
      const hover = characterHueAccent(hue).hover;
      const match = hover.match(/^hsl\((\d+) 32% 90%\)$/);
      assert.ok(match, hover);
      const ratio = contrast(hslToRgb(Number(match[1]), 32, 90), card);
      assert.ok(ratio >= 4.5, `${hover} contrast ${ratio.toFixed(2)} on #0c0e12`);
    }
  });
});

describe("home editorial owners", () => {
  it("keeps the editorial variant on the home card owner and off other routes", () => {
    const home = read("src/app/page.tsx");
    const card = read("src/components/CharacterCard.tsx");
    assert.equal(home.match(/variant="editorial"/g)?.length, 2);
    assert.match(home, /추천 캐릭터/);
    assert.match(home, /공모전 당선작/);
    assert.match(home, /신규 캐릭터/);
    assert.match(home, /index: "01"/);
    assert.match(home, /eyebrow: "FOR YOU"/);
    assert.match(home, /index: "02"/);
    assert.match(home, /eyebrow: "SELECTED"/);
    assert.match(home, /index: "03"/);
    assert.match(home, /eyebrow: "NEW STORIES"/);
    assert.match(home, /\{meta\.index\} \/ \{meta\.eyebrow\}/);
    assert.match(home, /fetchHomeSections\(db, user, blurNsfw\)/);
    assert.match(home, /shouldHideAdultListings\(user\)/);
    assert.match(home, /HorizontalScrollRow/);
    assert.match(home, /aria-label="콘텐츠 탐색"/);
    assert.match(card, /variant = "default"/);
    assert.match(card, /hover:-translate-y-1\.5/);
    assert.match(card, /rounded-2xl/);
    assert.match(card, /공식/);
    assert.match(card, /다인 시뮬/);
    assert.match(card, /z-\[3\]/);
    assert.match(card, /z-\[1\]/);
    assert.match(card, /z-\[4\]/);
    assert.doesNotMatch(card, /studioSuffix|· 공식 스튜디오/);

    for (const consumer of [
      "src/app/search/page.tsx",
      "src/app/tab/[tab]/page.tsx",
      "src/app/creator/[id]/page.tsx",
      "src/components/MyCharacterCard.tsx",
    ]) {
      assert.doesNotMatch(read(consumer), /variant="editorial"/, consumer);
    }
  });

  it("replaces the promo orb with a static editorial cover", () => {
    const banner = read("src/components/HomeCreateEventBanner.tsx");
    const css = read("src/app/globals.css");
    assert.match(banner, /aria-hidden="true"/);
    assert.match(banner, />\s*HAV\.\s*</);
    assert.match(banner, /<h1/);
    assert.match(banner, /ctaHref: "\/events\/create-migration"/);
    assert.match(banner, /인기 이야기 둘러보기/);
    assert.match(banner, /href="\/tab\/ranking"/);
    assert.doesNotMatch(banner, /home-hero-orb|home-hero-grid|rounded-full|blur-3xl/);
    assert.doesNotMatch(banner, /<h1[^>]*>\s*HAV/);
    assert.match(css, /home-hero-copy-in 420ms ease-out both/);
    assert.doesNotMatch(css, /home-hero-orb|home-hero-grid/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.home-hero-copy \{\s*animation: none;/);
    assert.match(css, /\.home-editorial-card:hover \.home-editorial-media \{\s*transform: none;/);
    assert.match(read("src/components/CharacterCardCarousel.tsx"), /hidden \? "blur-md"/);
  });
});
