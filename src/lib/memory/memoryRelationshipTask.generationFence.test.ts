import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { scheduleMemoryUpdate } from "@/lib/memory/memory-manager";
import {
  loadChatRelationshipMeta,
  mergeRelationshipMetaAfterRegenerate,
  mergeRelationshipMetaFromTurn,
} from "@/lib/memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import { loadMessageMemoryRelationshipTask } from "@/lib/memory/memoryRelationshipTask";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import {
  resolveActiveAssistantGenerationScope,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";

const CHAT_ID = 882001;
const USER_ID = 882002;
const CHAR_ID = 882003;
const ASSISTANT_MSG_ID = 882010;
const USER_MSG_ID = 882009;

const NAMES = { charName: "TestChar", userName: "Tester" };

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedCompletedAssistant() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `fence-${USER_ID}@test.local`,
    "fence",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')`).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant)
     VALUES (?, ?, 'user', 'hello', NULL, 'completed', '[]', 0)`
  ).run(USER_MSG_ID, CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
     VALUES (?, ?, 'assistant', 'old reply', ?, 'completed', '[]', 0, 'm')`
  ).run(ASSISTANT_MSG_ID, CHAT_ID, USER_MSG_ID);
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function genScope(sequence: number, requestId: string | null = null): AssistantGenerationScope {
  return {
    assistantMessageId: ASSISTANT_MSG_ID,
    generationSequence: sequence,
    generationRequestId: requestId,
  };
}

function startRegen(requestId = "regen-req-fence") {
  return bootstrapStreamingTurn(getDb(), {
    chatId: CHAT_ID,
    requestId,
    userContent: "hello",
    skipUserInsert: true,
    existingUserMessageId: USER_MSG_ID,
    regenerateAssistantId: ASSISTANT_MSG_ID,
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("memory relationship generation fence", () => {
  let prevMemoryFeature: string | undefined;

  beforeEach(() => {
    seedCompletedAssistant();
    prevMemoryFeature = process.env.MEMORY_FEATURE_ENABLED;
    process.env.MEMORY_FEATURE_ENABLED = "1";
  });

  afterEach(() => {
    if (prevMemoryFeature === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
    else process.env.MEMORY_FEATURE_ENABLED = prevMemoryFeature;
    cleanup();
  });

  it("MR1 — old gen0 nonempty delta cannot mutate current projection or gen1 pending marker", async () => {
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    const gen0Task = mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      assistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: genScope(0),
      __testExtract: async () => {
        await gen0Gate;
        return { delta: { items: ["STALE_GEN0_ITEM"] }, parseOk: true };
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID)?.state, "pending");
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID)?.generationSequence, 0);

    startRegen();

    let releaseGen1!: () => void;
    const gen1Gate = new Promise<void>((resolve) => {
      releaseGen1 = resolve;
    });
    void mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      newAssistantMessage: "new reply",
      previousAssistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: genScope(1, "regen-req-fence"),
      __testExtract: async () => {
        await gen1Gate;
        return { delta: {}, parseOk: true };
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    const gen1Marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(gen1Marker?.state, "pending");
    assert.equal(gen1Marker?.generationSequence, 1);

    releaseGen0();
    await gen0Task;

    const meta = loadChatRelationshipMeta(CHAT_ID, NAMES);
    assert.ok(!meta.items.includes("STALE_GEN0_ITEM"));
    const after = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(after?.state, "pending");
    assert.equal(after?.generationSequence, 1);

    releaseGen1();
  });

  it("MR2 — gen1 delta commits after stale gen0 rejection", async () => {
    startRegen();
    const activeScope = resolveActiveAssistantGenerationScope(ASSISTANT_MSG_ID);
    assert.ok(activeScope);

    await mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      newAssistantMessage: "new reply",
      previousAssistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: activeScope,
      __testExtract: async () => ({
        delta: { items: ["Tester: CURRENT_GEN1_ITEM"] },
        parseOk: true,
      }),
    });

    const meta = loadChatRelationshipMeta(CHAT_ID, NAMES);
    assert.ok(meta.items.some((item) => item.includes("CURRENT_GEN1_ITEM")));
    assert.ok(!meta.items.includes("STALE_GEN0_ITEM"));
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "succeeded");
    assert.equal(marker?.generationSequence, 1);
  });

  it("MR3 — old gen0 parse failure cannot close gen1 pending marker", async () => {
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    void mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      assistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: genScope(0),
      __testExtract: async () => {
        await gen0Gate;
        return { delta: {}, parseOk: false };
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    startRegen();

    void mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      newAssistantMessage: "new reply",
      previousAssistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: genScope(1, "regen-req-fence"),
      __testExtract: async () => new Promise(() => {}),
    });

    await new Promise((r) => setTimeout(r, 20));
    releaseGen0();
    await new Promise((r) => setTimeout(r, 20));

    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "pending");
    assert.equal(marker?.generationSequence, 1);
  });

  it("MR4 — late gen0 skip cannot overwrite gen1 marker", async () => {
    startRegen();

    void scheduleMemoryUpdate({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      relationshipNames: NAMES,
      tier: "free",
      memoryCapacity: 4000,
      userMessage: "hello",
      assistantMessage: "new reply",
      assistantMessageId: ASSISTANT_MSG_ID,
      sourceUserMessageId: USER_MSG_ID,
      isRegenerate: true,
      previousAssistantMessage: "old reply",
      route: "safe",
      generationScope: genScope(1, "regen-req-fence"),
    });

    await new Promise((r) => setTimeout(r, 30));

    await scheduleMemoryUpdate({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      relationshipNames: NAMES,
      tier: "free",
      memoryCapacity: 4000,
      userMessage: "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.",
      assistantMessage: "old reply",
      assistantMessageId: ASSISTANT_MSG_ID,
      sourceUserMessageId: USER_MSG_ID,
      route: "safe",
      generationScope: genScope(0),
    });

    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.notEqual(marker?.state, "skipped");
    assert.equal(marker?.generationSequence, 1);
  });

  it("MR5 — delayed gen0 main-tail delta cannot commit on gen1 current", async () => {
    startRegen();

    let releaseTail!: () => void;
    const tailGate = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });

    void (async () => {
      await tailGate;
      await mergeRelationshipMetaFromTurn({
        chatId: CHAT_ID,
        names: NAMES,
        userMessage: "hello",
        assistantMessage: "old reply",
        route: "safe",
        sourceUserMessageId: USER_MSG_ID,
        boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
        assistantMessageId: ASSISTANT_MSG_ID,
        generationScope: genScope(0),
        mainModelTailParsed: true,
        mainModelDelta: { items: ["STALE_MAIN_TAIL_ITEM"] },
      });
    })();

    void mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "hello",
      newAssistantMessage: "new reply",
      previousAssistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: genScope(1, "regen-req-fence"),
      __testExtract: async () => new Promise(() => {}),
    });

    await new Promise((r) => setTimeout(r, 20));
    releaseTail();
    await new Promise((r) => setTimeout(r, 20));

    const meta = loadChatRelationshipMeta(CHAT_ID, NAMES);
    assert.ok(!meta.items.includes("STALE_MAIN_TAIL_ITEM"));
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "pending");
    assert.equal(marker?.generationSequence, 1);
  });
});
