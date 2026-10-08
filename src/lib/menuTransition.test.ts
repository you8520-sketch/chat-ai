import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isPlainLeftClick,
  MENU_TRANSITION_ATTR,
  MENU_TRANSITION_TIMING,
  menuRevealDelayMs,
  menuTransitionSpecForPath,
  resolveMenuClickTransition,
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

describe("menu click scope", () => {
  it("runs only for approved menu regions", () => {
    const menu = resolveMenuClickTransition({ inMenuRegion: true, destPathname: "/tab/new", currentPathname: "/" });
    assert.equal(menu?.en, "NEW");
    // 캐릭터 태그 /search?q=…, 제작자 /creator/:id, TRPG 내부 /trpg/… 는 메뉴 영역 밖.
    for (const dest of ["/search", "/creator/7", "/trpg/12", "/studio", "/tab/ranking"]) {
      assert.equal(
        resolveMenuClickTransition({ inMenuRegion: false, destPathname: dest, currentPathname: "/" }),
        null,
        dest,
      );
    }
  });

  it("skips same-pathname re-clicks and query-only moves", () => {
    assert.equal(
      resolveMenuClickTransition({ inMenuRegion: true, destPathname: "/tab/new", currentPathname: "/tab/new" }),
      null,
    );
    assert.equal(
      resolveMenuClickTransition({ inMenuRegion: true, destPathname: "/", currentPathname: "/" }),
      null,
    );
  });

  it("marks exactly the approved menu owners and not recent activity or content links", () => {
    const attr = new RegExp(`${MENU_TRANSITION_ATTR}=""`);
    assert.match(read("src/components/HeaderMainNavRow.tsx"), attr);
    assert.match(read("src/components/MobileBottomNav.tsx"), attr);
    assert.match(read("src/components/Header.tsx"), attr);
    assert.match(read("src/app/page.tsx"), attr);
    const side = read("src/components/SidebarShell.tsx");
    assert.match(side, /<nav className="flex shrink-0 flex-col gap-0\.5" data-menu-transition="">/);
    for (const content of [
      "src/components/SidebarRecentChatIcons.tsx",
      "src/components/CharacterCard.tsx",
      "src/app/creator/[id]/page.tsx",
      "src/app/trpg/TrpgCatalogBrowse.tsx",
    ]) {
      assert.doesNotMatch(read(content), new RegExp(MENU_TRANSITION_ATTR), content);
    }
  });

  it("does not start a veil from pathname changes alone", () => {
    const owner = read("src/components/MenuTransition.tsx");
    assert.match(owner, /closest\(`\[\$\{MENU_TRANSITION_ATTR\}\]`\)/);
    const effect = owner.slice(owner.indexOf("// BEAT 3"));
    assert.doesNotMatch(effect, /scheduleBurst\(/);
    assert.doesNotMatch(owner, /menuTransitionSpecForPath/);
  });
});

describe("menu transition timeline", () => {
  it("holds the impact scene even when the destination arrives almost instantly", () => {
    const { minCoverMs, holdMaxMs, revealMs, failsafeMs } = MENU_TRANSITION_TIMING;
    // 실측: 프로덕션에서 pathname 변경은 클릭 후 ~45ms. reveal은 그보다 훨씬 늦어야 한다.
    assert.equal(menuRevealDelayMs(45), minCoverMs - 45);
    assert.equal(menuRevealDelayMs(minCoverMs + 100), 0);
    assert.ok(minCoverMs >= 500, "cover + impact hold must outlast the 340ms entrance");
    assert.ok(holdMaxMs >= minCoverMs);
    assert.ok(holdMaxMs + revealMs <= failsafeMs, "late reveal must still finish before the failsafe");
    assert.equal(failsafeMs, 1800);
  });

  it("host schedules reveal through the shared timeline, not a fixed cover timer", () => {
    const owner = read("src/components/MenuTransition.tsx");
    assert.match(owner, /menuRevealDelayMs\(/);
    assert.match(owner, /MENU_TRANSITION_TIMING/);
    assert.doesNotMatch(owner, /COVER_MS/);
    assert.doesNotMatch(owner, /router\./);
  });

  it("css uses one set of layers and no legacy slash/baseline rules", () => {
    const css = read("src/app/globals.css");
    for (const cls of ["menu-ink", "menu-field", "menu-slab", "menu-en", "menu-ko"]) {
      assert.match(css, new RegExp(`\\.${cls}\\b`), cls);
    }
    assert.doesNotMatch(css, /menu-slash|menu-baseline|menu-type-in/);
    assert.match(css, /\.menu-veil\s*\{[^}]*pointer-events:\s*none/);
    assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.menu-veil\s*\{\s*display:\s*none/);
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
