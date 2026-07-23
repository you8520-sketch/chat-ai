import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("room narrative POV persistence regression", () => {
  it("does not discard the first room-setting change after mount", () => {
    const client = read("src/app/chat/[id]/ChatClient.tsx");
    assert.doesNotMatch(client, /settingsSkipAutoSaveRef/);
    assert.match(client, /lastPersistedRoomSettingsRef/);
    assert.match(client, /void persistChatSettings\(requested\)/);
    assert.match(client, /setSettingsPersistRevision\(\(revision\) => revision \+ 1\)/);
  });

  it("flushes a pending POV save before every generation entry point", () => {
    const client = read("src/app/chat/[id]/ChatClient.tsx");
    const flushCalls = client.match(/await flushChatSettings\(\)/g) ?? [];
    assert.equal(flushCalls.length, 3);
  });

  it("hides POV selection for simulations and leaves no cast selector", () => {
    const panel = read("src/components/ChatSettingsPanel.tsx");
    assert.match(panel, /contentKind === "character" && \(/);
    assert.doesNotMatch(panel, /시점 캐릭터/);
    assert.doesNotMatch(panel, /povCharacterSuggestions/);
  });
});
