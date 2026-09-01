/**
 * Source message edit + repair-job ordering proofs (PR #809 correction 2).
 */
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
import { isMaterialProseEdit } from "@/lib/canonicalProse";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  executeAtomicManualEditCore,
  executeAtomicManualEditMutationCore,
} from "@/lib/rpDerivedStateLifecycle";
import { buildMemoryContext } from "./memory-injector";
import { getOrCreateChatMemory } from "./memory-db";
import {
  reconcileMemoryAfterRecordDelete,
  reconcileMemoryAfterSourceMessageEditSyncCore,
  scheduleMemoryResealAfterSourceMessageEdit,
} from "./memory-reconcile";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  getMemorySourceBoundaryCore,
  invalidateDerivedMemoryGenerationCore,
} from "./memory-source-boundary";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import {
  MemoryCanonicalityEditNotSupportedError,
  memorySourceEligibilityChanged,
  resolveMemorySourceTurnIdentityCore,
} from "./memory-turn-loader";

const CHAT = 960001;
const USER = 960002;
const CHAR = 960003;
const OLD_FACT = "OLD_FACT_XYZ";
const NEW_FACT = "NEW_FACT_ABC";
const SECRET_OLD = "SECRET_OLD_QWE";
const SECRET_NEW = "SECRET_NEW_RTY";

const ASSISTANT_ONLY_OLD = "ASSISTANT_ONLY_OLD";
const ASSISTANT_ONLY_NEW = "ASSISTANT_ONLY_NEW";
const EARLY_BATCH_MARKER = "EARLY_BATCH_INTACT";
const OOC_ISOLATED_RENDER =
  "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedOpening() {
  getDb()
    .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
    .run(CHAT, "assistant", "opening", "greeting");
}

function seedPlayableTurns(count: number, userPrefix = "user turn", assistantPrefix = "assistant") {
  for (let t = 1; t <= count; t++) {
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "user", `${userPrefix} ${t} ${t === 1 ? SECRET_OLD : ""}`.trim(), "user");
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "assistant", `${assistantPrefix} ${t} ${OLD_FACT}`, "test");
  }
}

function seedBase(turnCount: number) {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `edit-${USER}@test.local`,
    "edit",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EditChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_capacity) VALUES (?,?,?,'safe',?)`).run(
    CHAT,
    USER,
    CHAR,
    10_000
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  seedOpening();
  seedPlayableTurns(turnCount);
}

const VALID_SUMMARY =
  `${OLD_FACT} `.repeat(6) +
  "장면 요약: 초기 배치 기록. 사실만 압축하고 반복 묘사는 생략한다.";

const ADOPTED_USAGE = JSON.stringify({
  generationKind: "ooc_scene_render",
  canonical: false,
  canonAdopted: true,
  canonAdoptedAt: "2026-08-17T00:00:00.000Z",
});

function messageContent(messageId: number): string {
  return (
    getDb()
      .prepare(`SELECT content FROM messages WHERE id=?`)
      .get(messageId) as { content: string }
  ).content;
}

function runAtomicAssistantMaterialEdit(opts: {
  assistantId: number;
  newProse: string;
  memoryTurnNumber: number;
  sourceUserMessageId: number | null;
  sourceAssistantMessageId: number;
  __testThrowAfterMemoryInvalidate?: boolean;
  __testThrowAfterMemoryRebuild?: boolean;
}) {
  const db = getDb();
  db.transaction(() => {
    const preIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, opts.assistantId)!;
    executeAtomicManualEditMutationCore(db, {
      chatId: CHAT,
      messageId: opts.assistantId,
      content: opts.newProse,
      alternatesJson: "[]",
      statusWidgetValuesJson: "{}",
      materialProseChange: true,
      sourceTurn: preIdentity.memoryTurnNumber,
    });
    reconcileMemoryAfterSourceMessageEditSyncCore(db, {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 10_000,
      memoryTurnNumber: preIdentity.memoryTurnNumber,
      sourceUserMessageId: preIdentity.sourceUserMessageId,
      sourceAssistantMessageId: preIdentity.sourceAssistantMessageId,
      __testThrowAfterMemoryInvalidate: opts.__testThrowAfterMemoryInvalidate,
      __testThrowAfterMemoryRebuild: opts.__testThrowAfterMemoryRebuild,
    });
  }).immediate();
}

function sealBatch1To5() {
  persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: 1,
    assistantMessageId: null,
    summary: VALID_SUMMARY,
    playableTurnCount: 5,
  });
}

function waitUntil(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitUntil timeout"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_5PLUS4_ENABLED = "1";
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
});

describe("repair job ordering after record delete", () => {
  it("post-invalidation repair job commits and reseals missing batch", async () => {
    seedBase(10);
    sealBatch1To5();
    getDb()
      .prepare(`UPDATE chat_memories SET message_count=10, summarized_turn_count=5 WHERE chat_id=?`)
      .run(CHAT);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.ok(markMemoryRecordInactive(CHAT, row.id));

    let llmEntered = false;
    let releaseLlm!: () => void;
    const llmGate = new Promise<void>((resolve) => {
      releaseLlm = resolve;
    });

    __setSummarizeTurnBatchCallerForTests(async () => {
      llmEntered = true;
      await llmGate;
      return {
        text:
          `${NEW_FACT} `.repeat(8) +
          "resealed batch after record delete gap repair.",
      };
    });

    reconcileMemoryAfterRecordDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });

    await waitUntil(() => llmEntered);
    releaseLlm();
    await new Promise((r) => setTimeout(r, 200));

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(OLD_FACT));
    assert.match(lore, new RegExp(NEW_FACT));
    const active = listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.turnStart, 1);
    assert.equal(active[0]!.turnEnd, 5);
    const mem = getDb()
      .prepare(`SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?`)
      .get(CHAT) as { summarized_turn_count: number };
    assert.equal(mem.summarized_turn_count, 5);
  });
});

describe("assistant material prose edit", () => {
  it("invalidates sealed summary and reseals with new source prose", async () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number };

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return {
        text:
          `${NEW_FACT} `.repeat(8) +
          "material edit reseal with updated assistant source.",
      };
    });

    const newProse = `assistant 1 ${NEW_FACT} updated narrative`;
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, assistant.id)!;
    const epochBefore = getMemorySourceBoundaryCore(db, CHAT).epoch;
    runAtomicAssistantMaterialEdit({
      assistantId: assistant.id,
      newProse,
      memoryTurnNumber: identity.memoryTurnNumber,
      sourceUserMessageId: identity.sourceUserMessageId,
      sourceAssistantMessageId: identity.sourceAssistantMessageId,
    });

    const epochAfterSync = getMemorySourceBoundaryCore(db, CHAT).epoch;
    assert.equal(epochAfterSync, epochBefore + 1);

    scheduleMemoryResealAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      summarizedTurnCount: 0,
      assistantMessageId: assistant.id,
    });

    releaseLlm!();
    await new Promise((r) => setTimeout(r, 250));

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, epochAfterSync);

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(OLD_FACT));
    assert.match(lore, new RegExp(NEW_FACT));

    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const injection = buildMemoryContext({
      memory,
      userMessage: "next turn",
      memoryCapacity: 10_000,
    });
    assert.doesNotMatch(injection.text, new RegExp(OLD_FACT));
    assert.match(injection.text, new RegExp(NEW_FACT));
  });

  it("format-only edit does not bump generation or invalidate sealed summary", () => {
    seedBase(5);
    sealBatch1To5();
    const beforeEpoch = getMemorySourceBoundaryCore(getDb(), CHAT).epoch;

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    const formatOnly = `  ${assistant.content.replace(/\n/g, "\r\n")}  `;
    assert.equal(isMaterialProseEdit(assistant.content, formatOnly), false);

    executeAtomicManualEditCore(db, {
      chatId: CHAT,
      messageId: assistant.id,
      content: formatOnly,
      alternatesJson: "[]",
      statusWidgetValuesJson: "{}",
      materialProseChange: false,
      sourceTurn: 1,
    });

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(OLD_FACT));
  });

  it("status-only edit does not bump generation", () => {
    seedBase(5);
    sealBatch1To5();
    const beforeEpoch = getMemorySourceBoundaryCore(getDb(), CHAT).epoch;

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    executeAtomicManualEditCore(db, {
      chatId: CHAT,
      messageId: assistant.id,
      content: assistant.content,
      alternatesJson: "[]",
      statusWidgetValuesJson: JSON.stringify({
        character: { mood: "calm" },
        user: { mood: "curious" },
      }),
      materialProseChange: false,
      sourceTurn: 1,
      supersedeTriggers: true,
      triggerSupersessionReason: "manual_status_edit",
    });

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
  });
});

describe("user message edit", () => {
  it("material user source edit invalidates sealed summary and allows reseal", async () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const userMsg = db
      .prepare(`SELECT id, content FROM messages WHERE chat_id=? AND role='user' AND model='user' ORDER BY id LIMIT 1`)
      .get(CHAT) as { id: number; content: string };

    const newContent = userMsg.content.replace(SECRET_OLD, SECRET_NEW);
    assert.ok(isMaterialProseEdit(userMsg.content, newContent));

    const epochBefore = getMemorySourceBoundaryCore(db, CHAT).epoch;
    let syncSummarizedTurnCount: number | null = null;
    db.transaction(() => {
      const preIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id)!;
      db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(newContent, userMsg.id);
      const postIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id)!;
      assert.equal(preIdentity.memoryTurnNumber, postIdentity.memoryTurnNumber);
      const result = reconcileMemoryAfterSourceMessageEditSyncCore(db, {
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        memoryCapacity: 10_000,
        memoryTurnNumber: preIdentity.memoryTurnNumber,
        sourceUserMessageId: preIdentity.sourceUserMessageId,
        sourceAssistantMessageId: preIdentity.sourceAssistantMessageId,
      });
      syncSummarizedTurnCount = result.summarizedTurnCount;
    }).immediate();

    const epochAfterSync = getMemorySourceBoundaryCore(db, CHAT).epoch;
    assert.equal(epochAfterSync, epochBefore + 1);

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return {
        text:
          `${SECRET_NEW} `.repeat(4) +
          `${NEW_FACT} `.repeat(4) +
          "user source edit reseal.",
      };
    });

    scheduleMemoryResealAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      summarizedTurnCount: syncSummarizedTurnCount,
    });

    releaseLlm!();
    await new Promise((r) => setTimeout(r, 250));

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, epochAfterSync);

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(SECRET_OLD));
    assert.match(lore, new RegExp(SECRET_NEW));

    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const injection = buildMemoryContext({
      memory,
      userMessage: "continue",
      memoryCapacity: 10_000,
    });
    assert.doesNotMatch(injection.text, new RegExp(SECRET_OLD));
  });
});

describe("canonical to noncanonical user edit", () => {
  it("fail-before: POST-only identity leaves sealed summary canonical", () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const userMsg = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='user' AND model='user' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    assert.equal(resolveOocSceneRenderIntent(userMsg.content), false);
    assert.equal(resolveOocSceneRenderIntent(OOC_ISOLATED_RENDER), true);

    const memoryBefore = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const injectionBefore = buildMemoryContext({
      memory: memoryBefore,
      userMessage: "next turn",
      memoryCapacity: 10_000,
    });
    assert.match(injectionBefore.text, new RegExp(OLD_FACT));

    // Correction 3 bug: UPDATE then POST-only resolve; skip reconcile when null
    db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(OOC_ISOLATED_RENDER, userMsg.id);
    const postIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id);
    assert.equal(postIdentity, null);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
  });

  it("eligibility-changing edit is atomically rejected; message and memory unchanged", () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const userMsg = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='user' AND model='user' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    const beforeContent = userMsg.content;
    const beforeEpoch = getMemorySourceBoundaryCore(db, CHAT).epoch;
    const beforeLore = rebuildLorebookFromRecords(CHAT);

    assert.throws(
      () => {
        db.transaction(() => {
          const preIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id);
          assert.ok(preIdentity != null);
          db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(
            OOC_ISOLATED_RENDER,
            userMsg.id
          );
          const postIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id);
          assert.equal(postIdentity, null);
          if (memorySourceEligibilityChanged(preIdentity, postIdentity)) {
            throw new MemoryCanonicalityEditNotSupportedError();
          }
        }).immediate();
      },
      MemoryCanonicalityEditNotSupportedError
    );

    assert.equal(messageContent(userMsg.id), beforeContent);
    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    assert.equal(rebuildLorebookFromRecords(CHAT), beforeLore);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
  });
});

describe("helper — old repair self-stale ordering regression", () => {
  it("invalidate-before-schedule prevents freshly started job from self-stale", async () => {
    seedBase(10);
    sealBatch1To5();
    getDb()
      .prepare(`UPDATE chat_memories SET message_count=10, summarized_turn_count=5 WHERE chat_id=?`)
      .run(CHAT);
    markMemoryRecordInactive(CHAT, listMemoryRecordsForChat(CHAT)[0]!.id);

    const snapshotBefore = getMemorySourceBoundaryCore(getDb(), CHAT);

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return { text: `${NEW_FACT} `.repeat(10) + "repair committed." };
    });

    reconcileMemoryAfterRecordDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });

    const snapshotAfterReconcile = getMemorySourceBoundaryCore(getDb(), CHAT);
    assert.ok(snapshotAfterReconcile.epoch > snapshotBefore.epoch);

    releaseLlm!();
    const ok = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });
    assert.equal(ok, true);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(NEW_FACT));
  });

  it("stale snapshot from pre-invalidation epoch is rejected at persist", () => {
    seedBase(5);
    sealBatch1To5();
    const staleSnapshot = getMemorySourceBoundaryCore(getDb(), CHAT);
    invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
    assert.equal(staleSnapshot.epoch + 1, getMemorySourceBoundaryCore(getDb(), CHAT).epoch);
    void staleSnapshot;
  });
});

describe("atomic source edit rollback — assistant", () => {
  it("A1: failure after message update rolls back prose and sealed summary", () => {
    seedBase(5);
    sealBatch1To5();
    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, assistant.id)!;
    const beforeEpoch = getMemorySourceBoundaryCore(db, CHAT).epoch;
    const newProse = "completely different assistant prose";

    assert.throws(() => {
      runAtomicAssistantMaterialEdit({
        assistantId: assistant.id,
        newProse,
        memoryTurnNumber: identity.memoryTurnNumber,
        sourceUserMessageId: identity.sourceUserMessageId,
        sourceAssistantMessageId: identity.sourceAssistantMessageId,
        __testThrowAfterMemoryInvalidate: true,
      });
    });

    assert.equal(messageContent(assistant.id), assistant.content);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    assert.equal(
      listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length,
      1
    );
  });

  it("A2: failure after sealed-row inactive rolls back entire transaction", () => {
    seedBase(5);
    sealBatch1To5();
    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, assistant.id)!;
    const newProse = "another different assistant prose";

    assert.throws(() => {
      runAtomicAssistantMaterialEdit({
        assistantId: assistant.id,
        newProse,
        memoryTurnNumber: identity.memoryTurnNumber,
        sourceUserMessageId: identity.sourceUserMessageId,
        sourceAssistantMessageId: identity.sourceAssistantMessageId,
        __testThrowAfterMemoryRebuild: true,
      });
    });

    assert.equal(messageContent(assistant.id), assistant.content);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
    assert.equal(
      listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length,
      1
    );
  });
});

describe("atomic source edit rollback — user", () => {
  it("failure during memory mutation rolls back user content and sealed summary", () => {
    seedBase(5);
    sealBatch1To5();
    const db = getDb();
    const userMsg = db
      .prepare(`SELECT id, content FROM messages WHERE chat_id=? AND role='user' AND model='user' ORDER BY id LIMIT 1`)
      .get(CHAT) as { id: number; content: string };
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id)!;
    const newContent = userMsg.content.replace(SECRET_OLD, SECRET_NEW);
    const beforeEpoch = getMemorySourceBoundaryCore(db, CHAT).epoch;

    assert.throws(() => {
      db.transaction(() => {
        const preIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMsg.id)!;
        db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(newContent, userMsg.id);
        reconcileMemoryAfterSourceMessageEditSyncCore(db, {
          chatId: CHAT,
          userId: USER,
          characterId: CHAR,
          tier: "free",
          memoryCapacity: 10_000,
          memoryTurnNumber: preIdentity.memoryTurnNumber,
          sourceUserMessageId: preIdentity.sourceUserMessageId,
          sourceAssistantMessageId: preIdentity.sourceAssistantMessageId,
          __testThrowAfterMemoryRebuild: true,
        });
      }).immediate();
    });

    assert.equal(messageContent(userMsg.id), userMsg.content);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    void identity;
  });
});

describe("async reseal failure — safe missing memory", () => {
  it("sync invalidation committed; failed LLM reseal leaves old summary non-canonical", async () => {
    seedBase(5);
    sealBatch1To5();
    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number };
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, assistant.id)!;
    const newProse = `assistant 1 ${NEW_FACT} committed prose`;

    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("LLM_RESEAL_FAILED");
    });

    runAtomicAssistantMaterialEdit({
      assistantId: assistant.id,
      newProse,
      memoryTurnNumber: identity.memoryTurnNumber,
      sourceUserMessageId: identity.sourceUserMessageId,
      sourceAssistantMessageId: identity.sourceAssistantMessageId,
    });

    scheduleMemoryResealAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      summarizedTurnCount: 0,
      assistantMessageId: assistant.id,
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.equal(messageContent(assistant.id), newProse);
    assert.doesNotMatch(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
    assert.ok(getMemorySourceBoundaryCore(db, CHAT).epoch >= 1);
    assert.equal(listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length, 0);
  });
});

describe("assistant-only canon-adopted source identity", () => {
  function seedWithAssistantOnlyScene() {
    cleanup();
    const db = getDb();
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
      USER,
      `edit-${USER}@test.local`,
      "edit",
      "x"
    );
    db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EditChar");
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_capacity) VALUES (?,?,?,'safe',?)`).run(
      CHAT,
      USER,
      CHAR,
      10_000
    );
    getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    seedOpening();
    for (let t = 1; t <= 7; t++) {
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "user",
        `user turn ${t}`,
        "user"
      );
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "assistant",
        `assistant ${t}`,
        "test"
      );
    }
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, usage) VALUES (?,?,?,?,?)`
    ).run(CHAT, "assistant", `${ASSISTANT_ONLY_OLD} scene`, "test", ADOPTED_USAGE);
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      "user turn 9",
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      "assistant 9",
      "test"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      "user turn 10",
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      "assistant 10",
      "test"
    );
  }

  it("edits assistant-only turn without misattributing to prior user turn", async () => {
    seedWithAssistantOnlyScene();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: `${EARLY_BATCH_MARKER} `.repeat(6) + "early batch sealed.",
      playableTurnCount: 10,
    });
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 6,
      assistantMessageId: null,
      summary: `${ASSISTANT_ONLY_OLD} `.repeat(6) + "late batch with assistant-only scene.",
      playableTurnCount: 10,
    });

    const db = getDb();
    const assistantOnly = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND content LIKE ? ORDER BY id DESC`
      )
      .get(CHAT, `%${ASSISTANT_ONLY_OLD}%`) as { id: number };
    const identity = resolveMemorySourceTurnIdentityCore(db, CHAT, assistantOnly.id)!;
    assert.equal(identity.assistantOnly, true);
    assert.equal(identity.sourceUserMessageId, null);
    assert.equal(identity.memoryTurnNumber, 8);

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return {
        text: `${ASSISTANT_ONLY_NEW} `.repeat(8) + "assistant-only reseal.",
      };
    });

    runAtomicAssistantMaterialEdit({
      assistantId: assistantOnly.id,
      newProse: `${ASSISTANT_ONLY_NEW} updated scene`,
      memoryTurnNumber: identity.memoryTurnNumber,
      sourceUserMessageId: identity.sourceUserMessageId,
      sourceAssistantMessageId: identity.sourceAssistantMessageId,
    });

    scheduleMemoryResealAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      summarizedTurnCount: 5,
      assistantMessageId: assistantOnly.id,
    });

    releaseLlm!();
    await new Promise((r) => setTimeout(r, 300));

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(EARLY_BATCH_MARKER));
    assert.doesNotMatch(lore, new RegExp(ASSISTANT_ONLY_OLD));
    assert.match(lore, new RegExp(ASSISTANT_ONLY_NEW));
    const earlyBatch = listMemoryRecordsForChat(CHAT).find(
      (r) => !r.inactive && r.turnStart === 1
    );
    assert.ok(earlyBatch);
    assert.match(earlyBatch.summary, new RegExp(EARLY_BATCH_MARKER));
  });
});
