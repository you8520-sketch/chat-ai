import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  invalidateModelPickerInputSnapshot,
  MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES,
  modelPickerSnapshotCacheSize,
  rememberModelPickerInputSnapshot,
} from "@/services/modelPickerInputSnapshot";

const SNAPSHOT_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/services/modelPickerInputSnapshot.ts"),
  "utf8"
);

describe("modelPickerInputSnapshot read-only audit", () => {
  it("uses preview-only memory and chunk loaders (no chat mutation path)", () => {
    assert.match(SNAPSHOT_SOURCE, /buildMemoryContextForPreview/);
    assert.match(SNAPSHOT_SOURCE, /loadCharacterChunksForPromptReadOnly/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /buildMemoryContextForChat/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /loadCharacterChunksForPrompt\(/);
  });

  it("does not pass chatId into resolveChatSelectedPersona (no persona fallback write)", () => {
    const personaCall = SNAPSHOT_SOURCE.match(
      /resolveChatSelectedPersona\(([\s\S]*?)\);/
    )?.[1];
    assert.ok(personaCall);
    assert.doesNotMatch(personaCall!, /chat\.id/);
  });

  it("does not schedule background jobs or OpenRouter calls in snapshot path", () => {
    assert.doesNotMatch(SNAPSHOT_SOURCE, /scheduleBackgroundLorebookMaintenance/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /scheduleEnglishBackfill/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /callOpenRouter/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /updateChatMemory/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /getOrCreateChatMemory/);
  });
});

describe("modelPickerInputSnapshot cache bound", () => {
  it("stores per-chat latest only and evicts oldest entries", () => {
    for (let chatId = 1; chatId <= MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES + 5; chatId += 1) {
      rememberModelPickerInputSnapshot(chatId, {
        tokens: 1000 + chatId,
        messageCount: 1,
        personaId: null,
        userNote: "",
        targetResponseChars: 2000,
      });
    }

    assert.equal(modelPickerSnapshotCacheSize(), MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES);
    assert.equal(modelPickerSnapshotCacheSize() <= MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES, true);

    invalidateModelPickerInputSnapshot(MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES + 5);
    assert.equal(modelPickerSnapshotCacheSize(), MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES - 1);
  });
});
