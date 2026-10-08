import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isPlainLeftClick,
  menuTransitionSpecForPath,
} from "@/lib/menuTransitionSpec";

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("menu transition specs", () => {
  it("covers every required menu destination with distinct accents", () => {
    const required = [
      "/",
      "/tab/new",
      "/tab/ranking",
      "/tab/following",
      "/trpg",
      "/search",
      "/chats",
      "/persona",
      "/studio",
      "/creator",
      "/verify",
      "/settings",
      "/login",
    ];
    const accents = new Set<string>();
    for (const dest of required) {
      const spec = menuTransitionSpecForPath(dest);
      assert.ok(spec, dest);
      assert.ok(spec.en.length > 0, dest);
      assert.ok(spec.ko.length > 0, dest);
      accents.add(spec.accent);
    }
    // 모든 페이지가 동일한 보라색 fade가 아님 — 목적지별 accent.
    assert.ok(accents.size >= 6, [...accents].join(","));
  });

  it("resolves nested paths and query hrefs without changing navigation", () => {
    assert.equal(menuTransitionSpecForPath("/tab/new?page=2")?.en, "NEW");
    assert.equal(menuTransitionSpecForPath("/login?redirect=/chats")?.en, "LOGIN");
    assert.equal(menuTransitionSpecForPath("/creator/123")?.en, "CREATOR");
    assert.equal(menuTransitionSpecForPath("/character/42"), null);
    assert.equal(menuTransitionSpecForPath("/chat/7"), null);
  });

  it("ignores modified clicks so new-tab and keyboard navigation stay native", () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    assert.equal(isPlainLeftClick(plain), true);
    for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      assert.equal(isPlainLeftClick({ ...plain, [mod]: true }), false, mod);
    }
    assert.equal(isPlainLeftClick({ ...plain, button: 1 }), false);
  });
});

describe("menu transition invariants", () => {
  it("keeps every menu href owned by its existing component", () => {
    assert.match(read("src/components/HeaderMainNavRow.tsx"), /href: "\/tab\/new"/);
    assert.match(read("src/components/HeaderMainNavRow.tsx"), /href: "\/tab\/following"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/chats"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/persona"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/studio"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/creator"/);
    assert.match(read("src/components/Sidebar.tsx"), /\/login\?redirect=\/chats/);
    assert.match(read("src/components/MobileBottomNav.tsx"), /href: "\/settings"/);
    assert.match(read("src/app/page.tsx"), /href: "\/tab\/new"/);
    assert.match(read("src/app/page.tsx"), /href: "\/trpg"/);
    assert.match(read("src/components/Header.tsx"), /href="\/"/);
  });

  it("keeps a single visual owner mounted in the root layout", () => {
    assert.match(read("src/app/layout.tsx"), /MenuTransitionHost/);
    for (const consumer of [
      "src/components/HeaderMainNavRow.tsx",
      "src/components/SidebarShell.tsx",
      "src/components/MobileBottomNav.tsx",
      "src/app/page.tsx",
    ]) {
      assert.doesNotMatch(read(consumer), /MenuTransitionHost|menu-veil/, consumer);
    }
  });

  it("never drives navigation itself and never blocks pointer input", () => {
    const owner = read("src/components/MenuTransition.tsx");
    assert.doesNotMatch(owner, /router\.push|router\.replace|ViewTransition|viewTransition/);
    assert.doesNotMatch(owner, /preventDefault/);
    const css = read("src/app/globals.css");
    assert.match(css, /\.menu-veil \{[^}]*pointer-events: none/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.menu-veil \{\s*display: none;/);
  });
});
