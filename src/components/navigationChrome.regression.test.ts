import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

const NAV_WIDTHS = [360, 390, 575, 576, 600, 640, 767, 768, 900, 1023, 1024, 1440];
const MIN_WIDTH_VARIANTS: Record<string, number> = { "min-[576px]": 576, sm: 640, md: 768, lg: 1024 };

/** Tailwind-lite: resolves a class list at a viewport width into the final display value. */
function resolveDisplay(classes: string, width: number): "hidden" | "shown" {
  let display: "hidden" | "shown" = "shown";
  const stack: Array<[number, "hidden" | "shown"]> = [];
  for (const token of classes.split(/\s+/)) {
    const m = token.match(/^(?:(min-\[576px\]|sm|md|lg):)?(hidden|flex|inline-flex|block|inline-block|inline)$/);
    if (!m) continue;
    const minWidth = m[1] ? MIN_WIDTH_VARIANTS[m[1]]! : 0;
    stack.push([minWidth, m[2] === "hidden" ? "hidden" : "shown"]);
  }
  stack.sort((a, b) => a[0] - b[0]);
  for (const [minWidth, value] of stack) if (width >= minWidth) display = value;
  return display;
}

function navClassName(source: string, marker: RegExp): string {
  const m = source.match(marker);
  assert.ok(m, `class list not found for ${marker}`);
  return m![0].replace(/"/g, "");
}

describe("E4-3A navigation chrome", () => {
  const mainNav = read("src/components/HeaderMainNavRow.tsx");
  const bottomNav = read("src/components/MobileBottomNav.tsx");
  const profileMenu = read("src/components/HeaderProfileMenu.tsx");
  const header = read("src/components/Header.tsx");

  it("shows exactly one main-tab row at every width (inline from lg, strip below lg)", () => {
    const inline = navClassName(mainNav, /"hidden shrink lg:inline-flex"/);
    const strip = navClassName(mainNav, /"flex border-t border-white\/\[0\.06\] lg:hidden"/);
    for (const width of NAV_WIDTHS) {
      const inlineShown = resolveDisplay(inline, width) === "shown";
      const stripShown = resolveDisplay(strip, width) === "shown";
      assert.equal(inlineShown !== stripShown, true, `${width}px must show exactly one tab row`);
    }
  });

  it("renders the strip row inside the sticky header so the rail geometry follows its height", () => {
    const siteHeader = header.slice(header.indexOf("<header"), header.indexOf("</header>"));
    assert.match(siteHeader, /<HeaderMainNavRow variant="strip" \/>/);
    assert.match(siteHeader, /<HeaderMainNavRow \/>/);
  });

  it("keeps every main-tab destination and no menu transition marker", () => {
    for (const href of ["/", "/tab/new", "/tab/ranking", "/trpg", "/search", "/tab/following"]) {
      assert.match(mainNav, new RegExp(`href: "${href.replace(/\//g, "\\/")}"`));
    }
    assert.doesNotMatch(mainNav, /data-menu-transition/);
  });

  it("keeps the mobile bottom nav destinations, hides it from 576px, and honors the iOS safe area", () => {
    for (const href of ["/", "/chats", "/studio", "/settings"]) {
      assert.match(bottomNav, new RegExp(`href: "${href.replace(/\//g, "\\/")}"`));
    }
    assert.match(bottomNav, /min-\[576px\]:hidden/);
    assert.match(bottomNav, /pb-\[env\(safe-area-inset-bottom\)\]/);
    assert.match(read("src/app/layout.tsx"), /app-shell[^"]*pb-6 pt-4/);
  });

  it("exposes settings, albums, safety filter and logout from the profile menu at every width", () => {
    assert.match(profileMenu, /className="relative shrink-0"/);
    assert.doesNotMatch(profileMenu, /min-\[576px\]:block/);
    assert.match(profileMenu, /aria-haspopup="menu"/);
    assert.match(profileMenu, /href="\/settings"/);
    assert.match(profileMenu, /href="\/albums"/);
    assert.match(profileMenu, /variant="profileMenu"/);
    assert.match(profileMenu, /LogoutButton/);
    assert.match(profileMenu, /sm:hidden[\s\S]{0,200}Array\.from\(nickname\.trim\(\)\)\[0\]/);
  });

  it("marks the active destination with aria-current in header, rail and bottom nav", () => {
    for (const source of [mainNav, bottomNav]) {
      assert.match(source, /aria-current=\{active \? "page" : undefined\}/);
    }
    const rail = read("src/components/SidebarShell.tsx");
    assert.equal((rail.match(/aria-current=\{active \? "page" : undefined\}/g) ?? []).length, 2);
  });

  it("keeps header chrome text at 11px or larger and notification counts capped at 99+", () => {
    const controls = read("src/components/UserPreferenceControls.tsx");
    const profileMenuToggle = controls.slice(controls.indexOf("function ProfileMenuSafetyRow"));
    assert.doesNotMatch(profileMenuToggle, /text-\[(?:9|10)px\]/);
    for (const file of [
      "src/components/NotificationBell.tsx",
      "src/components/AnimatedPointsBadge.tsx",
      "src/components/HeaderProfileMenu.tsx",
    ]) {
      assert.doesNotMatch(read(file), /text-\[(?:9|10)px\]/, file);
    }
    assert.match(read("src/components/NotificationBell.tsx"), /visibleCount > 99 \? "99\+" : visibleCount/);
  });

  it("keeps the points tooltip inside the viewport by anchoring it to the chip's right edge", () => {
    const tooltip = read("src/components/PointsBalanceTooltip.tsx");
    assert.match(tooltip, /align === "end" \? "right-0"/);
    assert.match(tooltip, /max-w-\[calc\(100vw-1\.5rem\)\]/);
    assert.match(read("src/components/AnimatedPointsBadge.tsx"), /align="end"/);
  });

  it("keeps the profile-menu safety filter a single labelled 44px row with explicit ON/OFF state", () => {
    const controls = read("src/components/UserPreferenceControls.tsx");
    const toggle = controls.slice(controls.indexOf("function ProfileMenuSafetyRow"));
    assert.equal((toggle.match(/<button/g) ?? []).length, 1);
    assert.match(toggle, /role="menuitemcheckbox"/);
    assert.match(toggle, /aria-checked=\{safetyFilterOn\}/);
    assert.match(toggle, /세이프티 필터 \$\{stateLabel\}/);
    assert.match(toggle, /min-h-11/);
    assert.match(toggle, /safetyFilterOn \? "ON" : "OFF"/);
    assert.match(toggle, /disabled=\{busy \|\| !canDisable\}/);
    assert.doesNotMatch(read("src/components/Header.tsx"), /variant="header"/);
  });

  it("keeps header action hit areas at least 36px", () => {
    assert.match(read("src/components/AnimatedPointsBadge.tsx"), /min-h-9/);
    assert.match(read("src/components/PointsShopLink.tsx"), /h-9 w-9/);
    assert.match(read("src/components/HeaderProfileMenu.tsx"), /inline-flex h-9/);
    assert.match(header, /min-h-9 items-center[^"]*sm:inline-flex/);
  });
});
