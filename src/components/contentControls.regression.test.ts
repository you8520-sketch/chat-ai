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

  it("keeps all chat-room navigation tools alongside notifications", () => {
    const chatClient = read("src/app/chat/[id]/ChatClient.tsx");
    assert.match(chatClient, /<NotificationBell/);
    assert.match(chatClient, /<ChatRoomMobileMenu/);
    assert.match(chatClient, /settingsPanel=\{renderSettingsPanel\("rail"\)\}/);
    assert.match(chatClient, /bookmarksPanel=\{<BookmarksPanel variant="rail" \/>}/);
    assert.match(chatClient, /setAssetAlbumOpen\(true\)/);
    assert.match(chatClient, /aria-label="뒤로가기"/);
  });

  it("keeps an explicit notification destination in desktop and mobile navigation", () => {
    const header = read("src/components/Header.tsx");
    const mobileNav = read("src/components/MobileBottomNav.tsx");
    assert.match(header, /<NotificationBell count=\{unreadCount\} \/>/);
    assert.match(mobileNav, /href: "\/notifications", label: "알림"/);
    assert.match(mobileNav, /badge: unreadCount/);
  });
});
