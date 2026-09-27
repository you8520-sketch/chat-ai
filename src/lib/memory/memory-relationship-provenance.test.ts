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
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  loadChatRelationshipMeta,
  mergeRelationshipMetaAfterRegenerate,
  mergeRelationshipMetaFromTurn,
} from "@/lib/memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import {
  resolveActiveAssistantGenerationScope,
  resolveNextAssistantGenerationSequence,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  appendMessageVariant,
  normalizeMessageVariants,
} from "@/lib/messageAlternates";
import {
  bootstrapStreamingTurn,
  finalizeAssistantMessage,
} from "@/lib/streamingPersistence";

const CHAT_ID = 882001;
const USER_ID = 882002;
const CHAR_ID = 882003;
const USER_MSG_ID = 882009;
const ASSISTANT_MSG_ID = 882010;
const NAMES = { charName: "TestChar", userName: "Tester" };

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seed(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `rel-prov-${USER_ID}@test.local`,
    "Tester",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta)
     VALUES (?,?,?,'safe',?)`
  ).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID,
    JSON.stringify({
      honorifics: [],
      items: ["Tester: old-key"],
      thoughts: [],
      promises: [],
    })
  );
  db.prepare(
    `INSERT INTO messages
      (id, chat_id, role, content, model, user_message_id, generation_status)
     VALUES (?, ?, 'user', 'hello', '', NULL, 'completed')`
  ).run(USER_MSG_ID, CHAT_ID);
  db.prepare(
    `INSERT INTO messages
      (id, chat_id, role, content, model, user_message_id, generation_status)
     VALUES (?, ?, 'assistant', 'old reply', 'test', ?, 'completed')`
  ).run(ASSISTANT_MSG_ID, CHAT_ID, USER_MSG_ID);
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function readBeforeJson(): string | null {
  return (
    getDb()
      .prepare(
        "SELECT memory_relationship_before_json AS v FROM messages WHERE id=?"
      )
      .get(ASSISTANT_MSG_ID) as { v: string | null }
  ).v;
}

function finalizeRegeneration(requestId: string): AssistantGenerationScope {
  const db = getDb();
  bootstrapStreamingTurn(db, {
    chatId: CHAT_ID,
    requestId,
    userContent: "hello",
    skipUserInsert: true,
    existingUserMessageId: USER_MSG_ID,
    regenerateAssistantId: ASSISTANT_MSG_ID,
  });

  const generationScope: AssistantGenerationScope = {
    assistantMessageId: ASSISTANT_MSG_ID,
    generationSequence: resolveNextAssistantGenerationSequence(ASSISTANT_MSG_ID, db),
    generationRequestId: requestId,
  };
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant
       FROM messages WHERE id=? AND chat_id=?`
    )
    .get(ASSISTANT_MSG_ID, CHAT_ID) as {
      content: string;
      model: string;
      usage: string | null;
      alternates: string | null;
      active_variant: number | null;
    };
  const { variants } = normalizeMessageVariants(row);
  const appended = appendMessageVariant(variants, {
    content: "new reply",
    model: "test",
    usage: null,
    created_at: "",
    generationSequence: generationScope.generationSequence,
    requestId,
    sourceMessageId: ASSISTANT_MSG_ID,
  });
  const finalized = finalizeAssistantMessage(db, {
    assistantMessageId: ASSISTANT_MSG_ID,
    chatId: CHAT_ID,
    content: "new reply",
    model: "test",
    usageJson: "{}",
    alternatesJson: JSON.stringify(appended.variants),
    activeVariant: appended.activeVariant,
  });
  assert.equal(finalized.wrote, true);
  assert.deepEqual(resolveActiveAssistantGenerationScope(ASSISTANT_MSG_ID, db), generationScope);
  return generationScope;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  process.env.MEMORY_FEATURE_ENABLED = "1";
  seed();
});

describe("relationship projection provenance", () => {
  it("captures pre-turn projection once and preserves it across canonical regeneration", async () => {
    await mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "I picked up a coin.",
      assistantMessage: "You keep the coin.",
      route: "safe",
      mainModelTailParsed: true,
      mainModelDelta: { items: ["Tester: old-key, coin"] },
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: {
        assistantMessageId: ASSISTANT_MSG_ID,
        generationSequence: 0,
        generationRequestId: null,
      },
    });

    const firstSnapshot = readBeforeJson();
    assert.ok(firstSnapshot);
    assert.deepEqual(JSON.parse(firstSnapshot!), {
      honorifics: [],
      items: ["Tester: old-key"],
      thoughts: [],
      promises: [],
    });
    assert.deepEqual(loadChatRelationshipMeta(CHAT_ID, NAMES).items, [
      "Tester: old-key, coin",
    ]);
    const afterFirst = normalizeMessageVariants(
      getDb()
        .prepare(
          "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?"
        )
        .get(ASSISTANT_MSG_ID) as {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    );
    assert.deepEqual(afterFirst.variants[0]?.relationshipMetaAfter?.items, [
      "Tester: old-key, coin",
    ]);

    const generationScope = finalizeRegeneration("regen-provenance");
    assert.equal(readBeforeJson(), firstSnapshot, "regen bootstrap/finalize must preserve pre-turn baseline");

    await mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "I picked up a token instead.",
      newAssistantMessage: "You keep the token.",
      previousAssistantMessage: "You keep the coin.",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope,
      sharedInitialAttempted: true,
      sharedInitialParsed: true,
      sharedInitialDelta: {
        itemsRemove: ["Tester: old-key, coin"],
        items: ["Tester: old-key, token"],
      },
    });

    assert.equal(readBeforeJson(), firstSnapshot, "later generation must not overwrite pre-turn baseline");
    assert.deepEqual(loadChatRelationshipMeta(CHAT_ID, NAMES).items, [
      "Tester: old-key, token",
    ]);

    const afterRegen = normalizeMessageVariants(
      getDb()
        .prepare(
          "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?"
        )
        .get(ASSISTANT_MSG_ID) as {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    );
    assert.deepEqual(afterRegen.variants[0]?.relationshipMetaAfter?.items, [
      "Tester: old-key, coin",
    ]);
    assert.deepEqual(afterRegen.variants[1]?.relationshipMetaAfter?.items, [
      "Tester: old-key, token",
    ]);


  it("persists relationshipMetaAfter for a valid zero-delta generation", async () => {
    await mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "Nothing changes.",
      assistantMessage: "The scene continues unchanged.",
      route: "safe",
      mainModelTailParsed: true,
      mainModelDelta: {},
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: {
        assistantMessageId: ASSISTANT_MSG_ID,
        generationSequence: 0,
        generationRequestId: null,
      },
    });

    assert.equal(readBeforeJson(), null, "zero delta should not need delete provenance");
    const stored = normalizeMessageVariants(
      getDb()
        .prepare(
          "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?"
        )
        .get(ASSISTANT_MSG_ID) as {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    );
    assert.deepEqual(stored.variants[0]?.relationshipMetaAfter?.items, [
      "Tester: old-key",
    ]);
    assert.deepEqual(loadChatRelationshipMeta(CHAT_ID, NAMES).items, [
      "Tester: old-key",
    ]);
  });
  });
});
