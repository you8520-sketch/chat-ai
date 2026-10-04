import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import {
  invalidateModelPickerInputSnapshot,
  MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES,
  modelPickerSnapshotCacheSize,
  rememberModelPickerInputSnapshot,
} from "@/services/modelPickerInputSnapshot";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

const SNAPSHOT_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/services/modelPickerInputSnapshot.ts"),
  "utf8"
);
const PREP_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/services/nextTurnAssemblyPreparation.ts"),
  "utf8"
);

describe("modelPickerInputSnapshot read-only audit", () => {
  it("uses the shared persisted next-turn owner instead of a parallel assembly", () => {
    assert.match(SNAPSHOT_SOURCE, /loadPersistedNextTurnSource/);
    assert.match(SNAPSHOT_SOURCE, /assemblePersistedNextTurnInputs/);
    assert.match(SNAPSHOT_SOURCE, /fingerprintPersistedNextTurnSource/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /shortTermHistory: recentHistoryFull/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /sharedContextModelId/);
  });

  it("uses preview-only memory and chunk loaders (no chat mutation path)", () => {
    assert.match(PREP_SOURCE, /buildMemoryContextForPreview/);
    assert.match(PREP_SOURCE, /loadCharacterChunksForPromptReadOnly/);
    assert.doesNotMatch(PREP_SOURCE, /buildMemoryContextForChat/);
    assert.doesNotMatch(PREP_SOURCE, /loadCharacterChunksForPrompt\(/);
    assert.match(PREP_SOURCE, /persistActiveMatches: false/);
  });

  it("reuses persisted consent/canon/persona owners instead of a parallel snapshot copy", () => {
    assert.match(PREP_SOURCE, /resolveEffectiveConsentMode/);
    assert.match(PREP_SOURCE, /parseCanonPlanV1/);
    assert.match(PREP_SOURCE, /resolveCanonInjectionPolicy/);
    assert.match(PREP_SOURCE, /buildPersonaKnowledgePromptBlock/);
    assert.match(PREP_SOURCE, /buildRevealedPersonaFactsBlockForPersona/);
    assert.doesNotMatch(PREP_SOURCE, /ensureCanonPlanOnAccess/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /buildPersonaKnowledgePromptBlock/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /getPersonaSecretPayload/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /resolveCanonInjectionPolicy/);
  });

  it("does not pass chatId into resolveChatSelectedPersona (no persona fallback write)", () => {
    const personaCall = PREP_SOURCE.match(
      /resolveChatSelectedPersona\(([\s\S]*?)\);/
    )?.[1];
    assert.ok(personaCall);
    assert.doesNotMatch(personaCall!, /chat\.id/);
  });

  it("does not schedule background jobs or OpenRouter calls in snapshot path", () => {
    for (const source of [SNAPSHOT_SOURCE, PREP_SOURCE]) {
      assert.doesNotMatch(source, /scheduleBackgroundLorebookMaintenance/);
      assert.doesNotMatch(source, /scheduleEnglishBackfill/);
      assert.doesNotMatch(source, /callOpenRouter/);
      assert.doesNotMatch(source, /updateChatMemory/);
      assert.doesNotMatch(source, /getOrCreateChatMemory/);
      assert.doesNotMatch(source, /acquireMainRpGenerationLease/);
      assert.doesNotMatch(source, /recordMainGenerationProviderCost/);
    }
  });

  it("assembles a separate prompt-token snapshot for every active picker model", () => {
    assert.match(SNAPSHOT_SOURCE, /MODEL_PICKER_ACTIVE_MODEL_IDS/);
    assert.match(SNAPSHOT_SOURCE, /tokensByModel\[modelId\]/);
    assert.match(PREP_SOURCE, /prepareNextTurnHistory/);
  });

  it("does not expose a client-controlled refresh cache bypass", () => {
    assert.doesNotMatch(SNAPSHOT_SOURCE, /refresh\?:/);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /opts\.refresh/);
  });
});

describe("modelPickerInputSnapshot cache bound", () => {
  it("stores per-chat latest only and evicts oldest entries", () => {
    for (let chatId = 1; chatId <= MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES + 5; chatId += 1) {
      rememberModelPickerInputSnapshot(chatId, {
        tokensByModel: {
          [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: 1000 + chatId,
        },
        sourceFingerprint: `fp-${chatId}`,
      });
    }

    assert.equal(modelPickerSnapshotCacheSize(), MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES);
    assert.equal(modelPickerSnapshotCacheSize() <= MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES, true);

    invalidateModelPickerInputSnapshot(MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES + 5);
    assert.equal(modelPickerSnapshotCacheSize(), MODEL_PICKER_SNAPSHOT_CACHE_MAX_ENTRIES - 1);
  });
});
