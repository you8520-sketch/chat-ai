import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseAdultHandoffEnabled,
  resolveChatAdultHandoffEnabled,
} from "./chatAdultHandoff";

describe("chat-room adult mode (handoff) preference", () => {
  it("parses boolean, 0/1, and string flags", () => {
    assert.equal(parseAdultHandoffEnabled(true), true);
    assert.equal(parseAdultHandoffEnabled(false), false);
    assert.equal(parseAdultHandoffEnabled(1), true);
    assert.equal(parseAdultHandoffEnabled(0), false);
    assert.equal(parseAdultHandoffEnabled("true"), true);
    assert.equal(parseAdultHandoffEnabled("false"), false);
    assert.equal(parseAdultHandoffEnabled(undefined), undefined);
    assert.equal(parseAdultHandoffEnabled(null), undefined);
  });

  it("lets the current request override the persisted chat flag", () => {
    assert.equal(
      resolveChatAdultHandoffEnabled({ persisted: 1, requested: false }),
      false
    );
    assert.equal(
      resolveChatAdultHandoffEnabled({ persisted: 0, requested: true }),
      true
    );
    assert.equal(
      resolveChatAdultHandoffEnabled({ persisted: 1, requested: undefined }),
      true
    );
    assert.equal(
      resolveChatAdultHandoffEnabled({ persisted: 0 }),
      false
    );
  });

  it("never enables handoff for an unverified user", () => {
    assert.equal(
      resolveChatAdultHandoffEnabled({
        persisted: 1,
        requested: true,
        userAdultVerified: false,
      }),
      false
    );
  });

  it("keeps listing nsfw_on off the chat-route handoff gate", () => {
    const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /adultContentVisibilityEnabled = !!user\.nsfw_on/);
    assert.match(route, /chatAdultHandoffEnabled/);
    assert.match(route, /characterAdultContentEnabled: ch\.nsfw === 1/);

    const settings = readFileSync(
      new URL("../app/api/chat/settings/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(settings, /adultHandoffEnabled/);
    assert.match(settings, /adult_handoff_enabled/);

    const chatClient = readFileSync(
      new URL("../app/chat/[id]/ChatClient.tsx", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(chatClient, /AdultHandoffModelNotice/);
    assert.doesNotMatch(chatClient, /성인 장면 자동 호환 지원/);
    assert.match(chatClient, /ChatRoomAdultModeToggle/);
    assert.match(chatClient, /adultHandoffEnabled/);

    const headerControls = readFileSync(
      new URL("../components/UserPreferenceControls.tsx", import.meta.url),
      "utf8"
    );
    assert.match(headerControls, /성인 캐릭터 표시/);
    assert.doesNotMatch(headerControls, /성인모드/);
  });
});
