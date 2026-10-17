import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isPlainLeftClick, TRANSITION_FAILSAFE_MS } from "@/lib/transitionShared";

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const MENU_OWNERS = [
  "src/components/Header.tsx",
  "src/components/HeaderMainNavRow.tsx",
  "src/components/MobileBottomNav.tsx",
  "src/components/SidebarShell.tsx",
];

describe("general menus navigate without a full-screen transition (E4-8)", () => {
  it("has no menu transition spec, marker, burst kind or veil CSS left", () => {
    assert.equal(fs.existsSync(path.join(root, "src/lib/menuTransitionSpec.ts")), false);
    for (const owner of MENU_OWNERS) {
      assert.doesNotMatch(read(owner), /data-menu-transition/, owner);
    }
    const host = read("src/components/MenuTransition.tsx");
    assert.doesNotMatch(host, /menuTransitionSpec|MENU_TRANSITION|MenuBurst|kind: "menu"|case "menu"|menu-veil|menu-flash/);
    const css = read("src/app/globals.css");
    assert.doesNotMatch(css, /\.menu-(veil|ink|field|type|slab|flash|en|ko)\b|@keyframes menu-/);
  });

  it("keeps every menu href owned by its existing component", () => {
    assert.match(read("src/components/HeaderMainNavRow.tsx"), /href: "\/tab\/new"/);
    assert.match(read("src/components/HeaderMainNavRow.tsx"), /href: "\/tab\/following"/);
    assert.match(read("src/components/HeaderMainNavRow.tsx"), /href: "\/trpg"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/chats"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/persona"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/studio"/);
    assert.match(read("src/components/Sidebar.tsx"), /href: "\/creator"/);
    assert.match(read("src/components/Sidebar.tsx"), /\/login\?redirect=\/chats/);
    assert.match(read("src/components/MobileBottomNav.tsx"), /href: "\/settings"/);
    assert.match(read("src/components/Header.tsx"), /href="\/"/);
  });

  it("still mounts the single lifecycle owner for the character, chat and TRPG scenes", () => {
    assert.match(read("src/app/layout.tsx"), /MenuTransitionHost/);
    const host = read("src/components/MenuTransition.tsx");
    for (const scene of ["CharacterRevealScene", "ChatResumeScene", "TrpgResumeScene"]) {
      assert.match(host, new RegExp(`<${scene} `), scene);
    }
    for (const attr of ["CHARACTER_CARD_ATTR", "CHAT_RESUME_ATTR", "TRPG_RESUME_ATTR"]) {
      assert.match(host, new RegExp(attr), attr);
    }
    for (const consumer of [...MENU_OWNERS, "src/app/page.tsx"]) {
      assert.doesNotMatch(read(consumer), /MenuTransitionHost|CharacterRevealScene/, consumer);
    }
  });

  it("never drives navigation itself and never blocks pointer input", () => {
    const owner = read("src/components/MenuTransition.tsx");
    assert.doesNotMatch(owner, /router\.push|router\.replace|ViewTransition|viewTransition/);
    assert.doesNotMatch(owner, /preventDefault/);
    const css = read("src/app/globals.css");
    for (const veil of ["rv-veil", "cr-veil", "tr-veil"]) {
      assert.match(css, new RegExp(`\\.${veil} \\{[^}]*pointer-events: none`), veil);
    }
  });

  it("keeps the shared click and failsafe rules for the remaining scenes", () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    assert.equal(isPlainLeftClick(plain), true);
    for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      assert.equal(isPlainLeftClick({ ...plain, [mod]: true }), false, mod);
    }
    assert.equal(isPlainLeftClick({ ...plain, button: 1 }), false);
    assert.equal(TRANSITION_FAILSAFE_MS, 1800);
  });
});
