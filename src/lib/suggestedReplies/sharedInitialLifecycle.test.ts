import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import type { AssistantGenerationScope } from "@/lib/assistantGenerationScope";
import {
  loadMessageSuggestedReplies,
  scheduleSuggestedRepliesExtraction,
} from "./job";
import {
  clientNeedsSuggestedRepliesPoll,
  clientShouldShowSuggestedRepliesBar,
  resolveClientSuggestedReplies,
} from "./parse";
import type { SuggestedReplyItem } from "./types";

const USER_ID = 99201;
const CHARACTER_ID = 99202;
const CHAT_ID = 99203;
const MESSAGE_ID = 99204;
const REQUEST_ID = "shared-terminal-lifecycle-0";

function pad(seed: string, length = 72): string {
  return (seed + "가".repeat(length)).slice(0, length);
}

function canonicalReplies(): SuggestedReplyItem[] {
  return [
    { kind: "natural", text: pad('*고개를 끄덕이며* "좋아, 그 얘기부터 차근차근 이어가 보자." ') },
    { kind: "twist", text: pad('*창가를 돌아보며* "잠깐, 이번에는 다른 쪽에서 생각해 볼래?" ') },
    { kind: "banter", text: pad('*입꼬리를 올리며* "그렇게 진지하게 나오면 나도 한마디 해야겠는데?" ') },
  ];
}

function seedAssistantGeneration(): AssistantGenerationScope {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);

  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "suggested-shared@test.local", "tester", "x");
  db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(
    CHARACTER_ID,
    "유나"
  );
  db.prepare(
    "INSERT INTO chats (id, user_id, character_id, selected_persona_id) VALUES (?,?,?,NULL)"
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
  db.prepare(
    `INSERT INTO messages
      (id, chat_id, role, content, model, request_id, generation_status)
     VALUES (?,?,'assistant',?,'playwright-fixture',?,'completed')`
  ).run(
    MESSAGE_ID,
    CHAT_ID,
    "유나는 잠깐 생각한 뒤 천천히 고개를 끄덕였다.",
    REQUEST_ID
  );

  return {
    assistantMessageId: MESSAGE_ID,
    generationSequence: 0,
    generationRequestId: REQUEST_ID,
  };
}

function scheduleShared(input: {
  generationScope: AssistantGenerationScope;
  prefetchedReplies: SuggestedReplyItem[] | null;
  onExtract: () => void;
}): void {
  scheduleSuggestedRepliesExtraction({
    messageId: MESSAGE_ID,
    chatId: CHAT_ID,
    generationScope: input.generationScope,
    charName: "유나",
    personaName: "테스터",
    userMessage: "계속해.",
    assistantProse: "유나는 잠깐 생각한 뒤 천천히 고개를 끄덕였다.",
    prefetchedReplies: input.prefetchedReplies,
    sharedInitialAttemptConsumed: true,
    __testExtract: async () => {
      input.onExtract();
      return canonicalReplies();
    },
  });
}

describe("suggested replies shared initial terminal lifecycle", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  it("shared empty result settles synchronously as terminal failure with zero repair calls", () => {
    const generationScope = seedAssistantGeneration();
    let extractCalls = 0;

    scheduleShared({
      generationScope,
      prefetchedReplies: [],
      onExtract: () => {
        extractCalls += 1;
      },
    });

    const record = loadMessageSuggestedReplies(MESSAGE_ID);
    assert.equal(extractCalls, 0);
    assert.ok(record);
    assert.equal(record.pending, false);
    assert.equal(record.failed, true);
    assert.equal(record.noRetry, true);
    assert.equal(record.source, "post-turn-shared");
    assert.equal(record.generationSequence, 0);
    assert.equal(record.generationRequestId, REQUEST_ID);
    assert.deepEqual(record.replies, []);

    const client = resolveClientSuggestedReplies(record);
    assert.equal(client.suggestedRepliesRequested, true);
    assert.equal(client.suggestedRepliesPending, false);
    assert.equal(client.suggestedRepliesFailed, true);
    assert.deepEqual(client.suggestedReplies, []);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), false);
  });

  it("shared canonical trio settles synchronously as ready with zero repair calls", () => {
    const generationScope = seedAssistantGeneration();
    const replies = canonicalReplies();
    let extractCalls = 0;

    scheduleShared({
      generationScope,
      prefetchedReplies: replies,
      onExtract: () => {
        extractCalls += 1;
      },
    });

    const record = loadMessageSuggestedReplies(MESSAGE_ID);
    assert.equal(extractCalls, 0);
    assert.ok(record);
    assert.equal(record.pending, false);
    assert.equal(record.failed, false);
    assert.equal(record.noRetry, true);
    assert.equal(record.source, "post-turn-shared");
    assert.equal(record.generationSequence, 0);
    assert.equal(record.generationRequestId, REQUEST_ID);
    assert.deepEqual(record.replies, replies);

    const client = resolveClientSuggestedReplies(record);
    assert.equal(client.suggestedRepliesRequested, true);
    assert.equal(client.suggestedRepliesPending, false);
    assert.equal(client.suggestedRepliesFailed, false);
    assert.deepEqual(client.suggestedReplies, replies);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), true);
  });
});
