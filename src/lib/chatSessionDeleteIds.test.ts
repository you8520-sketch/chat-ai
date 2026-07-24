import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CHAT_SESSION_DELETE_COUNT,
  parseChatSessionDeleteIds,
} from "./chatSessionDeleteIds";

describe("parseChatSessionDeleteIds", () => {
  it("keeps the legacy single-chat payload compatible", () => {
    assert.deepEqual(parseChatSessionDeleteIds({ chatId: "12" }), {
      ok: true,
      scope: "chats",
      ids: [12],
    });
  });

  it("normalizes and deduplicates bulk ids", () => {
    assert.deepEqual(parseChatSessionDeleteIds({ chatIds: [3, "2", 3, 1] }), {
      ok: true,
      scope: "chats",
      ids: [3, 2, 1],
    });
  });

  it("recognizes deletion of every chat for selected characters", () => {
    assert.deepEqual(parseChatSessionDeleteIds({ characterIds: [7, "8", 7] }), {
      ok: true,
      scope: "characters",
      ids: [7, 8],
    });
  });

  it("rejects empty or invalid selections", () => {
    assert.equal(parseChatSessionDeleteIds({ chatIds: [] }).ok, false);
    assert.equal(parseChatSessionDeleteIds({ chatIds: [1, 0] }).ok, false);
    assert.equal(parseChatSessionDeleteIds({ chatIds: [1, "nope"] }).ok, false);
  });

  it("limits the size of a bulk request", () => {
    const tooMany = Array.from(
      { length: MAX_CHAT_SESSION_DELETE_COUNT + 1 },
      (_, index) => index + 1
    );
    assert.equal(parseChatSessionDeleteIds({ chatIds: tooMany }).ok, false);
  });
});
