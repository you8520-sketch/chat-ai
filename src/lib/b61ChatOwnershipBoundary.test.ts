import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * B61 ownership boundary guard: the next-turn memory wait must happen only
 * after the ownership-scoped chat SELECT, and the memory row must be re-read
 * after the wait.
 */
describe("B61 chat ownership boundary", () => {
  it("waits after the ownership SELECT and re-reads the chat row after the wait", () => {
    const source = readFileSync("src/app/api/chat/route.ts", "utf8");
    const ownershipSelect = source.indexOf("FROM chats WHERE id=? AND user_id=?");
    const wait = source.indexOf("waitForOwnedChatMemory(chat");
    const reload = source.indexOf("FROM chats WHERE id=? AND user_id=?", wait);

    assert.ok(ownershipSelect >= 0, "ownership SELECT must exist");
    assert.ok(wait > ownershipSelect, "memory wait must follow the ownership SELECT");
    assert.ok(reload > wait, "chat row must be re-read after the memory wait");
  });
});
