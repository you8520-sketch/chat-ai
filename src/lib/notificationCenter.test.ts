import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { ADMIN_MANAGED_BOARDS, BOARD_CONFIG } from "./boardConfig";
import { DEFAULT_BOARD_POSTS } from "./boardPosts";
import { notificationHref, type UserNotificationRow } from "./userNotifications";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("notification center cleanup", () => {
  it("removes inquiry and faq from board config and default seeds", () => {
    assert.deepEqual(Object.keys(BOARD_CONFIG), ["notice"]);
    assert.deepEqual([...ADMIN_MANAGED_BOARDS], ["notice"]);
    assert.equal(DEFAULT_BOARD_POSTS.some((post) => post.board === "faq"), false);
    assert.equal(DEFAULT_BOARD_POSTS.some((post) => post.board === "inquiry"), false);
  });

  it("removes customer support and inquiry admin surfaces", () => {
    assert.equal(fs.existsSync("src/components/HeaderBoardLinks.tsx"), false);
    assert.equal(fs.existsSync("src/app/admin/inquiries/page.tsx"), false);
    assert.equal(fs.existsSync("src/app/api/admin/inquiries/route.ts"), false);
    const settings = read("src/app/settings/SettingsClient.tsx");
    assert.doesNotMatch(settings, /고객지원/);
    assert.doesNotMatch(settings, /\/board\/inquiry/);
    assert.doesNotMatch(settings, /\/board\/faq/);
    assert.doesNotMatch(settings, /\/admin\/inquiries/);
  });

  it("keeps bell as popover trigger instead of navigating immediately", () => {
    const bell = read("src/components/NotificationBell.tsx");
    const panel = read("src/components/NotificationCenterPanel.tsx");
    assert.doesNotMatch(bell, /href="\/notifications"/);
    assert.match(bell, /NotificationCenterPanel/);
    assert.match(bell, /fetchNotificationFeed/);
    assert.match(panel, /role="dialog"/);
    assert.match(panel, /공지사항/);
    assert.match(panel, /상세보기/);
    assert.doesNotMatch(panel, /setInterval/);
    assert.doesNotMatch(panel, /fetch\("\/api\/notifications"/);
  });

  it("routes notice notifications to notice detail pages", () => {
    assert.equal(
      notificationHref({ type: "notice", ref_id: 42 } as UserNotificationRow),
      "/notices/42"
    );
    assert.equal(
      notificationHref({ type: "inquiry_reply", ref_id: 9 } as UserNotificationRow),
      "/notifications"
    );
  });

  it("does not expose live inquiry/faq links in header or notifications page", () => {
    const header = read("src/components/Header.tsx");
    const notificationsPage = read("src/app/notifications/page.tsx");
    assert.doesNotMatch(header, /HeaderBoardLinks/);
    assert.doesNotMatch(header, /\/board\/inquiry/);
    assert.doesNotMatch(header, /\/board\/faq/);
    assert.doesNotMatch(notificationsPage, /\/board\/notice/);
    assert.match(notificationsPage, /\/notices\//);
  });
});
