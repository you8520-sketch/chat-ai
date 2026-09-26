/**
 * Regression gates — generation vs presentation separation for suggested replies.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { resolveActiveAssistantGenerationScope } from "@/lib/assistantGenerationScope";
import {
  loadMessageSuggestedReplies,
  markMessageSuggestedRepliesIneligible,
  markMessageSuggestedRepliesPending,
  scheduleSuggestedRepliesExtraction,
} from "@/lib/suggestedReplies/job";
import {
  clientNeedsSuggestedRepliesPoll,
  clientShouldShowSuggestedRepliesBar,
  normalizeSuggestedReplies,
  parseSuggestedRepliesRecord,
  resolveClientSuggestedReplies,
  serializeSuggestedRepliesRecord,
} from "@/lib/suggestedReplies/parse";
import { resolveClientAsyncRecordsFromMessageRow } from "@/lib/clientAsyncRecordRead";
import { SUGGESTED_REPLY_KINDS, type SuggestedReplyItem } from "@/lib/suggestedReplies/types";

const CHAT_ID = 99001;
const USER_ID = 99002;
const CHARACTER_ID = 99003;
const MSG_ID = 99004;

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

function validReplies(prefix: string): SuggestedReplyItem[] {
  return [
    { kind: "natural", text: padReply(`*${prefix} natural* "자연스럽게 이어가자." `, 72) },
    { kind: "twist", text: padReply(`*${prefix} twist* "그럼 조건을 하나 붙일게." `, 72) },
    { kind: "banter", text: padReply(`*${prefix} banter* "오, 용기는 칭찬해." `, 72) },
  ];
}

function seedAssistantMessage(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);

  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "gen-pres@test.local", "gen", "x");
  db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(CHARACTER_ID, "라이크");
  db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (?,?,?)").run(
    CHAT_ID,
    USER_ID,
    CHARACTER_ID
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model, request_id)
     VALUES (?, ?, 'assistant', '라이크는 복도에 서 있었다.', NULL, 'completed', '[]', 0, 'gpt-5.6-luna', 'req-gen-pres')`
  ).run(MSG_ID, CHAT_ID);
  db.prepare("UPDATE messages SET suggested_replies_json=NULL WHERE id=?").run(MSG_ID);
}

describe("suggested replies generation vs presentation", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  it("A — OFF display pref no longer gates server generation (route source audit)", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.doesNotMatch(route, /body\.suggestedRepliesEnabled/);
    assert.match(route, /suggestedRepliesGenerationEligible/);
    assert.doesNotMatch(
      readFileSync(join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"), "utf8"),
      /suggestedRepliesEnabled/
    );
  });

  it("A — eligible turn persists suggestions regardless of UI visibility", async () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    const replies = validReplies("OFF");
    scheduleSuggestedRepliesExtraction({
      messageId: MSG_ID,
      chatId: CHAT_ID,
      generationScope: scope,
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      sharedInitialAttemptConsumed: true,
      prefetchedReplies: replies,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.source, "post-turn-shared");
    assert.deepEqual(normalizeSuggestedReplies(record?.replies), replies);
  });

  it("B — OFF→ON reads stored suggestions with zero provider calls", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    const replies = validReplies("STORED");
    getDb()
      .prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?")
      .run(
        serializeSuggestedRepliesRecord({
          replies,
          extractedAt: new Date().toISOString(),
          source: "post-turn-shared",
          pending: false,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
        }),
        MSG_ID
      );

    const clientFields = resolveClientSuggestedReplies(loadMessageSuggestedReplies(MSG_ID));
    assert.equal(clientFields.suggestedRepliesPending, false);
    assert.deepEqual(clientFields.suggestedReplies, replies);
  });

  it("C — GET route and job module are read-only (no requeue system)", () => {
    const getRoute = readFileSync(
      join(process.cwd(), "src/app/api/chat/suggested-replies/route.ts"),
      "utf8"
    );
    const jobSource = readFileSync(join(process.cwd(), "src/lib/suggestedReplies/job.ts"), "utf8");
    assert.doesNotMatch(getRoute, /requeueSuggestedRepliesExtractionIfNeeded/);
    assert.doesNotMatch(getRoute, /shouldEnsureSuggestedRepliesExtraction/);
    assert.doesNotMatch(jobSource, /requeueSuggestedRepliesExtractionIfNeeded/);
    assert.doesNotMatch(jobSource, /shouldEnsureSuggestedRepliesExtraction/);
    assert.match(getRoute, /Pure read\/poll/);
  });

  it("C — pending reservation exposes poll-only client state", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    markMessageSuggestedRepliesPending(MSG_ID, scope);
    const client = resolveClientSuggestedReplies(loadMessageSuggestedReplies(MSG_ID));
    assert.equal(client.suggestedRepliesPending, true);
    assert.deepEqual(client.suggestedReplies, []);
  });

  it("D — explicit pending reservation clears current-generation suggestions", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    getDb()
      .prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?")
      .run(
        serializeSuggestedRepliesRecord({
          replies: validReplies("OLD"),
          extractedAt: new Date().toISOString(),
          source: "post-turn-shared",
          pending: false,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
        }),
        MSG_ID
      );
    markMessageSuggestedRepliesPending(MSG_ID, scope);
    const pending = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(pending?.pending, true);
    assert.deepEqual(pending?.replies, []);
  });

  it("G0 — in-flight regen hides prior suggestions without destroying the prior record", () => {
    const replies = validReplies("RESTORE");
    const previousRecord = serializeSuggestedRepliesRecord({
      replies,
      extractedAt: new Date().toISOString(),
      source: "post-turn-shared",
      pending: false,
      generationSequence: 0,
      generationRequestId: "req-v0",
    });
    const baseRow = {
      id: MSG_ID,
      alternates: JSON.stringify([
        {
          content: "복구할 이전 답변",
          model: "gpt-5.6-luna",
          usage: null,
          created_at: "",
          generationSequence: 0,
          requestId: "req-v0",
        },
      ]),
      active_variant: 0,
      request_id: "req-v0",
      generation_status: "completed",
      content: "복구할 이전 답변",
      model: "gpt-5.6-luna",
      usage: null,
      status_meta: null,
      suggested_replies_json: previousRecord,
    };

    const before = resolveClientAsyncRecordsFromMessageRow(baseRow);
    assert.ok(before.suggestedRepliesRecord);

    const inFlight = resolveClientAsyncRecordsFromMessageRow({
      ...baseRow,
      request_id: "req-regen",
      generation_status: "generating",
      content: "",
    });
    assert.equal(inFlight.generationScope?.generationSequence, 1);
    assert.equal(inFlight.suggestedRepliesRecord, null);

    const restored = resolveClientAsyncRecordsFromMessageRow(baseRow);
    assert.deepEqual(
      resolveClientSuggestedReplies(restored.suggestedRepliesRecord).suggestedReplies,
      replies
    );
  });

  it("G1 — regen bootstrap preserves prior suggestions; post-final owner reserves the new generation", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    const earlyStart = route.indexOf("const regenGenerationScope = currentTurnGenerationScope;");
    const earlyEnd = route.indexOf("if (oocSceneRenderTurn)", earlyStart);
    assert.ok(earlyStart >= 0 && earlyEnd > earlyStart);
    const earlyRegenBlock = route.slice(earlyStart, earlyEnd);
    assert.doesNotMatch(earlyRegenBlock, /markMessageSuggestedRepliesPending/);

    const postFinalStart = route.indexOf("const scheduleRepliesIfEligible");
    const postFinalEnd = route.indexOf("if (rpDiagnosticCanary", postFinalStart);
    assert.ok(postFinalStart >= 0 && postFinalEnd > postFinalStart);
    const postFinalBlock = route.slice(postFinalStart, postFinalEnd);
    assert.match(postFinalBlock, /markMessageSuggestedRepliesPending/);
  });

  it("G2 — variant switch hides a record from the previously active generation", () => {
    const replies = validReplies("GEN1");
    const row = {
      id: MSG_ID,
      alternates: JSON.stringify([
        {
          content: "첫 번째 답변",
          model: "gpt-5.6-luna",
          usage: null,
          created_at: "",
          generationSequence: 0,
          requestId: "req-v0",
        },
        {
          content: "두 번째 답변",
          model: "gpt-5.6-luna",
          usage: null,
          created_at: "",
          generationSequence: 1,
          requestId: "req-v1",
        },
      ]),
      active_variant: 1,
      request_id: "req-v1",
      generation_status: "ok",
      content: "두 번째 답변",
      model: "gpt-5.6-luna",
      usage: null,
      status_meta: null,
      suggested_replies_json: serializeSuggestedRepliesRecord({
        replies,
        extractedAt: new Date().toISOString(),
        source: "post-turn-shared",
        pending: false,
          generationSequence: 1,
        generationRequestId: "req-v1",
      }),
    };

    const latest = resolveClientAsyncRecordsFromMessageRow(row);
    assert.ok(latest.suggestedRepliesRecord);
    assert.deepEqual(
      resolveClientSuggestedReplies(latest.suggestedRepliesRecord).suggestedReplies,
      replies
    );

    const older = resolveClientAsyncRecordsFromMessageRow({
      ...row,
      active_variant: 0,
      request_id: "req-v0",
      content: "첫 번째 답변",
    });
    assert.equal(older.suggestedRepliesRecord, null);
    const client = resolveClientSuggestedReplies(older.suggestedRepliesRecord);
    assert.equal(client.suggestedRepliesRequested, false);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), false);
  });

  it("G3 — client variant switch clears stale suggestions and refreshes canonical async fields", () => {
    const clientSource = readFileSync(
      join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    const start = clientSource.indexOf("async function switchVariant");
    const end = clientSource.indexOf("function startEdit", start);
    assert.ok(start >= 0 && end > start);
    const switchSource = clientSource.slice(start, end);
    assert.match(switchSource, /EMPTY_SUGGESTED_REPLIES_CLIENT/);
    assert.match(
      switchSource,
      /suggestedRepliesPollStartedRef\.current\.delete\(messageId\)/
    );
    assert.match(switchSource, /scheduleAssistantPostTurnRefresh\(\)/);

    const pollStart = clientSource.indexOf("function startSuggestedRepliesPoll");
    const pollEnd = clientSource.indexOf("async function runStatusMetaPollWithRetry", pollStart);
    assert.ok(pollStart >= 0 && pollEnd > pollStart);
    const pollSource = clientSource.slice(pollStart, pollEnd);
    assert.match(pollSource, /Map<number, symbol>/);
    assert.match(
      pollSource,
      /pollStartedRef\.current\.get\(messageId\) !== pollToken/
    );
  });

  it("G4 — read-only poll route/client close non-pending empty snapshots immediately", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/chat/suggested-replies/route.ts"),
      "utf8"
    );
    assert.match(route, /resolveClientSuggestedReplies\(record\)/);
    assert.match(route, /requested:\s*client\.suggestedRepliesRequested/);

    const clientSource = readFileSync(
      join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    const pollStart = clientSource.indexOf("async function pollSuggestedRepliesForMessage");
    const pollEnd = clientSource.indexOf("function applySuggestedRepliesPollResult", pollStart);
    assert.ok(pollStart >= 0 && pollEnd > pollStart);
    const pollSource = clientSource.slice(pollStart, pollEnd);
    assert.match(pollSource, /resolveSuggestedRepliesPollSnapshot\(data\)/);
    assert.doesNotMatch(pollSource, /maxAttempts\s*-\s*4/);
  });

  it("G5 — material source edits invalidate persisted and client suggested replies", () => {
    const lifecycleSource = readFileSync(
      join(process.cwd(), "src/lib/rpDerivedStateLifecycle.ts"),
      "utf8"
    );
    assert.match(lifecycleSource, /invalidateSuggestedRepliesForSourceEditCore/);
    assert.match(lifecycleSource, /suggested_replies_json=NULL/);
    assert.match(lifecycleSource, /user_message_id=\?/);

    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/chat/message/route.ts"),
      "utf8"
    );
    assert.match(
      routeSource,
      /suggestedRepliesInvalidatedAssistantMessageIds/
    );
    assert.match(routeSource, /sourceRole: "assistant"/);
    assert.match(routeSource, /sourceRole: "user"/);

    const clientSource = readFileSync(
      join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    const saveEditStart = clientSource.indexOf("async function saveEdit");
    const saveEditEnd = clientSource.indexOf("function handleTurnDeleted", saveEditStart);
    assert.ok(saveEditStart >= 0 && saveEditEnd > saveEditStart);
    const saveEditSource = clientSource.slice(saveEditStart, saveEditEnd);
    assert.match(
      saveEditSource,
      /suggestedRepliesInvalidatedAssistantMessageIds/
    );
    assert.match(saveEditSource, /EMPTY_SUGGESTED_REPLIES_CLIENT/);
    assert.match(
      saveEditSource,
      /suggestedRepliesPollStartedRef\.current\.delete/
    );
  });

  it("H — natural / twist / banter contract", () => {
    assert.deepEqual(SUGGESTED_REPLY_KINDS, ["natural", "twist", "banter"]);
    const replies = validReplies("KINDS");
    const normalized = normalizeSuggestedReplies({ items: replies });
    assert.deepEqual(
      normalized.map((item) => item.kind),
      ["natural", "twist", "banter"]
    );
    const keys = new Set(normalized.map((item) => item.text.replace(/\s+/g, "").toLowerCase()));
    assert.equal(keys.size, 3);
  });

  it("I — persona voice fields remain in shared prompt owner", () => {
    const prompt = readFileSync(
      join(process.cwd(), "src/lib/postTurnSharedInitial/prompt.ts"),
      "utf8"
    );
    assert.match(prompt, /personaSpeechExamples/);
    assert.match(prompt, /USER SPEECH EXAMPLES/);
    assert.match(prompt, /Do not write as the character\/NPC/);
  });

  it("ineligible turns stay terminal — htmlFlash/ooc/empty prose owner unchanged", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    markMessageSuggestedRepliesIneligible(MSG_ID, scope);
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.terminalReason, "original_turn_ineligible");
    const client = resolveClientSuggestedReplies(record);
    assert.equal(client.suggestedRepliesRequested, false);
  });

  it("legacy background-deepseek source reads as post-turn-shared", () => {
    const legacy = parseSuggestedRepliesRecord(
      JSON.stringify({
        replies: validReplies("LEG"),
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
      })
    );
    assert.equal(legacy?.source, "post-turn-shared");
  });
});
