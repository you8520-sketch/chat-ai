import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const preview = read("src/components/CharacterPublicPagePreview.tsx");
const page = read("src/app/character/[id]/page.tsx");
const startRow = read("src/components/CharacterStartRow.tsx");

const heroStart = preview.indexOf("const heroSection");
const heroEnd = preview.indexOf('return (\n    <div className="w-full space-y-6">');
const hero = preview.slice(heroStart, heroEnd);
const defaultBranch = preview.slice(preview.indexOf(") : (\n        <div className=\"flex flex-col gap-5 md:flex-row"));

describe("E4-3D character detail hero", () => {
  it("moves the existing start row into the poster hero instead of duplicating it", () => {
    assert.match(page, /heroActions=\{startRow\}/);
    const rows = page.match(/<CharacterStartRow\b/g) ?? [];
    assert.equal(rows.length, 2, "one detail row + one chat-intro embed row");
    const actionRow = page.slice(page.indexOf('<div className="flex flex-wrap items-center gap-3">'));
    assert.doesNotMatch(actionRow.slice(0, actionRow.indexOf("{showComments")), /CharacterStartRow|startRow/);
    assert.match(page, /const startRow = \(\s*<CharacterStartRow[\s\S]*?\bprimary\b[\s\S]*?\/>\s*\);/);
  });

  it("keeps the start row after the tagline and before tags/dossier in the hero", () => {
    const tagline = hero.indexOf('[HERO_ITEM_ATTR]: "tagline"');
    const actions = hero.indexOf("{heroActions ?");
    const tags = hero.indexOf("{tagChips}");
    const dossier = hero.indexOf("<PublicDossierBlock");
    assert.ok(tagline > 0 && tagline < actions && actions < tags && tags < dossier);
  });

  it("switches to the two-column poster layout by rail-aware width, not the bare md breakpoint", () => {
    assert.doesNotMatch(hero, /\bmd:/);
    assert.match(hero, /min-\[960px\]:grid-cols-\[/);
  });

  it("does not trap the start dialog or persona popover inside the hero", () => {
    const section = hero.slice(hero.indexOf("<section"), hero.indexOf(">", hero.indexOf("<section")));
    assert.doesNotMatch(section, /isolate|overflow-hidden/);
    const body = hero.slice(hero.indexOf("min-w-0"));
    const columnOpen = body.slice(0, body.indexOf("style="));
    assert.doesNotMatch(columnOpen, /container-type|\bz-0\b/);
    assert.match(hero, /<div className="\[container-type:inline-size\]">\s*<h1/);
  });

  it("keeps D-1 reveal markers on the hero frame and items", () => {
    assert.match(hero, /\[CHARACTER_HERO_IMAGE_ATTR\]/);
    assert.match(hero, /aspect-\[2\/3\]/);
    for (const key of ["eyebrow", "name", "tagline"]) {
      assert.match(hero, new RegExp(`\\[HERO_ITEM_ATTR\\]: "${key}"`));
    }
    assert.match(hero, /\[REVEAL_FIT_ATTR\]: "width"/);
  });

  it("limits the primary start styling to the detail row; embed and preview keep their layout", () => {
    assert.match(startRow, /primary\?: boolean/);
    assert.match(startRow, /className=\{primary \? primaryBtn : actionBtn\}/);
    const embed = page.slice(page.indexOf("embedMode"), page.indexOf("embedMode") + 400);
    assert.doesNotMatch(embed, /\bprimary\b/);
    assert.doesNotMatch(defaultBranch, /heroActions/);
  });
});
