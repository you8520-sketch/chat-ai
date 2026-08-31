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
  asyncRecordMatchesGenerationScope,
  resolveActiveAssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { resolveClientAsyncRecordsFromMessageRow } from "@/lib/clientAsyncRecordRead";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import {
  normalizeSuggestedReplies,
  resolveClientSuggestedReplies,
  serializeSuggestedRepliesRecord,
  suggestedRepliesHaveContent,
} from "@/lib/suggestedReplies/parse";
import { serializeStatusMetaRecord, type StatusMeta } from "@/lib/statusMeta/types";
import { SUGGESTED_REPLY_KINDS } from "@/lib/suggestedReplies/types";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import {
  loadMessageSuggestedReplies,
  markMessageSuggestedRepliesPending,
  requeueSuggestedRepliesExtractionIfNeeded,
} from "@/lib/suggestedReplies/job";
import {
  loadMessageStatusMeta,
  markMessageStatusMetaPending,
  requeueStatusMetaExtractionIfNeeded,
} from "@/lib/statusMeta/job";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import { normalizeMessageVariants, resolveActiveVariantContent, serializeVariantsForClient } from "@/lib/messageAlternates";

const CHAT_ID = 992001;
const MSG_ID = 992010;
const USER_MSG_ID = 992009;

function validReplies(prefix: string): SuggestedReplyItem[] {
  return SUGGESTED_REPLY_KINDS.map((kind) => ({
    kind,
    text: `${prefix}-${kind}-${"x".repeat(40)}`,
  }));
}

function validStatusMeta(label: string): StatusMeta {
  return {
    tableMarkdown: `| ${label} |\n| --- |\n| value |`,
    datetime: "09:00",
    location: "room",
    relationship: "ok",
    npcEmotion: "calm",
    npcIntent: "talk",
    nextObjective: "go",
    hiddenThought: "none",
    sceneSummary: "scene",
  };
}

function seedTwoVariantMessage(activeVariant: number) {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, 1, 1, 'safe', '{}')`
  ).run(CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
     VALUES (?, ?, 'user', 'hi', NULL, 'completed', '[]', 0, 'm')`
  ).run(USER_MSG_ID, CHAT_ID);
  const alternates = JSON.stringify([
    { content: "gen0 content", model: "m", usage: null, created_at: "", generationSequence: 0 },
    { content: "gen1 content", model: "m", usage: null, created_at: "", generationSequence: 1 },
  ]);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model, suggested_replies_json, status_meta)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', ?, ?, 'm', ?, ?)`
  ).run(
    MSG_ID,
    CHAT_ID,
    activeVariant === 0 ? "gen0 content" : "gen1 content",
    USER_MSG_ID,
    alternates,
    activeVariant,
    serializeSuggestedRepliesRecord({
      replies: validReplies("GEN1_REPLY"),
      extractedAt: new Date().toISOString(),
      source: "background-deepseek",
      pending: false,
      failed: false,
      generationSequence: 1,
    }),
    serializeStatusMetaRecord({
      meta: validStatusMeta("GEN1_STATUS"),
      extractedAt: new Date().toISOString(),
      source: "background-deepseek",
      pending: false,
      failed: false,
      generationSequence: 1,
    })
  );
}

function loadMessageRow() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, content, model, usage, alternates, active_variant, request_id, generation_status,
              status_meta, suggested_replies_json
       FROM messages WHERE id=?`
    )
    .get(MSG_ID) as Parameters<typeof resolveClientAsyncRecordsFromMessageRow>[0];
}

function resolveSuggestedRepliesGetPayload(messageId: number) {
  const activeScope = resolveActiveAssistantGenerationScope(messageId);
  const rawRecord = loadMessageSuggestedReplies(messageId);
  const record =
    activeScope && asyncRecordMatchesGenerationScope(rawRecord, activeScope) ? rawRecord : null;
  const replies = normalizeSuggestedReplies(record);
  const hasContent = suggestedRepliesHaveContent(replies);
  return {
    pending: record?.pending === true && !hasContent,
    replies: record?.pending === true && !hasContent ? [] : replies,
    exposedGen1: replies.some((r) => r.text.includes("GEN1_REPLY")),
  };
}

function resolveStatusMetaGetPayload(messageId: number) {
  const activeScope = resolveActiveAssistantGenerationScope(messageId);
  const rawRecord = loadMessageStatusMeta(messageId);
  const record =
    activeScope && asyncRecordMatchesGenerationScope(rawRecord, activeScope) ? rawRecord : null;
  return {
    meta: record?.meta ?? null,
    exposedGen1: Boolean(record?.meta?.tableMarkdown?.includes("GEN1_STATUS")),
  };
}

function mapMessageGetPayload() {
  const refreshed = loadMessageRow();
  const { variants, activeVariant: resolvedActive } = normalizeMessageVariants(refreshed);
  const variantMeta = serializeVariantsForClient(variants, resolvedActive);
  const activeContent = resolveActiveVariantContent({
    content: refreshed.content,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
  });
  const { statusRecord, suggestedRepliesRecord } = resolveClientAsyncRecordsFromMessageRow(refreshed);
  const statusFlags = resolveClientStatusMetaFlags({
    statusRecord,
    messageContent: activeContent,
  });
  const suggested = resolveClientSuggestedReplies(suggestedRepliesRecord);
  return {
    content: activeContent,
    suggestedExposed: suggested.suggestedReplies.some((r) => r.text.includes("GEN1_REPLY")),
    statusExposed: Boolean(statusFlags.statusMeta?.tableMarkdown?.includes("GEN1_STATUS")),
    suggestedPending: suggested.suggestedRepliesPending,
    statusPending: statusFlags.statusMetaPending,
  };
}

function dbPrepareActiveVariant(activeVariant: number) {
  const db = getDb();
  db.prepare("UPDATE messages SET active_variant=?, content=? WHERE id=?").run(
    activeVariant,
    activeVariant === 0 ? "gen0 content" : "gen1 content",
    MSG_ID
  );
}

before(() => {
  installIsolatedTestDatabase();
});
after(() => uninstallIsolatedTestDatabase());

describe("client async record read boundaries", () => {
  it("CR1 — suggested replies variant mismatch hides stale generation content", () => {
    seedTwoVariantMessage(0);
    const payload = resolveSuggestedRepliesGetPayload(MSG_ID);
    assert.equal(payload.exposedGen1, false);
    assert.equal(payload.replies.length, 0);
    assert.equal(payload.pending, false);
  });

  it("CR2 — status meta variant mismatch hides stale generation content", () => {
    seedTwoVariantMessage(0);
    const payload = resolveStatusMetaGetPayload(MSG_ID);
    assert.equal(payload.exposedGen1, false);
    assert.equal(payload.meta, null);
  });

  it("CR3 — matching generation exposes suggestions and status meta", () => {
    seedTwoVariantMessage(1);
    const suggested = resolveSuggestedRepliesGetPayload(MSG_ID);
    const status = resolveStatusMetaGetPayload(MSG_ID);
    assert.equal(suggested.exposedGen1, true);
    assert.equal(status.exposedGen1, true);
  });

  it("CR4 — message GET serializer aligns content/usage async records with active generation", () => {
    seedTwoVariantMessage(0);
    const gen0Payload = mapMessageGetPayload();
    assert.match(gen0Payload.content, /gen0/);
    assert.equal(gen0Payload.suggestedExposed, false);
    assert.equal(gen0Payload.statusExposed, false);

    dbPrepareActiveVariant(1);
    const gen1Payload = mapMessageGetPayload();
    assert.match(gen1Payload.content, /gen1/);
    assert.equal(gen1Payload.suggestedExposed, true);
    assert.equal(gen1Payload.statusExposed, true);
  });

  it("CR5 — messages list mapper applies the same generation contract", () => {
    seedTwoVariantMessage(0);
    const row = loadMessageRow();
    const { suggestedRepliesRecord, statusRecord } = resolveClientAsyncRecordsFromMessageRow(row);
    const suggested = resolveClientSuggestedReplies(suggestedRepliesRecord);
    const status = resolveClientStatusMetaFlags({ statusRecord, messageContent: "gen0 content" });
    assert.equal(suggested.suggestedReplies.some((r) => r.text.includes("GEN1_REPLY")), false);
    assert.equal(Boolean(status.statusMeta?.tableMarkdown?.includes("GEN1_STATUS")), false);
  });

  it("CR6 — in-flight regen pending remains visible for current generation", () => {
    const db = getDb();
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
    db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
    db.prepare("DELETE FROM users WHERE id=?").run(992002);
    db.prepare("DELETE FROM characters WHERE id IN (1)").run();
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
      992002,
      "cr6@test.local",
      "cr6",
      "x"
    );
    db.prepare(`INSERT OR REPLACE INTO characters (id, name) VALUES (1,'Char')`).run();
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, ?, 1, 'safe', '{}')`
    ).run(CHAT_ID, 992002);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'user', 'hi', NULL, 'completed', '[]', 0, 'm')`
    ).run(USER_MSG_ID, CHAT_ID);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
       VALUES (?, ?, 'assistant', 'gen0 text', ?, 'completed', '[]', 0, 'm')`
    ).run(MSG_ID, CHAT_ID, USER_MSG_ID);

    bootstrapStreamingTurn(db, {
      chatId: CHAT_ID,
      requestId: "regen-pending-read",
      userContent: "hi",
      skipUserInsert: true,
      existingUserMessageId: USER_MSG_ID,
      regenerateAssistantId: MSG_ID,
    });

    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);
    markMessageSuggestedRepliesPending(MSG_ID, activeScope);
    markMessageStatusMetaPending(MSG_ID, null, activeScope);

    const row = loadMessageRow();
    const { statusRecord, suggestedRepliesRecord } = resolveClientAsyncRecordsFromMessageRow(row);
    const suggested = resolveClientSuggestedReplies(suggestedRepliesRecord);
    const status = resolveClientStatusMetaFlags({
      statusRecord,
      messageContent: "",
    });
    assert.equal(suggested.suggestedRepliesPending, true);
    assert.equal(status.statusMetaPending, true);
  });

  it("CR7 — historical mismatch does not requeue provider extraction", () => {
    seedTwoVariantMessage(0);
    const db = getDb();
    db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
      serializeSuggestedRepliesRecord({
        replies: [],
        extractedAt: new Date(Date.now() - 120_000).toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: true,
        generationSequence: 1,
      }),
      MSG_ID
    );
    db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(
      serializeStatusMetaRecord({
        meta: validStatusMeta("GEN1_STATUS"),
        extractedAt: new Date(Date.now() - 120_000).toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: true,
        generationSequence: 1,
      }),
      MSG_ID
    );
    assert.equal(requeueSuggestedRepliesExtractionIfNeeded(MSG_ID), false);
    assert.equal(requeueStatusMetaExtractionIfNeeded(MSG_ID), false);
  });
});
