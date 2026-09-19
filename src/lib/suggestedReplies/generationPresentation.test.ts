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
  normalizeSuggestedReplies,
  parseSuggestedRepliesRecord,
  resolveClientSuggestedReplies,
  serializeSuggestedRepliesRecord,
  shouldEnsureSuggestedRepliesExtraction,
} from "@/lib/suggestedReplies/parse";
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
          failed: false,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
        }),
        MSG_ID
      );

    const clientFields = resolveClientSuggestedReplies(loadMessageSuggestedReplies(MSG_ID));
    assert.equal(clientFields.suggestedRepliesPending, false);
    assert.deepEqual(clientFields.suggestedReplies, replies);
    assert.equal(shouldEnsureSuggestedRepliesExtraction(loadMessageSuggestedReplies(MSG_ID)), false);
  });

  it("C — GET route is pure read (no requeue import)", () => {
    const getRoute = readFileSync(
      join(process.cwd(), "src/app/api/chat/suggested-replies/route.ts"),
      "utf8"
    );
    assert.doesNotMatch(getRoute, /requeueSuggestedRepliesExtractionIfNeeded/);
    assert.doesNotMatch(getRoute, /shouldEnsureSuggestedRepliesExtraction/);
    assert.match(getRoute, /Pure read\/poll/);
  });

  it("C — repeated toggle simulation does not enqueue standalone extract on stale GET", () => {
    seedAssistantMessage();
    const scope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(scope);
    markMessageSuggestedRepliesPending(MSG_ID, scope);
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(shouldEnsureSuggestedRepliesExtraction(record), false);
  });

  it("G — regen pending clears prior generation suggestions scope", () => {
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
          failed: false,
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
    assert.equal(record?.noRetry, true);
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
