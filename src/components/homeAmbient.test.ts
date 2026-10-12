import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/link") return { __esModule: true, default: "a" };
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import type { CharacterRow } from "@/components/CharacterCard";

// Loaded after the Module._load stubs above; a static import would be hoisted before them.
const loadAmbientUrl = async () => (await import("@/components/CharacterCard")).characterCardAmbientUrl;

function row(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 7,
    name: "테스트",
    tagline: "소개",
    genre: "판타지",
    tags: "[]",
    nsfw: 0,
    official: 1,
    emoji: "✨",
    hue: 260,
    creator_name: "공식계정",
    likes: 0,
    total_turns: 0,
    chats_count: 0,
    created_at: "2026-01-01 00:00:00",
    images: JSON.stringify(["/uploads/a.webp"]),
    assets: JSON.stringify([{ url: "/uploads/a.webp", tag: "대표" }]),
    ...over,
  } as CharacterRow;
}

describe("E4-3C candidate B ambient backdrop", () => {
  it("never exposes adult-hidden art, even blurred", async () => {
    const characterCardAmbientUrl = await loadAmbientUrl();
    assert.equal(characterCardAmbientUrl(row({ nsfw: 1 }), true), null);
    assert.ok(characterCardAmbientUrl(row({ nsfw: 1 }), false));
    assert.ok(characterCardAmbientUrl(row({ nsfw: 0 }), true));
  });

  it("returns null when a character has no cover art", async () => {
    const characterCardAmbientUrl = await loadAmbientUrl();
    assert.equal(characterCardAmbientUrl(row({ images: "[]", assets: "[]" }), false), null);
  });

  it("is decorative, static, scoped to home and uses the card owner for the safety decision", () => {
    const home = fs.readFileSync("src/app/page.tsx", "utf8");
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    assert.match(home, /characterCardAmbientUrl\(c, blurNsfw\)/);
    assert.match(home, /<span aria-hidden className="home-ambient">/);
    assert.match(home, /alt=""/);
    const block = css.slice(css.indexOf(".home-ambient {"), css.indexOf(".home-band {"));
    assert.doesNotMatch(block, /animation|@keyframes|transition/);
    assert.match(block, /forced-colors: active/);
    assert.doesNotMatch(css, /\.home-ambient[^{]*\{[^}]*position:\s*fixed/);
  });
});
