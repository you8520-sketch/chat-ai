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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  loadPreviousTurnStatusMeta,
  scheduleStatusMetaExtraction,
} from "@/lib/statusMeta/job";
import { serializeStatusMetaRecord, type StatusMeta } from "@/lib/statusMeta/types";

const CHAT_ID = 993001;
const MSG_A = 993010;
const MSG_B = 993011;
const USER_MSG_A = 993009;

function validStatusMeta(sceneSummary: string): StatusMeta {
  return {
    tableMarkdown: `| ${sceneSummary} |\n| --- |\n| value |`,
    datetime: "09:00",
    location: "room",
    relationship: "ok",
    npcEmotion: "calm",
    npcIntent: "talk",
    nextObjective: "go",
    hiddenThought: "none",
    sceneSummary,
  };
}

function seedChat() {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, 1, 1, 'safe', '{}')`
  ).run(CHAT_ID);
}

function insertAssistantMessage(input: {
  id: number;
  content: string;
  alternates: string;
  activeVariant: number;
  statusMeta: string;
  userMessageId?: number | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model, status_meta)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', ?, ?, 'm', ?)`
  ).run(
    input.id,
    CHAT_ID,
    input.content,
    input.userMessageId ?? null,
    input.alternates,
    input.activeVariant,
    input.statusMeta
  );
}

before(() => {
  installIsolatedTestDatabase();
});
after(() => uninstallIsolatedTestDatabase());

describe("status meta previous-turn generation continuity", () => {
  it("IR1 — active gen0 with stored gen1 record is not returned", () => {
    seedChat();
    const alternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
    ]);
    insertAssistantMessage({
      id: MSG_A,
      content: "gen0",
      alternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("WRONG_GEN1"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 1,
      }),
    });

    const previous = loadPreviousTurnStatusMeta(CHAT_ID);
    assert.equal(previous, null);
  });

  it("IR2 — active gen1 with stored gen1 record is returned", () => {
    seedChat();
    const alternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
    ]);
    insertAssistantMessage({
      id: MSG_A,
      content: "gen1",
      alternates,
      activeVariant: 1,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("MATCHING_GEN1"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 1,
      }),
    });

    const previous = loadPreviousTurnStatusMeta(CHAT_ID);
    assert.equal(previous?.sceneSummary, "MATCHING_GEN1");
  });

  it("IR3 — immediate prior mismatch falls back to older valid meta", () => {
    seedChat();
    const gen0Alternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
    ]);
    insertAssistantMessage({
      id: MSG_A,
      content: "older gen0",
      alternates: gen0Alternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("OLDER_VALID_GEN0"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 0,
      }),
    });

    const genMismatchAlternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
    ]);
    insertAssistantMessage({
      id: MSG_B,
      content: "gen0",
      alternates: genMismatchAlternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("MISMATCH_GEN1"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 1,
      }),
      userMessageId: USER_MSG_A,
    });

    const previous = loadPreviousTurnStatusMeta(CHAT_ID);
    assert.equal(previous?.sceneSummary, "OLDER_VALID_GEN0");
  });

  it("IR4 — next-turn extraction never uses stale-generation previousMeta", async () => {
    seedChat();
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'user', 'hi', NULL, 'completed', '[]', 0, 'm')`
    ).run(USER_MSG_A, CHAT_ID);

    const mismatchAlternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
    ]);
    insertAssistantMessage({
      id: MSG_A,
      content: "gen0",
      alternates: mismatchAlternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("STALE_GEN1_META"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 1,
      }),
      userMessageId: USER_MSG_A,
    });

    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'assistant', 'next turn', ?, 'completed', '[]', 0, 'm')`
    ).run(MSG_B, CHAT_ID, USER_MSG_A);

    let observedPreviousMeta: StatusMeta | null | undefined;
    scheduleStatusMetaExtraction({
      messageId: MSG_B,
      chatId: CHAT_ID,
      generationScope: {
        assistantMessageId: MSG_B,
        generationSequence: 0,
        generationRequestId: null,
      },
      charName: "Char",
      personaName: "Tester",
      userMessage: "hi",
      assistantProse: "next turn",
      formatSpec: "| 🕒 |",
      __testObservePreviousMeta: (meta) => {
        observedPreviousMeta = meta;
      },
      __testExtract: async () => validStatusMeta("CURRENT_TURN"),
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(observedPreviousMeta, null);
  });

  it("IR4b — next-turn extraction uses older valid generation when available", async () => {
    seedChat();
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'user', 'hi', NULL, 'completed', '[]', 0, 'm')`
    ).run(USER_MSG_A, CHAT_ID);

    const olderAlternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
    ]);
    insertAssistantMessage({
      id: MSG_A,
      content: "older",
      alternates: olderAlternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("OLDER_VALID"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 0,
      }),
      userMessageId: USER_MSG_A,
    });

    const mismatchAlternates = JSON.stringify([
      { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
    ]);
    insertAssistantMessage({
      id: MSG_B,
      content: "gen0",
      alternates: mismatchAlternates,
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("STALE_GEN1_META"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        generationSequence: 1,
      }),
      userMessageId: USER_MSG_A,
    });

    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'assistant', 'next turn', ?, 'completed', '[]', 0, 'm')`
    ).run(MSG_B + 1, CHAT_ID, USER_MSG_A);

    let observedPreviousMeta: StatusMeta | null | undefined;
    scheduleStatusMetaExtraction({
      messageId: MSG_B + 1,
      chatId: CHAT_ID,
      generationScope: {
        assistantMessageId: MSG_B + 1,
        generationSequence: 0,
        generationRequestId: null,
      },
      charName: "Char",
      personaName: "Tester",
      userMessage: "hi",
      assistantProse: "next turn",
      formatSpec: "| 🕒 |",
      __testObservePreviousMeta: (meta) => {
        observedPreviousMeta = meta;
      },
      __testExtract: async () => validStatusMeta("CURRENT_TURN"),
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(observedPreviousMeta?.sceneSummary, "OLDER_VALID");
    assert.equal(observedPreviousMeta?.sceneSummary?.includes("STALE_GEN1_META"), false);
  });

  it("IR5 — unscoped legacy status meta is not used as previousMeta", () => {
    seedChat();
    insertAssistantMessage({
      id: MSG_A,
      content: "legacy",
      alternates: "[]",
      activeVariant: 0,
      statusMeta: serializeStatusMetaRecord({
        meta: validStatusMeta("UNSCOPED_LEGACY"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      }),
    });

    const previous = loadPreviousTurnStatusMeta(CHAT_ID);
    assert.equal(previous, null);
  });
});
