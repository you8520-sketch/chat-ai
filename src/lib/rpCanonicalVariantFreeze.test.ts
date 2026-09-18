import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  executeAtomicVariantSwitchCore,
  getAssistantSourceTurn,
  resolveCanonicalVariantSwitchGate,
} from "@/lib/rpDerivedStateLifecycle";
import { assertS4VariantSwitchAllowed } from "@/lib/knowledgeTransferVariant";
import { isCanonAdoptedScene } from "@/lib/oocSceneRender";

const BASE_CHAT = 957100;
const BASE_USER = 957101;
const BASE_CHAR = 957102;
let testSeq = 0;

function ids() {
  testSeq += 1;
  return { chat: BASE_CHAT + testSeq, user: BASE_USER + testSeq, char: BASE_CHAR + testSeq };
}

function seed(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    userId,
    `freeze-${userId}@test.local`,
    "freeze",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, "FreezeChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "인사.",
    "greeting"
  );
}

function seedTurn(
  db: ReturnType<typeof getDb>,
  chatId: number,
  turn: number,
  opts?: { alternates?: string; activeVariant?: number }
): { userId: number; assistantId: number } {
  const userId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(chatId, "user", `user turn ${turn}`).lastInsertRowid as number;
  const assistantId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id, alternates, active_variant) VALUES (?,?,?,?,'completed',?,?,?)`
    )
    .run(
      chatId,
      "assistant",
      `assistant A turn ${turn}`,
      "test",
      userId,
      opts?.alternates ?? "[]",
      opts?.activeVariant ?? 0
    ).lastInsertRowid as number;
  return { userId, assistantId };
}

function readAssistantRow(db: ReturnType<typeof getDb>, assistantId: number) {
  return db
    .prepare(
      `SELECT content, active_variant, alternates FROM messages WHERE id=?`
    )
    .get(assistantId) as {
    content: string;
    active_variant: number | null;
    alternates: string | null;
  };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("FREEZE-H canonical variant mutation gate", () => {
  it("FREEZE-H1 turn5 A/B + turn6 user accepted → turn5 variant gate rejects (409 contract)", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const db = getDb();
    const variants = JSON.stringify([
      { content: "assistant A turn 5", model: "test", usage: null, created_at: "" },
      { content: "assistant B turn 5", model: "test", usage: null, created_at: "" },
    ]);
    for (let t = 1; t <= 4; t++) seedTurn(db, chat, t);
    const turn5 = seedTurn(db, chat, 5, { alternates: variants, activeVariant: 0 });
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    ).run(chat, "user", "turn 6 user accepted");

    const before = readAssistantRow(db, turn5.assistantId);
    const gate = resolveCanonicalVariantSwitchGate(db, chat, turn5.assistantId);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "variant_switch_frontier_moved");

    const after = readAssistantRow(db, turn5.assistantId);
    assert.equal(after.content, before.content);
    assert.equal(after.active_variant, before.active_variant);
  });

  it("FREEZE-H2 older nonnumeric canonical assistant → historical gate rejects; no raw UPDATE", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const db = getDb();
    seedTurn(db, chat, 1);
    seedTurn(db, chat, 2);
    const turn3 = seedTurn(db, chat, 3);
    seedTurn(db, chat, 4);
    seedTurn(db, chat, 5);

    const gate = resolveCanonicalVariantSwitchGate(db, chat, turn3.assistantId);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "numeric_state_historical_variant_replay_unsupported");

    const before = readAssistantRow(db, turn3.assistantId);
    assert.equal(before.content, "assistant A turn 3");
    assert.equal(before.active_variant, 0);
  });

  it("FREEZE-H3 current canonical frontier → variant switch succeeds", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const db = getDb();
    for (let t = 1; t <= 4; t++) seedTurn(db, chat, t);
    const variants = [
      { content: "assistant A turn 5", model: "test", usage: null, created_at: "" },
      { content: "assistant B turn 5", model: "test", usage: null, created_at: "" },
    ];
    const turn5 = seedTurn(db, chat, 5, {
      alternates: JSON.stringify(variants),
      activeVariant: 0,
    });

    const gate = resolveCanonicalVariantSwitchGate(db, chat, turn5.assistantId);
    assert.equal(gate.allowed, true);

    executeAtomicVariantSwitchCore(db, {
      chatId: chat,
      messageId: turn5.assistantId,
      content: "assistant B turn 5",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      variantsJson: JSON.stringify(variants),
      variantIndex: 1,
      sourceTurn: getAssistantSourceTurn(db, chat, turn5.assistantId) ?? 0,
      characterId: char,
      userId: user,
      selectedFacts: [],
      selectedRequestId: null,
      selectedGenerationSequence: null,
    });

    const after = readAssistantRow(db, turn5.assistantId);
    assert.equal(after.content, "assistant B turn 5");
    assert.equal(after.active_variant, 1);
  });

  it("FREEZE-H4 S4 historical guard remains layered on canonical gate", () => {
    const { chat } = ids();
    const db = getDb();
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
      chat,
      1,
      1
    );
    const a1 = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates) VALUES (?,?,?,?,'completed','[]')`
      )
      .run(chat, "assistant", "a1", "test").lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates) VALUES (?,?,?,?,'completed','[]')`
    ).run(chat, "assistant", "a2", "test");

    assert.doesNotThrow(() =>
      assertS4VariantSwitchAllowed(db, chat, a1, true)
    );
    const gate = resolveCanonicalVariantSwitchGate(db, chat, a1);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "numeric_state_historical_variant_replay_unsupported");
  });

  it("FREEZE-H5 OOC canon-adopted existing rejection preserved", () => {
    const adoptedUsage = JSON.stringify({
      generationKind: "ooc_scene_render",
      canonical: false,
      canonAdopted: true,
    });
    assert.equal(isCanonAdoptedScene(adoptedUsage), true);
  });
});
