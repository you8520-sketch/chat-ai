import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import {
  loadMessageSuggestedReplies,
  scheduleGreetingSuggestedRepliesExtraction,
} from "./job";
import {
  clientNeedsSuggestedRepliesPoll,
  clientShouldShowSuggestedRepliesBar,
  resolveClientSuggestedReplies,
} from "./parse";
import type { SuggestedReplyItem } from "./types";

const USER_ID = 99101;
const CHARACTER_ID = 99102;
const CHAT_ID = 99103;
const MESSAGE_ID = 99104;

function pad(seed: string, length = 72): string {
  return (seed + "가".repeat(length)).slice(0, length);
}

function readyReplies(): SuggestedReplyItem[] {
  return [
    { kind: "natural", text: pad('*고개를 들며* "무슨 일인지 먼저 말해 줘." ') },
    { kind: "twist", text: pad('*문 쪽을 흘끗 보며* "잠깐, 밖에서 이야기할래?" ') },
    { kind: "banter", text: pad('*입꼬리를 올리며* "첫마디부터 그렇게 세게 나오기야?" ') },
  ];
}

function seedGreeting(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);

  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "suggested-greeting@test.local", "tester", "x");
  db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(
    CHARACTER_ID,
    "유나"
  );
  db.prepare(
    "INSERT INTO chats (id, user_id, character_id, selected_persona_id) VALUES (?,?,?,NULL)"
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, model) VALUES (?,?,'assistant',?,'greeting')"
  ).run(MESSAGE_ID, CHAT_ID, "유나는 창가에서 천천히 고개를 돌렸다.");
}

async function waitForSettledRecord(): Promise<ReturnType<typeof loadMessageSuggestedReplies>> {
  for (let i = 0; i < 40; i += 1) {
    const record = loadMessageSuggestedReplies(MESSAGE_ID);
    if (record && record.pending !== true) return record;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("suggested-replies greeting job did not settle");
}

describe("suggested replies greeting functional lifecycle", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  it("writes pending synchronously, then persists the canonical trio", async () => {
    seedGreeting();
    const expected = readyReplies();
    let calls = 0;

    scheduleGreetingSuggestedRepliesExtraction(MESSAGE_ID, CHAT_ID, {
      __testExtract: async () => {
        calls += 1;
        return expected;
      },
    });

    const pending = loadMessageSuggestedReplies(MESSAGE_ID);
    assert.equal(pending?.pending, true);
    assert.equal(pending?.source, "standalone-extract");
    assert.equal(pending?.generationSequence, 0);

    const settled = await waitForSettledRecord();
    assert.equal(calls, 1);
    assert.equal(settled?.pending, false);
    assert.equal(settled?.failed, false);
    assert.equal(settled?.source, "standalone-extract");
    assert.equal(settled?.generationSequence, 0);
    assert.deepEqual(settled?.replies, expected);

    const client = resolveClientSuggestedReplies(settled);
    assert.equal(client.suggestedRepliesRequested, true);
    assert.equal(client.suggestedRepliesPending, false);
    assert.equal(client.suggestedRepliesFailed, false);
    assert.deepEqual(client.suggestedReplies, expected);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), true);
  });

  it("settles a thrown extractor failure as terminal failure with no endless poll", async () => {
    seedGreeting();
    let calls = 0;

    scheduleGreetingSuggestedRepliesExtraction(MESSAGE_ID, CHAT_ID, {
      __testExtract: async () => {
        calls += 1;
        throw new Error("simulated provider timeout");
      },
    });

    const pending = loadMessageSuggestedReplies(MESSAGE_ID);
    assert.equal(pending?.pending, true);

    const settled = await waitForSettledRecord();
    assert.equal(calls, 1);
    assert.equal(settled?.pending, false);
    assert.equal(settled?.failed, true);
    assert.deepEqual(settled?.replies, []);

    const client = resolveClientSuggestedReplies(settled);
    assert.equal(client.suggestedRepliesRequested, true);
    assert.equal(client.suggestedRepliesPending, false);
    assert.equal(client.suggestedRepliesFailed, true);
    assert.deepEqual(client.suggestedReplies, []);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), false);
  });

  it("settles an empty extraction as terminal failure with no endless poll", async () => {
    seedGreeting();
    let calls = 0;

    scheduleGreetingSuggestedRepliesExtraction(MESSAGE_ID, CHAT_ID, {
      __testExtract: async () => {
        calls += 1;
        return [];
      },
    });

    const pending = loadMessageSuggestedReplies(MESSAGE_ID);
    assert.equal(pending?.pending, true);

    const settled = await waitForSettledRecord();
    assert.equal(calls, 1);
    assert.equal(settled?.pending, false);
    assert.equal(settled?.failed, true);
    assert.deepEqual(settled?.replies, []);

    const client = resolveClientSuggestedReplies(settled);
    assert.equal(client.suggestedRepliesRequested, true);
    assert.equal(client.suggestedRepliesPending, false);
    assert.equal(client.suggestedRepliesFailed, true);
    assert.deepEqual(client.suggestedReplies, []);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), false);
  });
});
