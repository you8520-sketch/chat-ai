import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("content controls and navigation regression", () => {
  it("keeps adult verification separate from the visibility preference", () => {
    const verifyRoute = read("src/app/api/verify/route.ts");
    assert.doesNotMatch(verifyRoute, /SET is_adult\s*=\s*1,\s*nsfw_on\s*=\s*1/);

    const controls = read("src/components/UserPreferenceControls.tsx");
    assert.match(controls, /성인 캐릭터 표시/);
    assert.doesNotMatch(controls, />19\+</);
  });

  it("keeps chat-room navigation tools without a duplicate notification button", () => {
    const chatClient = read("src/app/chat/[id]/ChatClient.tsx");
    assert.doesNotMatch(chatClient, /NotificationBell/);
    assert.doesNotMatch(chatClient, /AdultHandoffModelNotice/);
    assert.doesNotMatch(chatClient, /성인 장면 자동 호환 지원/);
    assert.match(chatClient, /<ChatRoomAdultModeToggle/);
    assert.match(chatClient, /<ChatRoomMobileMenu/);
    assert.match(chatClient, /settingsPanel=\{renderSettingsPanel\("rail"\)\}/);
    assert.match(chatClient, /bookmarksPanel=\{<BookmarksPanel variant="rail" \/>}/);
    assert.match(chatClient, /setAssetAlbumOpen\(true\)/);
    assert.match(chatClient, /aria-label="뒤로가기"/);
  });

  it("keeps notifications in the desktop header but removes the mobile bottom item", () => {
    const header = read("src/components/Header.tsx");
    const mobileNav = read("src/components/MobileBottomNav.tsx");
    assert.match(header, /<NotificationBell count=\{unreadCount\} \/>/);
    assert.doesNotMatch(mobileNav, /\/notifications/);
    assert.doesNotMatch(mobileNav, /unreadCount/);
  });

  it("shows public discovery tabs in the mobile home content", () => {
    const home = read("src/app/page.tsx");
    const desktopNav = read("src/components/HeaderMainNavRow.tsx");
    assert.match(home, /MOBILE_DISCOVERY_TABS/);
    assert.match(home, /\{ href: "\/tab\/new", label: "신작랭킹" \}/);
    assert.match(home, /\{ href: "\/tab\/ranking", label: "랭킹" \}/);
    assert.match(home, /\{ href: "\/trpg", label: "TRPG" \}/);
    assert.match(home, /\{ href: "\/search", label: "검색" \}/);
    assert.match(home, /variant="homeBanner"/);
    assert.match(home, />\s*취향 설정\s*<\/Link>/);
    assert.match(desktopNav, /\{ href: "\/trpg", label: "TRPG" \}/);
    assert.doesNotMatch(desktopNav, /showTrpg/);
  });

  it("does not reopen the home notice during an in-place preference refresh", () => {
    const popup = read("src/components/HomePopupNotice.tsx");
    assert.match(popup, /handledForThisHomeVisitRef = useRef\(false\)/);
    assert.match(popup, /if \(handledForThisHomeVisitRef\.current\) return/);
    assert.match(popup, /handledForThisHomeVisitRef\.current = true/);
  });

  it("shows the saved taste filter on ranking and applies it to the ranking query", () => {
    const rankingPage = read("src/app/tab/[tab]/page.tsx");
    assert.match(rankingPage, /tab === "ranking"[\s\S]*<UserPreferenceControls/);
    assert.match(rankingPage, /pref=\{\(user\?\.pref as "female" \| "male" \| null\) \?\? null\}/);
    assert.match(rankingPage, /variant="homeRow"/);
    assert.match(rankingPage, /buildFilter\("c\."\)/);
  });
});
