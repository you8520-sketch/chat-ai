/**
 * Phase B1-D2 — LTM parity after variant switch (LLM=0).
 *
 * REJECTED VARIANT MUST NOT RE-ENTER CANON THROUGH LONG-TERM SUMMARY
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
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getOrCreateChatMemory } from "./memory-db";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import { reconcileMemoryAfterVariantSwitch } from "./memory-variant-switch-reconcile";

const CHAT = 910921;
const USER = 910922;
const CHAR = 910923;

const SUMMARY_WITH_D =
  "본편에서 분노_D_골목 사건이 발생했다 → 인물이 격하게 반응하며 관계를 흔들었다 → " +
  "거절된 세계선 D의 단서가 요약에 남았다 → 장면을 정리하며 다음 만남을 예고했다.";

const SUMMARY_PRIOR =
  "본편에서 이전 약속이 유지되었다 → 인물이 차분히 대화를 이어갔다 → " +
  "관계 흐름이 안정되며 둘만의 규칙을 확인했다 → 이별 전 장면을 정리했다.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedChat() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `b1d2-ltm-${USER}@test.local`,
    "b1d2-ltm",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "B1D2Ltm");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary, memory) VALUES (?,?,?,'safe','','')`
  ).run(CHAT, USER, CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

describe("Phase B1-D2 — LTM reconcile after variant switch", () => {
  beforeEach(() => {
    seedChat();
  });
  afterEach(() => {
    cleanup();
  });

  it("V25: summary covering source turn with rejected D is inactivated (LLM=0)", () => {
    const db = getDb();
    // playable turns 1..2 so sourceTurn=2 is covered by batch 1..6 cadence fixture
    for (let i = 1; i <= 2; i++) {
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
      ).run(CHAT, "user", `u${i}`, "");
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
      ).run(CHAT, "assistant", i === 2 ? "D prose rejected worldline" : `a${i}`, "test");
    }

    const prior = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: SUMMARY_PRIOR,
      playableTurnCount: 8,
    });
    assert.equal(prior.ok, true);

    // Force a summary record that covers turn 2 with D contamination
    // (simulates rolling summary sealed while D was active).
    db.prepare(
      `UPDATE chat_turn_summaries SET summary=?, inactive=0, updated_at=datetime('now')
       WHERE chat_id=? AND turn_number=1`
    ).run(SUMMARY_WITH_D, CHAT);
    db.prepare(
      `UPDATE chat_memories SET recent_summary=?, updated_at=datetime('now') WHERE chat_id=?`
    ).run(SUMMARY_WITH_D, CHAT);
    db.prepare(`UPDATE chats SET memory=?, current_summary=? WHERE id=?`).run(
      SUMMARY_WITH_D,
      SUMMARY_WITH_D,
      CHAT
    );

    const beforeVisible = listVisibleMemoryRecordsForChat(CHAT);
    assert.ok(beforeVisible.some((r) => r.summary.includes("분노_D_골목")));

    const result = reconcileMemoryAfterVariantSwitch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      sourceTurn: 2,
    });

    assert.equal(result.attempted, true);
    assert.ok(result.inactivatedRecordIds.length >= 1);

    const all = listMemoryRecordsForChat(CHAT);
    const covering = all.filter((r) => r.turnStart <= 2 && r.turnEnd >= 2);
    assert.ok(covering.every((r) => r.inactive), "covering summary must be inactive");

    const visible = listVisibleMemoryRecordsForChat(CHAT);
    assert.ok(
      !visible.some((r) => r.summary.includes("분노_D_골목")),
      "rejected D must not remain in visible LTM records"
    );

    const lorebook = rebuildLorebookFromRecords(CHAT);
    assert.ok(
      !lorebook.includes("분노_D_골목"),
      "rejected D must not remain in rebuilt lorebook"
    );

    const chatMem = db
      .prepare(`SELECT memory, current_summary FROM chats WHERE id=?`)
      .get(CHAT) as { memory: string; current_summary: string };
    assert.ok(!String(chatMem.memory ?? "").includes("분노_D_골목"));
    assert.ok(!String(chatMem.current_summary ?? "").includes("분노_D_골목"));

    const recent = db
      .prepare(`SELECT recent_summary AS r FROM chat_memories WHERE chat_id=?`)
      .get(CHAT) as { r: string };
    assert.ok(!String(recent.r ?? "").includes("분노_D_골목"));
  });
});
