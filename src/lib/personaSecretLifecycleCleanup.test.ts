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
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { reconcileS4KnowledgeForVariantSwitch } from "@/lib/knowledgeTransferVariant";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { ensureObserverSchema } from "@/lib/observerSchema";
import {
  deletePersonaSecretActivationRowsForPersona,
  rewindPersonaSecretStateForDeletedMessages,
} from "@/lib/personaSecretLifecycleCleanup";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import {
  ensurePersonaSecretEvidenceActivationSchema,
  insertVariantScopedEvidenceActivation,
} from "@/lib/personaSecretEvidenceActivation";
import { getObserverSecretKnowledge } from "@/lib/personaSecretKnowledge";
import { reprojectObserverSecretKnowledge } from "@/lib/personaSecretKnowledgeReprojection";
import { ensureChatPersonaSecretRevealsSchema } from "@/lib/personaSecretReveal";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";

const USER = 871001;
const CHAR_SENDER = 871002;
const CHAR_RECEIVER = 871003;
const CHAT = 871010;
const PERSONA = 871020;

type FixtureIds = {
  secretId: string;
  userMessageId: number;
  assistantMessageId: number;
};

let ids: FixtureIds = {
  secretId: "",
  userMessageId: 0,
  assistantMessageId: 0,
};

function cleanup() {
  const db = getDb();
  ensurePersonaSecretDiscoverySchema(db);
  ensurePersonaSecretEvidenceActivationSchema(db);
  ensureKnowledgeTransferSchema(db);
  ensureSceneEvidenceSchema(db);
  ensureObserverSchema(db);
  ensureInvestigationSchema(db);
  ensureChatPersonaSecretRevealsSchema(db);
  for (const sql of [
    `DELETE FROM persona_secret_evidence_activation WHERE chat_id=?`,
    `DELETE FROM knowledge_transfer_events WHERE chat_id=?`,
    `DELETE FROM persona_secret_evidence_events WHERE chat_id=?`,
    `DELETE FROM chat_character_secret_knowledge WHERE chat_id=?`,
    `DELETE FROM chat_persona_secret_reveals WHERE chat_id=?`,
    `DELETE FROM scene_evidence_events WHERE chat_id=?`,
    `DELETE FROM scene_observer_presence WHERE chat_id=?`,
    `DELETE FROM chat_scenes WHERE chat_id=?`,
    `DELETE FROM chat_observers WHERE chat_id=?`,
    `DELETE FROM investigation_attempts WHERE chat_id=?`,
    `DELETE FROM messages WHERE chat_id=?`,
    `DELETE FROM chats WHERE id=?`,
  ]) {
    try {
      db.prepare(sql).run(CHAT);
    } catch {
      // ignore
    }
  }
  try {
    db.prepare(
      `DELETE FROM investigation_targets WHERE owner_scope='CHAT' AND owner_id=?`
    ).run(String(CHAT));
  } catch {
    // ignore
  }
  db.prepare(`DELETE FROM persona_secrets WHERE persona_id=?`).run(PERSONA);
  db.prepare(`DELETE FROM user_personas WHERE id=?`).run(PERSONA);
  db.prepare(`DELETE FROM characters WHERE id IN (?,?)`).run(
    CHAR_SENDER,
    CHAR_RECEIVER
  );
  db.prepare(`DELETE FROM users WHERE id=?`).run(USER);
}

function seedChat(): FixtureIds {
  cleanup();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER, `lc-${USER}@test.local`, "lc", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(
    CHAR_SENDER,
    "Sender"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(
    CHAR_RECEIVER,
    "Receiver"
  );
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT, USER, CHAR_SENDER);
  db.prepare(
    `INSERT INTO user_personas (id, user_id, name, description) VALUES (?,?,?,?)`
  ).run(PERSONA, USER, "P", "desc");

  const created = createPersonaSecret({
    personaId: PERSONA,
    secretKey: `lc_${randomUUID().slice(0, 8)}`,
    canonicalSecretText: "HIDDEN",
    confirmedFactText: "secret fact",
    suspectedFactText: "secret fact",
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("secret create failed");

  const userMsg = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status)
       VALUES (?,?,?,?,?)`
    )
    .run(CHAT, "user", "hi", "", "completed");
  const userMessageId = Number(userMsg.lastInsertRowid);
  const asstMsg = db
    .prepare(
      `INSERT INTO messages (
         chat_id, role, content, model, generation_status,
         user_message_id, alternates, active_variant
       ) VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      CHAT,
      "assistant",
      "gen1",
      "",
      "completed",
      userMessageId,
      JSON.stringify([
        { content: "gen0", generationSequence: 0 },
        { content: "gen1", generationSequence: 1 },
      ]),
      1
    );
  const assistantMessageId = Number(asstMsg.lastInsertRowid);
  ids = {
    secretId: created.secret.id,
    userMessageId,
    assistantMessageId,
  };
  return ids;
}

function insertS1EvidenceAndKnowledge(sourceMessageId: number, fact: string) {
  const db = getDb();
  const evidenceId = randomUUID();
  db.prepare(
    `INSERT INTO persona_secret_evidence_events (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       persona_id, secret_id, discovery_rule_id,
       observer_type, observer_id, method, source_type, resulting_state,
       revealed_fact_snapshot, evidence_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    evidenceId,
    `evidence:${evidenceId}`,
    CHAT,
    1,
    sourceMessageId,
    PERSONA,
    ids.secretId,
    null,
    "CHARACTER",
    String(CHAR_RECEIVER),
    "DIRECT_DISCLOSURE",
    "USER",
    "CONFIRMED",
    fact,
    "{}"
  );
  reprojectObserverSecretKnowledge({
    chatId: CHAT,
    personaId: PERSONA,
    secretId: ids.secretId,
    observerType: "CHARACTER",
    observerId: String(CHAR_RECEIVER),
    db,
  });
  return evidenceId;
}

function insertVariantScopedS4(generationSequence: number, fact: string) {
  const db = getDb();
  const transferId = randomUUID();
  const evidenceId = randomUUID();
  db.prepare(
    `INSERT INTO knowledge_transfer_events (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       source_assistant_message_id, source_generation_sequence,
       persona_id, secret_id,
       sender_type, sender_id, receiver_type, receiver_id,
       sender_state_snapshot, resulting_state, fact_snapshot,
       transfer_type, source_type, channel_type, evidence_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    transferId,
    `kte:${transferId}`,
    CHAT,
    1,
    ids.userMessageId,
    ids.assistantMessageId,
    generationSequence,
    PERSONA,
    ids.secretId,
    "CHARACTER",
    String(CHAR_SENDER),
    "CHARACTER",
    String(CHAR_RECEIVER),
    "CONFIRMED",
    "CONFIRMED",
    fact,
    "DIRECT_STATEMENT",
    "SERVER_STRUCTURED_TRANSFER",
    "DIRECT",
    "{}"
  );
  db.prepare(
    `INSERT INTO persona_secret_evidence_events (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       persona_id, secret_id, discovery_rule_id,
       observer_type, observer_id, method, source_type, resulting_state,
       revealed_fact_snapshot, evidence_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    evidenceId,
    `kte:evidence:${evidenceId}`,
    CHAT,
    1,
    ids.userMessageId,
    PERSONA,
    ids.secretId,
    null,
    "CHARACTER",
    String(CHAR_RECEIVER),
    "KNOWLEDGE_TRANSFER",
    "SERVER_STRUCTURED_TRANSFER",
    "CONFIRMED",
    fact,
    "{}"
  );
  insertVariantScopedEvidenceActivation({
    evidenceId,
    chatId: CHAT,
    assistantMessageId: ids.assistantMessageId,
    generationSequence,
    isActive: false,
    db,
  });
  return evidenceId;
}

before(() => {
  seedChat();
});
after(cleanup);

describe("persona secret lifecycle cleanup", () => {
  it("regen reconcile deactivates discarded-gen S4 knowledge when new gen has none", () => {
    seedChat();
    insertVariantScopedS4(0, "fact from gen0");
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE chat_id=? AND assistant_message_id=? AND generation_sequence=0`
    ).run(CHAT, ids.assistantMessageId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    assert.equal(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA,
        secretId: ids.secretId,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      })?.knowledge_state,
      "CONFIRMED"
    );

    db.prepare(`UPDATE messages SET active_variant=1 WHERE id=?`).run(
      ids.assistantMessageId
    );
    reconcileS4KnowledgeForVariantSwitch(db, {
      chatId: CHAT,
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA,
        secretId: ids.secretId,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      }),
      null
    );
    const act = db
      .prepare(
        `SELECT generation_sequence, is_active FROM persona_secret_evidence_activation
         WHERE chat_id=? AND assistant_message_id=?`
      )
      .all(CHAT, ids.assistantMessageId) as Array<{
      generation_sequence: number;
      is_active: number;
    }>;
    assert.equal(act.length, 1);
    assert.equal(act[0]!.generation_sequence, 0);
    assert.equal(act[0]!.is_active, 0);
  });

  it("last-turn rewind removes S1 evidence+knowledge for deleted messages", () => {
    seedChat();
    insertS1EvidenceAndKnowledge(ids.userMessageId, "s1 fact");
    assert.ok(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA,
        secretId: ids.secretId,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      })
    );

    executeLastTurnDeleteTransaction(getDb(), {
      chatId: CHAT,
      characterId: CHAR_SENDER,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      revertNumeric: false,
    });

    assert.equal(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=?`
          )
          .get(CHAT) as { c: number }
      ).c,
      0
    );
    assert.equal(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA,
        secretId: ids.secretId,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      }),
      null
    );
  });

  it("last-turn rewind removes variant-scoped S4 transfer+activation", () => {
    seedChat();
    insertVariantScopedS4(0, "s4 fact");
    getDb()
      .prepare(
        `UPDATE persona_secret_evidence_activation SET is_active=1
         WHERE chat_id=? AND assistant_message_id=?`
      )
      .run(CHAT, ids.assistantMessageId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
    });

    rewindPersonaSecretStateForDeletedMessages(getDb(), {
      chatId: CHAT,
      messageIds: [ids.userMessageId, ids.assistantMessageId],
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`
          )
          .get(CHAT) as { c: number }
      ).c,
      0
    );
    assert.equal(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE chat_id=?`
          )
          .get(CHAT) as { c: number }
      ).c,
      0
    );
    assert.equal(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA,
        secretId: ids.secretId,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      }),
      null
    );
  });

  it("chat delete wipes persona-secret/scene/investigation derived rows", () => {
    seedChat();
    insertS1EvidenceAndKnowledge(ids.userMessageId, "keep?");
    const db = getDb();
    const sceneId = randomUUID();
    db.prepare(
      `INSERT INTO chat_scenes (id, chat_id, status, started_turn) VALUES (?,?,?,?)`
    ).run(sceneId, CHAT, "ACTIVE", 1);
    db.prepare(
      `INSERT INTO chat_observers (chat_id, observer_type, observer_id, canonical_source_type)
       VALUES (?,?,?,?)`
    ).run(CHAT, "CHARACTER", String(CHAR_RECEIVER), "CHARACTER");
    db.prepare(
      `INSERT INTO scene_observer_presence (
         scene_id, chat_id, observer_type, observer_id,
         presence_state, awareness_state, source_type
       ) VALUES (?,?,?,?,?,?,?)`
    ).run(
      sceneId,
      CHAT,
      "CHARACTER",
      String(CHAR_RECEIVER),
      "PRESENT",
      "AWARE",
      "BOOTSTRAP"
    );
    const targetId = randomUUID();
    db.prepare(
      `INSERT INTO investigation_targets (
         id, owner_scope, owner_id, target_type, target_key
       ) VALUES (?,?,?,?,?)`
    ).run(targetId, "CHAT", String(CHAT), "DOCUMENT", "doc-1");

    deleteChatOwnedDerivedRows(db, CHAT, USER);

    for (const [label, sql] of [
      [
        "evidence",
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=?`,
      ],
      [
        "knowledge",
        `SELECT COUNT(*) AS c FROM chat_character_secret_knowledge WHERE chat_id=?`,
      ],
      ["scenes", `SELECT COUNT(*) AS c FROM chat_scenes WHERE chat_id=?`],
      ["observers", `SELECT COUNT(*) AS c FROM chat_observers WHERE chat_id=?`],
      [
        "presence",
        `SELECT COUNT(*) AS c FROM scene_observer_presence WHERE chat_id=?`,
      ],
    ] as const) {
      assert.equal((db.prepare(sql).get(CHAT) as { c: number }).c, 0, label);
    }
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM investigation_targets
             WHERE owner_scope='CHAT' AND owner_id=?`
          )
          .get(String(CHAT)) as { c: number }
      ).c,
      0
    );
  });

  it("persona activation cleanup removes overlay rows before evidence wipe", () => {
    seedChat();
    const evidenceId = insertVariantScopedS4(0, "act");
    assert.equal(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation
             WHERE evidence_id=?`
          )
          .get(evidenceId) as { c: number }
      ).c,
      1
    );
    deletePersonaSecretActivationRowsForPersona(getDb(), PERSONA);
    assert.equal(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation
             WHERE evidence_id=?`
          )
          .get(evidenceId) as { c: number }
      ).c,
      0
    );
  });

  it("route wiring calls regen reconcile after S4 commit block", () => {
    const src = readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.match(src, /reconcileS4KnowledgeForVariantSwitch/);
    assert.match(
      src,
      /if \(regenerateMessageId\) \{\s*try \{\s*reconcileS4KnowledgeForVariantSwitch/s
    );
    const commitIdx = src.indexOf("commitAcceptedAssistantS4Transfers");
    const reconcileIdx = src.indexOf(
      "reconcileS4KnowledgeForVariantSwitch(db, {\n                chatId: chatRef.id,\n                assistantMessageId: regenerateMessageId,"
    );
    assert.ok(commitIdx > 0 && reconcileIdx > commitIdx);
  });
});
