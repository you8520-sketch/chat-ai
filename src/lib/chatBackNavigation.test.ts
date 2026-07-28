import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_BACK_FALLBACK_GUARD_MS,
  chatBackFallbackHref,
  shouldRunChatBackFallback,
  shouldSkipHistoryBack,
} from "@/lib/chatBackNavigation";

describe("chat back navigation fallback", () => {
  it("points the fallback at the character detail page", () => {
    assert.equal(chatBackFallbackHref(42), "/character/42");
  });

  it("skips history.back() when the chat is the only entry", () => {
    assert.equal(shouldSkipHistoryBack(1), true);
    assert.equal(shouldSkipHistoryBack(0), true);
    assert.equal(shouldSkipHistoryBack(Number.NaN), true);
  });

  it("keeps history.back() when the user navigated in from the app", () => {
    assert.equal(shouldSkipHistoryBack(2), false);
    assert.equal(shouldSkipHistoryBack(9), false);
  });

  it("runs the fallback when back() left the URL untouched", () => {
    assert.equal(shouldRunChatBackFallback({ elapsedMs: 350, urlChanged: false }), true);
  });

  it("does not run the fallback once back() changed the URL", () => {
    assert.equal(shouldRunChatBackFallback({ elapsedMs: 350, urlChanged: true }), false);
  });

  it("does not run the fallback after a bfcache freeze delayed the timer", () => {
    assert.equal(
      shouldRunChatBackFallback({
        elapsedMs: CHAT_BACK_FALLBACK_GUARD_MS + 1,
        urlChanged: false,
      }),
      false
    );
  });
});
