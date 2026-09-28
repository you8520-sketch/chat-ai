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
    assert.match(normalSend, /autoProgressionAuthoringLevel/);
  });

  it("validates the level only at new-chat creation and passes it to the canonical session owner", () => {
    const route = source("src/app/api/chat/route.ts");
    const newChatStart = route.indexOf("const requestedInitialAuthoringRaw = body.userAuthoringLevel");
    const createCall = route.indexOf("userAuthoringLevel: initialUserAuthoringLevel", newChatStart);
    const autoCreateCall = route.indexOf(
      "autoProgressionAuthoringLevel: initialAutoProgressionAuthoringLevel",
      newChatStart
    );
    assert.ok(newChatStart > 0);
    assert.ok(createCall > newChatStart);
    assert.ok(autoCreateCall > createCall);
    assert.match(
      route.slice(newChatStart, createCall + 80),
      /userAuthoringLevel must be LIMITED, NORMAL, or ALLOW/
    );
    assert.match(
      route.slice(newChatStart, autoCreateCall + 100),
      /autoProgressionAuthoringLevel must be LIMITED, NORMAL, or ALLOW/
    );
  });

  it("persists the validated level in the chat INSERT instead of relying on the DB default", () => {
    const session = source("src/lib/chatSessionCreate.ts");
    assert.match(
      session,
      /adult_handoff_enabled, user_authoring_level, auto_progression_authoring_level/
    );
    assert.match(
      session,
      /parseUserAuthoringLevel\(input\.userAuthoringLevel \?\? DEFAULT_USER_AUTHORING_LEVEL\)/
    );
    assert.match(
      session,
      /input\.autoProgressionAuthoringLevel[\s\S]*DEFAULT_AUTO_PROGRESSION_USER_AUTHORING_LEVEL/
    );
  });

  it("exposes independent three-level controls for ordinary input and auto progression", () => {
    const settings = source("src/components/ChatSettingsPanel.tsx");
    const client = source("src/app/chat/[id]/ChatClient.tsx");
    assert.match(settings, /일반 입력 시 내 행동\/대사 서술/);
    assert.match(settings, /자동진행 시 내 행동\/대사 서술/);
    assert.match(settings, /autoProgressionAuthoringLevel/);
    assert.match(client, /자동진행 · \{autoProgressionAuthoringLevel/);
  });

  it("routes ordinary and auto turns to different base scopes", () => {
    const route = source("src/app/api/chat/route.ts");
    assert.match(
      route,
      /scope:\s*autoProgressionEnabled \? "auto_progression" : "interactive"/
    );
    assert.match(
      route,
      /scope:\s*autoContinueContext \? "auto_progression" : "interactive"/
    );
  });

  it("injects persona speech style only when the effective owner allows B dialogue", () => {
    const route = source("src/app/api/chat/route.ts");
    assert.match(
      route,
      /coNarrationEnabled:\s*currentTurnDelegation\.allowDialogue === true/
    );
    assert.match(
      route,
      /coNarrationEnabled:\s*currentTurnDelegationForTurn\.allowDialogue === true/
    );
    assert.doesNotMatch(
      route,
      /coNarrationEnabled:\s*autoProgressionEnabled\s*\|\|\s*novelModeEnabled\s*\|\|\s*currentTurnDelegation\.active/
    );
    assert.doesNotMatch(
      route,
      /coNarrationEnabled:\s*autoContinueContext\s*\|\|\s*novelModeEnabled\s*\|\|\s*currentTurnDelegationForTurn\.active/
    );
  });
});
