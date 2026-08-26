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
  detectRelationshipLedgerOwnedFact,
  episodicMemoryRecallEnabled,
  persistEpisodicMemoryFactsBestEffort,
  resolveEpisodicMemoryMinAgeTurns,
} from "@/lib/episodicMemoryFacts";
import { EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS } from "@/lib/statusWidget/prompt";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import {
  EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH,
  __getEpisodicExtractCallCountForTests,
  __resetEpisodicExtractCallCountForTests,
  __setEpisodicExtractCallerForTests,
  extractAndPersistEpisodicFactsForSealedBatch,
} from "./memory-episodic-extract";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { getOrCreateChatMemory } from "./memory-db";

const CHAT = 870011;
const USER = 870012;
const CHAR = 870013;

const VALID_FACT = {
  category: "preference" as const,
  subject: "user",
  attribute: "favorite_drink",
  value: "syrup_coffee",
  importance: "important" as const,
  fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
  evidence_type: "explicit_user_statement" as const,
};

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

before(() => {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `ep-${USER}@test.local`,
    "ep",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EpChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
});

after(() => {
  __setEpisodicExtractCallerForTests(null);
  cleanup();
});

describe("episodic ownership decoupled from status widget", () => {
  it("seal extract persists facts without a status widget", async () => {
    getDb().prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
    __resetEpisodicExtractCallCountForTests();
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [VALID_FACT] }),
    }));
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EpChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "유저: 커피에 시럽을 두 번 넣어.\n캐릭터: 알겠어.",
      sourceUserMessageId: null,
    });
    assert.equal(result.calls, 1);
    assert.ok(result.persisted >= 1);
    const n = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    assert.ok(n >= 1);
    assert.equal(EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH, 1);
    assert.equal(__getEpisodicExtractCallCountForTests(), 1);
  });

  it("status inactive does not disable recall defaults", () => {
    assert.equal(
      episodicMemoryRecallEnabled({
        NODE_ENV: "production",
        MEMORY_FEATURE_ENABLED: "1",
      } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      episodicMemoryRecallEnabled({
        NODE_ENV: "production",
        MEMORY_FEATURE_ENABLED: "0",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      episodicMemoryRecallEnabled({
        NODE_ENV: "production",
        EPISODIC_MEMORY_RECALL_DISABLED: "1",
      } as NodeJS.ProcessEnv),
      false
    );
  });

  it("default min age is 5 so RAW4 and episodic do not overlap", () => {
    assert.equal(resolveEpisodicMemoryMinAgeTurns({} as NodeJS.ProcessEnv), 5);
    const currentTurn = 10;
    assert.equal(currentTurn - 5, 5);
  });

  it("promises and items stay relationship-ledger owned", () => {
    assert.equal(
      detectRelationshipLedgerOwnedFact({
        category: "relationship",
        attribute: "promise",
        value: "return",
        fact_text: "그는 돌아오겠다고 약속했다.",
      }),
      "relationship_ledger_promise"
    );
    assert.equal(
      detectRelationshipLedgerOwnedFact({
        category: "item",
        attribute: "ownership",
        value: "dagger",
        fact_text: "사용자는 단검을 획득했다.",
      }),
      "relationship_ledger_item"
    );
  });

  it("status prompt no longer owns long episodic instructions", () => {
    assert.doesNotMatch(
      EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS,
      /Every STATUS_VALUES JSON object MUST include/
    );
    assert.match(EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS, /Do not produce long-term episodic/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Relationship Durable Ledger/);
    assert.ok(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.length > EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS.length);
  });

  it("failed episodic extract does not roll back a sealed summary", async () => {
    const sealed = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary:
        "레온은 정원에서 렌을 만나 약속을 나눴다. 커프링크스를 건네고 다음을 기약했다.",
      playableTurnCount: 5,
    });
    assert.equal(sealed.ok, true);
    __setEpisodicExtractCallerForTests(async () => {
      throw new Error("provider 503");
    });
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EpChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "유저: 안녕\n캐릭터: 안녕",
    });
    assert.equal(result.persisted, 0);
    const summaries = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    assert.ok(summaries >= 1);
  });
});
