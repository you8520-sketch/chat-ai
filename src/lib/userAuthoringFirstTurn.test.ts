import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function source(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("first-turn user authoring transport", () => {
  it("sends the optimistic pre-chat level with the first normal message", () => {
    const client = source("src/app/chat/[id]/ChatClient.tsx");
    const normalSend = client.slice(
      client.indexOf("message: text,"),
      client.indexOf("handlePostStreamResult", client.indexOf("message: text,"))
    );
    assert.match(normalSend, /userAuthoringLevel/);
  });

  it("validates the level only at new-chat creation and passes it to the canonical session owner", () => {
    const route = source("src/app/api/chat/route.ts");
    const newChatStart = route.indexOf("const requestedInitialAuthoringRaw = body.userAuthoringLevel");
    const createCall = route.indexOf("userAuthoringLevel: initialUserAuthoringLevel", newChatStart);
    assert.ok(newChatStart > 0);
    assert.ok(createCall > newChatStart);
    assert.match(
      route.slice(newChatStart, createCall + 80),
      /userAuthoringLevel must be LIMITED, NORMAL, or ALLOW/
    );
  });

  it("persists the validated level in the chat INSERT instead of relying on the DB default", () => {
    const session = source("src/lib/chatSessionCreate.ts");
    assert.match(session, /adult_handoff_enabled, user_authoring_level/);
    assert.match(
      session,
      /parseUserAuthoringLevel\(input\.userAuthoringLevel \?\? DEFAULT_USER_AUTHORING_LEVEL\)/
    );
  });
});
