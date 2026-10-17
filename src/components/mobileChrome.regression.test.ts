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

  it("lets the editor tab bar and save bar flow with the page on short screens while the keyboard is open", () => {
    const create = read("src/components/CreateCharacter.tsx");
    assert.match(saveBar, /"studio-save-bar fixed/);
    assert.match(create, /"studio-sticky-tabs sticky top-\[var\(--site-header-height,44px\)\]/);
    const rule = css.match(/@media \(max-height: 500px\) \{\s*html\[data-keyboard-open\] \.studio-sticky-tabs,\s*html\[data-keyboard-open\] \.studio-save-bar \{\s*position: static;[\s\S]*?\n\}\n/);
    assert.ok(rule, "short-screen keyboard rule exists");
    assert.match(rule[0], /--studio-save-bar-h: 0px !important/);
    assert.match(rule[0], /scroll-padding-top: calc\(var\(--site-header-height, 0px\) \+ 0\.5rem\) !important/);
    assert.match(rule[0], /scroll-padding-bottom: calc\(var\(--keyboard-inset, 0px\) \+ 0\.5rem\) !important/);
    assert.doesNotMatch(rule[0], /site-header\s*\{/);
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

describe("E4-7 /create fixed bars own the scroll padding they cover", () => {
  const saveBar = read("src/components/studio/StudioSaveBar.tsx");
  const create = read("src/components/CreateCharacter.tsx");

  it("reserves save bar + bottom nav + keyboard inset below focused fields", () => {
    const padding = saveBar.slice(saveBar.indexOf('"scroll-padding-bottom"'));
    assert.match(padding.slice(0, 220), /var\(--mobile-nav-offset, 0px\)/);
    assert.match(padding.slice(0, 220), /var\(--keyboard-inset, 0px\)/);
  });

  it("reserves header + sticky tab bar above focused fields and releases it on unmount", () => {
    assert.match(create, /"scroll-padding-top"/);
    assert.match(create, /var\(--site-header-height, 0px\) \+ \$\{Math\.ceil\(tabs\.getBoundingClientRect\(\)\.height\)\}px/);
    assert.match(create, /removeProperty\("scroll-padding-top"\)/);
  });

  it("jumps to the label row so the field title is not hidden behind the tab bar", () => {
    assert.match(create, /\.labels\?\.\[0\]\?\.parentElement \?\? el/);
  });
});
