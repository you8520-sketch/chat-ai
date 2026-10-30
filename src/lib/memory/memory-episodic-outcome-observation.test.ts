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
  describeSharedEpisodicTurnOutcome,
  parseSharedEpisodicSection,
  type EpisodicSectionParse,
  type SharedEpisodicTurnOutcome,
} from "./memory-episodic-shared";
import { scheduleMemoryUpdate } from "./memory-manager";
import { getOrCreateChatMemory } from "./memory-db";

const USER = 920101;
const CHAR = 920103;
const CHAT_BASE = 920200;
const OUTCOME_TAG = "[memory] shared episodic outcome";

const USER_TEXT = "나 이만 가볼게.";
const ASSISTANT_TEXT = '에녹이 문을 잠갔다. "가지 마."';

const VALID_FACT = {
  category: "character",
  subject: "enoch",
  attribute: "action",
  value: "locked_door",
  importance: "important",
  fact_text: "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.",
  evidence_type: "explicit_scene_event",
  evidence: { source_role: "assistant", source_quote: "에녹이 문을 잠갔다." },
};

type OutcomeLog = SharedEpisodicTurnOutcome & {
  chat_id: number;
  assistant_message_id: number;
  regenerate: boolean;
  content_route: string | null;
  index?: { status: string; requested: number; written: number };
};

let chatCounter = 0;

function seedChat() {
  const db = getDb();
  chatCounter += 1;
  const chatId = CHAT_BASE + chatCounter;
  const userMessageId = chatId * 10 + 1;
  const assistantMessageId = chatId * 10 + 2;
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    userMessageId,
    chatId,
    "user",
    USER_TEXT
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model')`
  ).run(assistantMessageId, chatId, ASSISTANT_TEXT, userMessageId);
  return { chatId, userMessageId, assistantMessageId };
}

function storedFactCount(chatId: number): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=?")
      .get(chatId) as { c: number }
  ).c;
}

async function runTurn(opts: {
  episodic: EpisodicSectionParse | null;
  episodicSharedAttempted: boolean;
  seed?: ReturnType<typeof seedChat>;
}): Promise<{ log: OutcomeLog; raw: unknown[]; chatId: number }> {
  const turn = opts.seed ?? seedChat();
  const captured: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    await scheduleMemoryUpdate({
      chatId: turn.chatId,
      userId: USER,
      characterId: CHAR,
      relationshipNames: { charName: "ObsChar", userName: "유저" } as never,
      tier: "free",
      memoryCapacity: 10000,
      userMessage: USER_TEXT,
      assistantMessage: ASSISTANT_TEXT,
      assistantMessageId: turn.assistantMessageId,
      sourceUserMessageId: turn.userMessageId,
      relationshipSharedAttempted: true,
      relationshipSharedParsed: false,
      episodicExtraction: opts.episodicSharedAttempted
        ? Promise.resolve({ status: "extracted" as const, episodic: opts.episodic })
        : undefined,
      route: "safe",
    });
  } finally {
    console.info = originalInfo;
  }
  const lines = captured.filter((args) => args[0] === OUTCOME_TAG);
  assert.equal(lines.length, 1, "exactly one outcome line per turn");
  return { log: lines[0]![1] as OutcomeLog, raw: lines[0]!, chatId: turn.chatId };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

before(() => {
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `obs-${USER}@test.local`,
    "obs",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ObsChar");
});

after(() => {
  const db = getDb();
  const chatIds = (
    db.prepare("SELECT id FROM chats WHERE user_id=?").all(USER) as { id: number }[]
  ).map((row) => row.id);
  for (const id of chatIds) {
    db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chats WHERE id=?").run(id);
  }
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
});

describe("B24 episodic outcome observation (production commit entry)", () => {
  it("1. episodic not requested/attempted → reconcile not called", async () => {
    const { log, chatId } = await runTurn({ episodic: null, episodicSharedAttempted: false });
    assert.equal(log.reconcileCalled, false);
    assert.equal(log.sectionAvailable, false);
    assert.equal(log.reconcile, null);
    assert.equal(log.index, undefined);
    assert.equal(storedFactCount(chatId), 0);
  });

  it("2/3a. attempted but no parsed section reached memory → section unavailable", async () => {
    const { log, chatId } = await runTurn({ episodic: null, episodicSharedAttempted: true });
    assert.equal(log.reconcileCalled, true);
    assert.equal(log.sectionAvailable, false);
    assert.equal(log.reconcile?.skipped, true);
    assert.equal(log.reconcile?.inserted, 0);
    assert.equal(storedFactCount(chatId), 0);
  });

  it("3b. section missing from model JSON → present=false", async () => {
    const { log } = await runTurn({
      episodic: parseSharedEpisodicSection(undefined),
      episodicSharedAttempted: true,
    });
    assert.equal(log.sectionAvailable, true);
    assert.equal(log.sectionPresent, false);
    assert.equal(log.sectionValid, false);
    assert.equal(log.rawFactCount, null);
    assert.equal(log.reconcile?.skipped, true);
  });

  it("3c. malformed section (no extracted_facts array) → present, invalid, rawFactCount null", async () => {
    const { log } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: "none" }),
      episodicSharedAttempted: true,
    });
    assert.equal(log.sectionPresent, true);
    assert.equal(log.sectionValid, false);
    assert.equal(log.rawFactCount, null);
    assert.equal(log.reconcile?.skipped, true);
  });

  it("4. valid empty array → valid, raw 0, normal skip", async () => {
    const { log, chatId } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: [] }),
      episodicSharedAttempted: true,
    });
    assert.equal(log.sectionValid, true);
    assert.equal(log.rawFactCount, 0);
    assert.equal(log.validFactCount, 0);
    assert.equal(log.reconcile?.skipped, true);
    assert.equal(storedFactCount(chatId), 0);
  });

  it("5. facts returned but all dropped in validation → raw>0, invalid, valid=0", async () => {
    const withoutEvidence = { ...VALID_FACT, evidence: undefined };
    const { log, chatId } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: [withoutEvidence] }),
      episodicSharedAttempted: true,
    });
    assert.equal(log.sectionPresent, true);
    assert.equal(log.sectionValid, false);
    assert.equal(log.rawFactCount, 1);
    assert.equal(log.validFactCount, 0);
    assert.equal(log.reconcile?.skipped, true);
    assert.equal(storedFactCount(chatId), 0);
  });

  it("6. valid fact excluded at storage boundary (stale source) → valid>0, skipped", async () => {
    const turn = seedChat();
    getDb()
      .prepare("UPDATE messages SET generation_status='failed' WHERE id=?")
      .run(turn.assistantMessageId);
    const { log, chatId } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      episodicSharedAttempted: true,
      seed: turn,
    });
    assert.equal(log.sectionValid, true);
    assert.equal(log.rawFactCount, 1);
    assert.equal(log.validFactCount, 1);
    assert.equal(log.reconcile?.inserted, 0);
    assert.equal(storedFactCount(chatId), 0);
  });

  it("7. valid fact stored → inserted=1 and index state reported (disabled without runtime)", async () => {
    const { log, chatId } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      episodicSharedAttempted: true,
    });
    assert.equal(log.sectionValid, true);
    assert.equal(log.validFactCount, 1);
    assert.equal(log.reconcile?.inserted, 1);
    assert.equal(log.reconcile?.skipped, false);
    assert.equal(storedFactCount(chatId), 1);
    assert.equal(log.content_route, "safe");
    assert.ok(log.index);
    assert.equal(typeof log.index?.status, "string");
  });

  it("outcome line carries counts/booleans only — no message or fact text", async () => {
    const { raw } = await runTurn({
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      episodicSharedAttempted: true,
    });
    const serialized = JSON.stringify(raw);
    assert.ok(!serialized.includes(VALID_FACT.fact_text));
    assert.ok(!serialized.includes(VALID_FACT.evidence.source_quote));
    assert.ok(!serialized.includes(USER_TEXT));
    assert.ok(!serialized.includes("에녹이"));
  });

  it("describeSharedEpisodicTurnOutcome is pure and total over null/undefined", () => {
    const outcome = describeSharedEpisodicTurnOutcome({
      reconcileCalled: false,
      episodic: undefined,
      reconcile: null,
    });
    assert.deepEqual(outcome, {
      reconcileCalled: false,
      sectionAvailable: false,
      sectionPresent: false,
      sectionValid: false,
      rawFactCount: null,
      validFactCount: 0,
      reconcile: null,
    });
  });
});
