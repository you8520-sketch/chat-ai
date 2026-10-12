import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { KEYBOARD_OPEN_THRESHOLD_PX, computeKeyboardInset } from "../lib/keyboardInset";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("E4-3B fixed bottom chrome", () => {
  const layout = read("src/app/layout.tsx");
  const header = read("src/components/Header.tsx");
  const bottomNav = read("src/components/MobileBottomNav.tsx");
  const saveBar = read("src/components/studio/StudioSaveBar.tsx");
  const footer = read("src/components/SiteLegalFooter.tsx");
  const css = read("src/app/globals.css");
  const home = read("src/app/page.tsx");

  it("loads the session once in the root layout and hands it to Header", () => {
    assert.equal((layout.match(/getSessionUser\(\)/g) ?? []).length, 1);
    assert.match(layout, /<Header user=\{user\} \/>/);
    assert.match(layout, /<MobileBottomNav loggedIn=\{!!user\} \/>/);
    assert.doesNotMatch(header, /getSessionUser/);
    assert.doesNotMatch(header, /MobileBottomNav/);
    assert.match(header, /Header\(\{ user \}: \{ user: User \| null \}\)/);
  });

  it("places the bottom nav after main and the footer so Tab order follows the screen", () => {
    const main = layout.indexOf("<main");
    const footerAt = layout.indexOf("<SiteLegalFooter />");
    const nav = layout.indexOf("<MobileBottomNav");
    assert.ok(main > 0 && footerAt > main && nav > footerAt);
  });

  it("hides the bottom nav in chat and TRPG rooms, whose docks own the bottom edge", () => {
    assert.match(bottomNav, /isCompactRoomPathname\(pathname\)/);
  });

  it("derives every bottom reserve from one nav-height token", () => {
    assert.match(css, /--mobile-bottom-nav-h: calc\(3\.25rem \+ 1px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    assert.match(css, /--mobile-nav-offset: var\(--mobile-bottom-nav-h\)/);
    assert.match(css, /html\[data-keyboard-open\] \.mobile-bottom-nav \{\s*display: none;/);
    assert.match(css, /@media \(min-width: 576px\) \{\s*:root \{\s*--mobile-nav-offset: 0px;/);
    assert.match(footer, /pb-\[calc\(var\(--mobile-bottom-nav-h\)\+var\(--studio-save-bar-h,0px\)\+1rem\)\]/);
    assert.match(footer, /min-\[576px\]:pb-\[calc\(var\(--studio-save-bar-h,0px\)\+1\.5rem\)\]/);
    assert.doesNotMatch(footer, /md:pb-6/);
  });

  it("docks the studio save bar on the nav and keyboard offsets without raising z-index", () => {
    assert.match(saveBar, /bottom-\[calc\(var\(--mobile-nav-offset\)\+var\(--keyboard-inset\)\)\]/);
    assert.doesNotMatch(saveBar, /4\.5rem/);
    assert.match(saveBar, /z-40/);
    assert.match(saveBar, /--studio-save-bar-h/);
    assert.match(saveBar, /root\.style\.removeProperty\("--studio-save-bar-h"\)/);
    assert.match(saveBar, /pb-0 min-\[576px\]:pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it("leaves discovery to the header row, so the home page carries no second tab set", () => {
    assert.doesNotMatch(home, /MobileDiscoveryNav|MOBILE_DISCOVERY_TABS/);
  });

  it("registers the keyboard inset publisher once in the layout", () => {
    assert.equal((layout.match(/<VirtualKeyboardInset \/>/g) ?? []).length, 1);
    const source = read("src/components/VirtualKeyboardInset.tsx");
    assert.match(source, /--keyboard-inset/);
    assert.match(source, /data-keyboard-open/);
    assert.match(source, /removeEventListener\("resize"/);
  });
});

describe("computeKeyboardInset", () => {
  const base = { layoutHeight: 800, viewportHeight: 800, viewportOffsetTop: 0, scale: 1 };

  it("is 0 with no keyboard", () => {
    assert.equal(computeKeyboardInset(base), 0);
  });

  it("ignores URL-bar sized changes below the threshold", () => {
    assert.equal(computeKeyboardInset({ ...base, viewportHeight: 800 - (KEYBOARD_OPEN_THRESHOLD_PX - 1) }), 0);
  });

  it("reports the covered height once the keyboard opens", () => {
    assert.equal(computeKeyboardInset({ ...base, viewportHeight: 480 }), 320);
  });

  it("subtracts a scrolled visual viewport (iOS shifts offsetTop)", () => {
    assert.equal(computeKeyboardInset({ ...base, viewportHeight: 480, viewportOffsetTop: 40 }), 280);
  });

  it("is 0 while pinch-zoomed", () => {
    assert.equal(computeKeyboardInset({ ...base, viewportHeight: 400, scale: 2 }), 0);
  });
});

describe("E4-3B candidate A — header strip owns mobile discovery", () => {
  const mainNav = read("src/components/HeaderMainNavRow.tsx");
  const header = read("src/components/Header.tsx");

  it("renders the strip below lg at every width, inside the sticky header, and still hides it in chat rooms", () => {
    assert.match(mainNav, /"flex border-t border-white\/\[0\.06\] lg:hidden"/);
    assert.doesNotMatch(mainNav, /min-\[576px\]:flex/);
    assert.match(header.slice(header.indexOf("<header"), header.indexOf("</header>")), /variant="strip"/);
    assert.match(mainNav, /isChatRoomPathname\(pathname\)/);
  });

  it("anchors the TRPG mobile tools panel to the measured header height, not a fixed 64px guess", () => {
    const room = read("src/app/trpg/TrpgCampaignRoom.tsx");
    assert.match(room, /top-\[calc\(var\(--site-header-height,4rem\)\+0\.5rem\)\]/);
    assert.doesNotMatch(room, /top-\[4\.5rem\]/);
  });

  it("keeps the active tab in view when the strip scrolls", () => {
    assert.match(mainNav, /\[aria-current="page"\]/);
    assert.match(mainNav, /nav\.scrollLeft = /);
  });
});
