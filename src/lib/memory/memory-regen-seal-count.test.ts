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
import { getOrCreateChatMemory } from "./memory-db";
import { syncMemoryEligibleTurnCount } from "./memory-reconcile";
import { shouldTriggerRollingSummary } from "./memory-rolling-summary";

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

const CHAT_ID = 990088;
const USER_ID = 990088;
const CHAR_ID = 990088;

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedSevenPlayableTurns() {
  const db = getDb();
  cleanup();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER_ID, `regen-seal-${USER_ID}@test.local`, "regen-seal", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT_ID, USER_ID, CHAR_ID);
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
  ).run(CHAT_ID, "assistant", "인사", "greeting");

  for (let t = 1; t <= 7; t++) {
    const userId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`
      )
      .run(CHAT_ID, "user", `유저 ${t}`).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
    ).run(CHAT_ID, "assistant", `${FIXTURE} (턴 ${t})`, userId);
  }
}

describe("syncMemoryEligibleTurnCount + regen seal gate", () => {
  before(() => seedSevenPlayableTurns());
  after(() => cleanup());

  it("syncs message_count from eligible turns and enables seal at turn 6 after stale count", () => {
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
    getDb()
      .prepare(`UPDATE chat_memories SET message_count=5, summarized_turn_count=0 WHERE chat_id=?`)
      .run(CHAT_ID);

    const count = syncMemoryEligibleTurnCount({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
    });
    assert.equal(count, 7);
    assert.equal(shouldTriggerRollingSummary(count, 0), true);

    assert.equal(shouldTriggerRollingSummary(6, 0), true);
    assert.equal(shouldTriggerRollingSummary(5, 0), false);
  });
});
