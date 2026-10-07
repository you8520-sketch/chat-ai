import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HOME_STAGE_CANDIDATE_LIMIT,
  HOME_STAGE_PALETTE,
  homePresentationAccent,
  toHomeStageCharacters,
  type HomeStageSource,
} from "@/lib/homeStagePresentation";

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
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

function source(partial: Partial<HomeStageSource> & Pick<HomeStageSource, "id" | "name">): HomeStageSource {
  return {
    tagline: "골목의 불빛",
    genre: "일상",
    nsfw: 0,
    official: 0,
    emoji: "✳",
    creator_name: "작가",
    creator_id: 41,
    content_kind: "character",
    images: JSON.stringify(["/dev/portrait.webp", "/dev/second.webp"]),
    assets: "",
    ...partial,
  };
}

describe("home stage accent", () => {
  it("picks a stable palette color from the character id", () => {
    assert.equal(homePresentationAccent(9820012).id, HOME_STAGE_PALETTE[9820012 % 6]?.id);
    assert.equal(homePresentationAccent(9820013).id, HOME_STAGE_PALETTE[9820013 % 6]?.id);
    assert.notEqual(homePresentationAccent(9820012).wash, homePresentationAccent(9820013).wash);
    assert.equal(homePresentationAccent(9820012).wash, homePresentationAccent(9820012).wash);
    assert.equal(homePresentationAccent(Number.NaN).id, HOME_STAGE_PALETTE[0]?.id);
  });

  it("keeps wash type and ink-on-wash controls readable", () => {
    const stage: [number, number, number] = [7, 8, 12];
    for (const accent of HOME_STAGE_PALETTE) {
      const wash = hexToRgb(accent.wash);
      const ink = hexToRgb(accent.ink);
      const typeRatio = contrast(wash, stage);
      const controlRatio = contrast(ink, wash);
      assert.ok(typeRatio >= 4.5, `${accent.id} wash contrast ${typeRatio.toFixed(2)}`);
      assert.ok(controlRatio >= 4.5, `${accent.id} ink contrast ${controlRatio.toFixed(2)}`);
    }
  });
});

describe("home stage candidates", () => {
  it("keeps filtered order, the first public image, and a five-candidate cap", () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      source({ id: 100 + index, name: `이름${index}` }),
    );
    const stage = toHomeStageCharacters(rows, { blurNsfw: true, loggedIn: false });
    assert.equal(stage.length, HOME_STAGE_CANDIDATE_LIMIT);
    assert.deepEqual(
      stage.map((row) => row.id),
      [100, 101, 102, 103, 104],
    );
    assert.equal(stage[0]?.imageUrl, "/dev/portrait.webp");
    assert.equal(stage[0]?.href, "/login?redirect=%2Fcharacter%2F100");
    assert.equal(stage[0]?.indexLabel, "01");
    assert.equal(stage[0]?.totalLabel, "05");
    assert.equal(stage[0]?.creatorHref, "/creator/41");
  });

  it("drops adult-hidden rows instead of exposing their artwork", () => {
    const hidden = source({
      id: 77,
      name: "성인숨김검증캐릭터",
      nsfw: 1,
      images: JSON.stringify(["/secret/adult.webp"]),
    });
    const visible = source({ id: 78, name: "공개" });
    const blurred = toHomeStageCharacters([hidden, visible], { blurNsfw: true, loggedIn: true });
    assert.deepEqual(
      blurred.map((row) => row.id),
      [78],
    );
    assert.equal(JSON.stringify(blurred).includes("/secret/adult.webp"), false);

    const open = toHomeStageCharacters([hidden], { blurNsfw: false, loggedIn: true });
    assert.equal(open[0]?.href, "/character/77");
    assert.equal(open[0]?.imageUrl, "/secret/adult.webp");
  });

  it("uses the logged-in character href without a new route", () => {
    const stage = toHomeStageCharacters([source({ id: 15, name: "권태현" })], {
      blurNsfw: true,
      loggedIn: true,
    });
    assert.equal(stage[0]?.href, "/character/15");
  });
});

describe("home presentation owners", () => {
  it("keeps the stage on filtered recommended data and editorial cards off other routes", () => {
    const home = read("src/app/page.tsx");
    const stage = read("src/components/HomeCharacterStage.tsx");
    const card = read("src/components/CharacterCard.tsx");
    assert.match(home, /toHomeStageCharacters\(recommended, \{ blurNsfw, loggedIn \}\)/);
    assert.match(home, /fetchHomeSections\(db, user, blurNsfw\)/);
    assert.match(home, /shouldHideAdultListings\(user\)/);
    assert.match(home, /<HomeCharacterStage/);
    assert.equal(home.match(/variant="editorial"/g)?.length, 2);
    assert.match(home, /공모전 당선작/);
    assert.match(home, /신규 캐릭터/);
    assert.match(home, /index: "02"/);
    assert.match(home, /eyebrow: "SELECTED"/);
    assert.match(home, /index: "03"/);
    assert.match(home, /eyebrow: "NEW STORIES"/);
    assert.match(home, /\{meta\.index\} \/ \{meta\.eyebrow\}/);
    assert.match(home, /HorizontalScrollRow/);
    assert.match(home, /aria-label="콘텐츠 탐색"/);
    assert.doesNotMatch(home, /title="추천 캐릭터"/);
    assert.doesNotMatch(home, /text-white\/\[0\.045\]/);
    assert.match(stage, /const STAGE_INDEX = "01"/);
    assert.match(stage, /const STAGE_EYEBROW = "FOR YOU"/);
    assert.match(stage, /const STAGE_TITLE = "추천 캐릭터"/);
    assert.match(stage, /role="tablist"/);
    assert.match(stage, /aria-label="추천 캐릭터 선택"/);
    assert.match(stage, /펼쳐 보기/);
    assert.match(stage, /선택으로/);
    assert.match(stage, /이야기 열기/);
    assert.match(stage, /rounded-full/);
    assert.match(stage, /href=\{character\.href\}/);
    assert.match(stage, /aria-hidden/);
    assert.match(stage, /data-stage-mode="selector"/);
    assert.match(stage, /data-stage-mode="feature"/);
    assert.match(card, /homePresentationAccent\(c\.id\)/);
    assert.doesNotMatch(card, /characterHueAccent/);
    assert.match(card, /variant = "default"/);
    assert.match(card, /hover:-translate-y-1\.5/);
    assert.match(card, /rounded-2xl/);
    assert.match(card, /공식/);
    assert.match(card, /다인 시뮬/);
    assert.match(card, /z-\[3\]/);
    assert.match(card, /z-\[1\]/);
    assert.match(card, /z-\[4\]/);
    assert.doesNotMatch(card, /studioSuffix|· 공식 스튜디오/);
    assert.equal(fs.existsSync(path.join(root, "src/lib/characterHueAccent.ts")), false);

    for (const consumer of [
      "src/app/search/page.tsx",
      "src/app/tab/[tab]/page.tsx",
      "src/app/creator/[id]/page.tsx",
      "src/components/MyCharacterCard.tsx",
    ]) {
      assert.doesNotMatch(read(consumer), /variant="editorial"/, consumer);
      assert.doesNotMatch(read(consumer), /HomeCharacterStage/, consumer);
    }
  });

  it("moves the creator event under the stage without a second hero", () => {
    const banner = read("src/components/HomeCreateEventBanner.tsx");
    const css = read("src/app/globals.css");
    const home = read("src/app/page.tsx");
    const stageAt = home.indexOf("<HomeCharacterStage");
    const bannerAt = home.indexOf("<HomeCreateEventBanner");
    assert.ok(stageAt >= 0 && bannerAt > stageAt);
    assert.match(banner, /CREATE_MIGRATION_EVENT_REWARD/);
    assert.match(banner, /ctaHref: "\/events\/create-migration"/);
    assert.match(banner, /인기 이야기 둘러보기/);
    assert.match(banner, /href="\/tab\/ranking"/);
    assert.match(banner, /공개 저장 후 신청/);
    assert.doesNotMatch(banner, /<h1/);
    assert.doesNotMatch(banner, /HAV\./);
    assert.doesNotMatch(banner, /home-hero/);
    assert.doesNotMatch(css, /home-hero-copy|home-hero-display|home-hero-orb|home-hero-grid/);
    assert.match(css, /home-stage-swap 380ms ease/);
    assert.match(css, /opacity: 1;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.home-stage-swap \{\s*animation: none;/);
    assert.match(css, /\.home-editorial-card:hover \.home-editorial-media \{\s*transform: none;/);
    assert.match(read("src/components/CharacterCardCarousel.tsx"), /hidden \? "blur-md"/);
  });
});
