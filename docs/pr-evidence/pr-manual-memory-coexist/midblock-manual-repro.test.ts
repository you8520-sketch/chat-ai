/**
 * Fail-before reproduction: manual Global saved mid 5-turn block (T12)
 * then T11–15 is sealed as one record.
 * Uses the live owners (updateLorebookForChat, catchUpRollingSummaries,
 * buildMemoryContextForChat). Zero provider calls — summarizer is stubbed.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { MEMORY_CAPACITY_FIXED } from "@/lib/memory/memory-capacity-shared";
import { getChatMemoryRow, getOrCreateChatMemory, updateChatMemory } from "@/lib/memory/memory-db";
import { buildMemoryContextForChat, updateLorebookForChat } from "@/lib/memory/memory-manager";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
} from "@/lib/memory/memory-rolling-summary";
import { listMemoryRecordsForChat } from "@/lib/memory/memory-turn-summary";

const CHAT = 997201;
const USER = 997202;
const CHAR = 997203;
const MANUAL =
  "USER_MANUAL_GLOBAL — 한강 약속은 취소되었으며 현재 유효하지 않다.";
const HANGANG_ACTIVE = "한강 약속은 현재 유효하다";
const NEW_EVENT = "청동열쇠를 공동 보관함 3번에 맡겼다";

const sealOpts = {
  chatId: CHAT,
  userId: USER,
  characterId: CHAR,
  charName: "MidblockChar",
  tier: "free" as const,
  memoryCapacity: MEMORY_CAPACITY_FIXED,
  maxRounds: 12,
};

let nextTurn = 1;

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
}

function seed(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `midblock-${USER}@test.local`,
    "midblock-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "MidblockChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  nextTurn = 1;
}

function playTurn(userText: string, assistantText: string): void {
  const db = getDb();
  const userMsgId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(CHAT, "user", userText).lastInsertRowid as number;
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
  ).run(CHAT, "assistant", assistantText, "test", userMsgId);
  nextTurn += 1;
  updateChatMemory(CHAT, USER, CHAR, { message_count: nextTurn - 1 });
}

function playGenericThrough(lastTurn: number): void {
  for (; nextTurn <= lastTurn; ) {
    playTurn(`본편 턴 ${nextTurn}`, `응답 ${nextTurn}`);
  }
}

async function seal(): Promise<void> {
  while ((await catchUpRollingSummaries(sealOpts)) >= sealOpts.maxRounds) {
    /* drain */
  }
}

async function wire() {
  return buildMemoryContextForChat({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: "이어서 진행해줘",
  });
}

function dump(label: string, injection: Awaited<ReturnType<typeof wire>>): void {
  const row = getChatMemoryRow(CHAT)!;
  const records = listMemoryRecordsForChat(CHAT).map((r) => ({
    start: r.turnStart,
    end: r.turnEnd,
    inactive: r.inactive,
    summary: r.summary,
  }));
  console.log(`\n===== ${label} =====`);
  console.log(
    JSON.stringify(
      {
        kind: row.global_projection_kind,
        coveredThroughTurn: row.global_covered_through_turn,
        summarizedTurnCount: row.summarized_turn_count,
        globalText: injection.text,
        mediumTermText: injection.mediumTermText,
        records,
      },
      null,
      2
    )
  );
}

before(() => installIsolatedTestDatabase());
after(() => {
  cleanup();
  uninstallIsolatedTestDatabase();
});

describe("mid-block manual Global vs later T11-15 seal", () => {
  it("T12 correction must not be contradicted by T11-15 Medium, and T13-15 must survive RAW expiry", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "1";
    seed();
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      const blob = history.map((h) => h.content).join("\n");
      const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(blob);
      const bits = [`AUTO_T${m?.[1]}_${m?.[2]}`];
      if (blob.includes(HANGANG_ACTIVE)) bits.push(`FACT_${HANGANG_ACTIVE}`);
      if (blob.includes(NEW_EVENT)) bits.push(`FACT_${NEW_EVENT}`);
      let text = bits.join(" → ");
      while (text.length < 200) text += " → pad";
      return { text };
    });
    __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));

    playGenericThrough(11);
    await seal();
    assert.deepEqual(
      listMemoryRecordsForChat(CHAT).map((r) => r.turnStart),
      [1, 6]
    );

    playTurn(`T12 ${HANGANG_ACTIVE}`, `T12 응답 ${HANGANG_ACTIVE}`);
    await updateLorebookForChat(CHAT, USER, CHAR, MANUAL, "free", MEMORY_CAPACITY_FIXED);
    const afterSave = await wire();
    dump("AFTER_SAVE_T12", afterSave);
    assert.equal(getChatMemoryRow(CHAT)!.recent_summary, MANUAL);
    assert.equal(afterSave.text.includes(HANGANG_ACTIVE), false, "right after save: Global is the correction");
    assert.equal(afterSave.mediumTermText, "", "right after save: no post-edit record yet");

    playTurn(`T13 ${NEW_EVENT}`, `T13 응답 ${NEW_EVENT}`);
    playTurn(`T14 ${NEW_EVENT}`, `T14 응답 ${NEW_EVENT}`);
    playTurn(`T15 ${NEW_EVENT}`, `T15 응답 ${NEW_EVENT}`);
    playGenericThrough(16);
    await seal();
    const at16 = await wire();
    dump("T16_AFTER_SEAL_T11_15", at16);

    playGenericThrough(21);
    await seal();
    const at21 = await wire();
    dump("T21_RAW_EXPIRED", at21);

    __setSummarizeTurnBatchCallerForTests(null);
    __setCompactCurrentMemoryTestOverride(null);

    assert.equal(getChatMemoryRow(CHAT)!.recent_summary, MANUAL, "manual body must stay");
    const t16all = `${at16.text}\n${at16.mediumTermText}`;
    const t21all = `${at21.text}\n${at21.mediumTermText}`;
    assert.equal(
      t16all.includes(`FACT_${HANGANG_ACTIVE}`),
      false,
      "T16: auto memory must not re-assert the cancelled promise as current"
    );
    assert.match(t16all, new RegExp(NEW_EVENT));
    assert.equal(t21all.includes(`FACT_${HANGANG_ACTIVE}`), false, "T21: still no contradiction");
    assert.match(t21all, new RegExp(NEW_EVENT), "T21: T13-15 new event still rememberable after RAW expiry");
  });
});
