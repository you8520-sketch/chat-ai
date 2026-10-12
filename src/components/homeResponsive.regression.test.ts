import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

/** Viewport breakpoint variants (`sm:`, `md:`, `min-[576px]:` ...). Container variants (`@xl:`) are not matched. */
const VIEWPORT_VARIANT = /(?:^|[\s"'`])(?:max-)?(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):/;

function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${from} .. ${to}`);
  return source.slice(start, end);
}

/**
 * E4-3C P0. The left rail narrows the main column to roughly (viewport - 232px) from 576px up,
 * so viewport breakpoints made the 640px home squeeze the event copy and section titles
 * into one-glyph-wide columns. Home column layout must follow the container instead.
 */
describe("E4-3C home column responsive layout", () => {
  const banner = read("src/components/HomeCreateEventBanner.tsx");
  const home = read("src/app/page.tsx");
  const css = read("src/app/globals.css");

  it("lays the event banner out by container width, never by viewport breakpoint", () => {
    assert.match(banner, /@container/);
    assert.doesNotMatch(banner, VIEWPORT_VARIANT);
  });

  it("keeps Korean event copy from breaking inside a word", () => {
    for (const marker of ["{BANNER.eyebrow}", "{BANNER.title}"]) {
      const at = banner.indexOf(marker);
      const open = banner.lastIndexOf("<p", at);
      assert.match(banner.slice(open, at), /break-keep/, marker);
    }
  });

  it("keeps event content, destination and reward source unchanged", () => {
    assert.match(banner, /CREATE_MIGRATION_EVENT_REWARD/);
    assert.match(banner, /ctaHref: "\/events\/create-migration"/);
    assert.match(banner, /ctaLabel: "제작 이벤트 참여"/);
    assert.match(banner, /href="\/tab\/ranking"/);
  });

  it("sizes section headers by container width and never breaks a title mid-word", () => {
    const header = between(home, "function SectionHeader(", "function ScrollSection(");
    assert.doesNotMatch(header, VIEWPORT_VARIANT);
    assert.match(header, /<Heading[\s\S]*?break-keep/);
    assert.match(header, /@xl:flex-nowrap/);
  });

  it("makes each home section a size container so headers and grids can query it", () => {
    const scroll = between(home, "function ScrollSection(", "function GridSection(");
    const grid = between(home, "function GridSection(", "export default async function Home");
    assert.match(scroll, /"@container"/);
    assert.match(grid, /<section className="@container/);
  });

  it("chooses grid columns from the section width, not the viewport", () => {
    const grid = between(home, "function GridSection(", "export default async function Home");
    const cols = grid.match(/grid-cols-2[^"]*/)?.[0] ?? "";
    assert.match(cols, /@lg:grid-cols-3/);
    assert.match(cols, /@4xl:grid-cols-4/);
    assert.doesNotMatch(cols, VIEWPORT_VARIANT);
  });

  it("staggers grid rows with container queries that mirror the column breakpoints", () => {
    assert.match(css, /@container \(min-width: 32rem\)\s*\{[^}]*\.home-grid-stagger/);
    assert.match(css, /@container \(min-width: 56rem\)\s*\{[^}]*\.home-grid-stagger/);
    assert.doesNotMatch(css, /@media \(min-width: (?:640|1280)px\)\s*\{\s*\.home-grid-stagger/);
  });
});
