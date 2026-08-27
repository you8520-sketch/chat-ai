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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import {
  reconcileS4KnowledgeForVariantSwitch,
} from "@/lib/knowledgeTransferVariant";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import {
  buildPresentedDocumentTargetKey,
  registerPresentedDocumentTarget,
} from "@/lib/investigationTargets";
import { ensureObserverSchema } from "@/lib/observerSchema";
import {
  deletePersonaSecretActivationRowsForPersona,
  deleteTrueOrphanPersonaSecretActivations,
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
import { deletePersonaSecretData } from "@/lib/personaSaveWithSecrets";
import { executeAtomicNumericAssistantFinalize } from "@/lib/rpNumericState/canonicalFinalize";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import { executeAtomicRegenerationFinalize } from "@/lib/streamingPersistence";

const USER = 871001;
const CHAR_SENDER = 871002;
const CHAR_RECEIVER = 871003;
const CHAT = 871010;
const PERSONA = 871020;
const PERSONA_B = 871021;

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
    `DELETE FROM investigation_results WHERE chat_id=?`,
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
  db.prepare(`DELETE FROM persona_secrets WHERE persona_id=?`).run(PERSONA_B);
  db.prepare(`DELETE FROM user_personas WHERE id=?`).run(PERSONA);
  db.prepare(`DELETE FROM user_personas WHERE id=?`).run(PERSONA_B);
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

function insertDiscoveryEvidenceAndKnowledge(
  sourceMessageId: number,
  fact: string,
  method:
    | "DIRECT_DISCLOSURE"
    | "VISUAL_DISCOVERY"
    | "INVESTIGATION_DISCOVERY" = "DIRECT_DISCLOSURE"
) {
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
    method,
    method === "VISUAL_DISCOVERY"
      ? "USER_MESSAGE_VISUAL"
      : method === "INVESTIGATION_DISCOVERY"
        ? "USER_MESSAGE_INVESTIGATION"
        : "USER_MESSAGE_DETERMINISTIC",
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

function insertVariantScopedS4(
  generationSequence: number,
  fact: string,
  sourceMessageId: number | null = ids.userMessageId,
  personaId = PERSONA,
  secretId = ids.secretId
) {
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
    sourceMessageId,
    ids.assistantMessageId,
    generationSequence,
    personaId,
    secretId,
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
    sourceMessageId,
    personaId,
    secretId,
    null,
    "CHARACTER",
    String(CHAR_RECEIVER),
    "KNOWLEDGE_TRANSFER",
    "SERVER_STRUCTURED_TRANSFER",
    "CONFIRMED",
    fact,
    JSON.stringify({ knowledgeTransferEventId: transferId })
  );
  insertVariantScopedEvidenceActivation({
    evidenceId,
    chatId: CHAT,
    assistantMessageId: ids.assistantMessageId,
    generationSequence,
    isActive: false,
    db,
  });
  return { evidenceId, transferId };
}

function prepareGen0Regeneration() {
  const db = getDb();
  const alternates = JSON.stringify([
    { content: "gen0", generationSequence: 0 },
  ]);
  db.prepare(
    `UPDATE messages
     SET content='gen0', alternates=?, active_variant=0,
         generation_status='generating'
     WHERE id=? AND chat_id=?`
  ).run(alternates, ids.assistantMessageId, CHAT);
  return {
    assistantMessageId: ids.assistantMessageId,
    chatId: CHAT,
    content: "gen1",
    model: "test",
    usageJson: "{}",
    alternatesJson: JSON.stringify([
      { content: "gen0", generationSequence: 0 },
      { content: "gen1", generationSequence: 1 },
    ]),
    activeVariant: 1,
    generationStatus: "completed" as const,
  };
}

function knowledge() {
  return getObserverSecretKnowledge({
    chatId: CHAT,
    personaId: PERSONA,
    secretId: ids.secretId,
    observerType: "CHARACTER",
    observerId: String(CHAR_RECEIVER),
  });
}

function insertDocumentPresentation(
  sourceMessageId: number,
  label: string,
  turnNumber: number
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO scene_evidence_events (
         id, idempotency_key, chat_id, turn_number, source_message_id,
         event_type, subject_type, subject_id, source_type, confidence,
         attributes_json, visibility_json, extractor_version
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      `scene:${id}`,
      CHAT,
      turnNumber,
      sourceMessageId,
      "DOCUMENT_PRESENTED",
      "DOCUMENT",
      label,
      "USER_MESSAGE_DETERMINISTIC",
      100,
      JSON.stringify({ documentLabel: label }),
      "{}",
      1
    );
  registerPresentedDocumentTarget({
    chatId: CHAT,
    documentLabel: label,
    payload: {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "VERIFIED",
      resultTags: [],
      observableFacts: [],
    },
  });
  return buildPresentedDocumentTargetKey(label);
}

function insertInvestigationAttemptAndResult(
  sourceMessageId: number,
  targetKey: string
): { attemptId: string; resultId: string } {
  const db = getDb();
  const target = db
    .prepare(
      `SELECT id FROM investigation_targets
       WHERE owner_scope='CHAT' AND owner_id=? AND target_key=?`
    )
    .get(String(CHAT), targetKey) as { id: string };
  const attemptId = randomUUID();
  const resultId = randomUUID();
  db.prepare(
    `INSERT INTO investigation_attempts (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       actor_type, actor_id, target_id, target_type, target_key,
       action_type, source_type, request_json, status
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    attemptId,
    `attempt:${attemptId}`,
    CHAT,
    2,
    sourceMessageId,
    "USER",
    String(USER),
    target.id,
    "DOCUMENT",
    targetKey,
    "READ_DOCUMENT",
    "USER_MESSAGE_INVESTIGATION",
    "{}",
    "SUCCEEDED"
  );
  db.prepare(
    `INSERT INTO investigation_results (
       id, idempotency_key, attempt_id, chat_id, turn_number, target_id,
       result_type, result_state, result_tags_json, observable_facts_json,
       observer_type, observer_id, source_type, confidence, resolver_version
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    resultId,
    `result:${resultId}`,
    attemptId,
    CHAT,
    2,
    target.id,
    "DOCUMENT_CONTENT_VERIFIED",
    "VERIFIED",
    "[]",
    "[]",
    "CHARACTER",
    String(CHAR_RECEIVER),
    "USER_MESSAGE_INVESTIGATION",
    100,
    1
  );
  return { attemptId, resultId };
}

function count(sql: string, ...params: unknown[]): number {
  return (getDb().prepare(sql).get(...params) as { c: number }).c;
}

before(() => {
  seedChat();
});
after(cleanup);

describe("persona secret lifecycle cleanup", () => {
  it("regen S4 remove is atomic and deactivates discarded generation", () => {
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
    assert.equal(knowledge()?.knowledge_state, "CONFIRMED");

    executeAtomicRegenerationFinalize(db, prepareGen0Regeneration());

    assert.equal(knowledge(), null);
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

  it("regen reconcile failure rolls message and S4 worldline fully back", () => {
    seedChat();
    insertVariantScopedS4(0, "fact from gen0");
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE chat_id=? AND assistant_message_id=?`
    ).run(CHAT, ids.assistantMessageId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    const opts = prepareGen0Regeneration();
    const beforeMessage = db
      .prepare(
        `SELECT content, alternates, active_variant, generation_status
         FROM messages WHERE id=?`
      )
      .get(ids.assistantMessageId);
    const beforeActivation = db
      .prepare(
        `SELECT evidence_id, generation_sequence, is_active
         FROM persona_secret_evidence_activation WHERE chat_id=?`
      )
      .all(CHAT);
    const beforeKnowledge = knowledge();

    assert.throws(
      () =>
        executeAtomicRegenerationFinalize(db, {
          ...opts,
          __testThrowAfterS4Reprojection: true,
        }),
      /TEST_THROW_AFTER_S4_REPROJECTION/
    );

    assert.deepEqual(
      db
        .prepare(
          `SELECT content, alternates, active_variant, generation_status
           FROM messages WHERE id=?`
        )
        .get(ids.assistantMessageId),
      beforeMessage
    );
    assert.deepEqual(
      db
        .prepare(
          `SELECT evidence_id, generation_sequence, is_active
           FROM persona_secret_evidence_activation WHERE chat_id=?`
        )
        .all(CHAT),
      beforeActivation
    );
    assert.deepEqual(knowledge(), beforeKnowledge);
  });

  it("numeric regen owner rolls message and S4 worldline back together", () => {
    seedChat();
    insertVariantScopedS4(0, "numeric gen0");
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE chat_id=? AND assistant_message_id=?`
    ).run(CHAT, ids.assistantMessageId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    prepareGen0Regeneration();

    assert.throws(
      () =>
        executeAtomicNumericAssistantFinalize(db, {
          assistantMessageId: ids.assistantMessageId,
          chatId: CHAT,
          characterId: CHAR_SENDER,
          content: "gen1",
          model: "test",
          usageJson: "{}",
          variants: [
            { content: "gen0", generationSequence: 0 },
            { content: "gen1", generationSequence: 1 },
          ],
          activeVariant: 1,
          statusWidgetValues: null,
          characterWidget: null,
          previousCanonicalStatus: null,
          generationSequence: 1,
          isRegeneration: true,
          __testThrowAfterS4Activation: true,
        }),
      /TEST_THROW_AFTER_S4_ACTIVATION/
    );

    const message = db
      .prepare(
        `SELECT content, active_variant, generation_status
         FROM messages WHERE id=?`
      )
      .get(ids.assistantMessageId) as {
      content: string;
      active_variant: number;
      generation_status: string;
    };
    assert.deepEqual(message, {
      content: "gen0",
      active_variant: 0,
      generation_status: "generating",
    });
    assert.equal(
      (
        db
          .prepare(
            `SELECT is_active FROM persona_secret_evidence_activation
             WHERE chat_id=? AND assistant_message_id=?`
          )
          .get(CHAT, ids.assistantMessageId) as { is_active: number }
      ).is_active,
      1
    );
    assert.equal(knowledge()?.fact_snapshot, "numeric gen0");
  });

  it("regen can restore receiver knowledge with a new active transfer", () => {
    seedChat();
    insertVariantScopedS4(0, "gen0 fact");
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE chat_id=? AND assistant_message_id=?`
    ).run(CHAT, ids.assistantMessageId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    executeAtomicRegenerationFinalize(db, prepareGen0Regeneration());
    assert.equal(knowledge(), null);

    const { evidenceId } = insertVariantScopedS4(1, "gen1 fact");
    reconcileS4KnowledgeForVariantSwitch(db, {
      chatId: CHAT,
      assistantMessageId: ids.assistantMessageId,
    });
    assert.equal(knowledge()?.fact_snapshot, "gen1 fact");
    assert.equal(
      (
        db
          .prepare(
            `SELECT is_active FROM persona_secret_evidence_activation
             WHERE evidence_id=?`
          )
          .get(evidenceId) as { is_active: number }
      ).is_active,
      1
    );
  });

  it("last-turn rewind removes S1 evidence+knowledge for deleted messages", () => {
    seedChat();
    insertDiscoveryEvidenceAndKnowledge(ids.userMessageId, "s1 fact");
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

  it("last-turn rewind removes S2 visual evidence and knowledge", () => {
    seedChat();
    insertDiscoveryEvidenceAndKnowledge(
      ids.userMessageId,
      "s2 fact",
      "VISUAL_DISCOVERY"
    );
    executeLastTurnDeleteTransaction(getDb(), {
      chatId: CHAT,
      characterId: CHAR_SENDER,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      revertNumeric: false,
    });
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
         WHERE chat_id=? AND method='VISUAL_DISCOVERY'`,
        CHAT
      ),
      0
    );
    assert.equal(knowledge(), null);
  });

  it("last-turn rewind removes S3 evidence and knowledge", () => {
    seedChat();
    insertDiscoveryEvidenceAndKnowledge(
      ids.userMessageId,
      "s3 fact",
      "INVESTIGATION_DISCOVERY"
    );
    executeLastTurnDeleteTransaction(getDb(), {
      chatId: CHAT,
      characterId: CHAR_SENDER,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      revertNumeric: false,
    });
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
         WHERE chat_id=? AND method='INVESTIGATION_DISCOVERY'`,
        CHAT
      ),
      0
    );
    assert.equal(knowledge(), null);
  });

  it("last-turn rewind removes only deleted-turn S3 attempt/result", () => {
    seedChat();
    const targetKey = insertDocumentPresentation(
      ids.userMessageId,
      "latest-doc",
      2
    );
    const deleted = insertInvestigationAttemptAndResult(
      ids.userMessageId,
      targetKey
    );
    const earlierMessageId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, generation_status)
           VALUES (?,?,?,?)`
        )
        .run(CHAT, "user", "earlier", "completed").lastInsertRowid
    );
    const prior = insertInvestigationAttemptAndResult(
      earlierMessageId,
      targetKey
    );

    rewindPersonaSecretStateForDeletedMessages(getDb(), {
      chatId: CHAT,
      messageIds: [ids.userMessageId, ids.assistantMessageId],
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      count(`SELECT COUNT(*) AS c FROM investigation_attempts WHERE id=?`, deleted.attemptId),
      0
    );
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM investigation_results WHERE id=?`, deleted.resultId),
      0
    );
    // The target became unsupported, so its prior ledger is pruned with it.
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM investigation_attempts WHERE id=?`, prior.attemptId),
      0
    );
  });

  it("first document presentation deletion prunes target and ledger", () => {
    seedChat();
    const targetKey = insertDocumentPresentation(ids.userMessageId, "first-doc", 2);
    insertInvestigationAttemptAndResult(ids.userMessageId, targetKey);
    executeLastTurnDeleteTransaction(getDb(), {
      chatId: CHAT,
      characterId: CHAR_SENDER,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      revertNumeric: false,
    });
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM scene_evidence_events WHERE chat_id=?`, CHAT),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM investigation_targets
         WHERE owner_scope='CHAT' AND owner_id=? AND target_key=?`,
        String(CHAT),
        targetKey
      ),
      0
    );
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM investigation_attempts WHERE chat_id=?`, CHAT),
      0
    );
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM investigation_results WHERE chat_id=?`, CHAT),
      0
    );
  });

  it("repeated document presentation preserves target support", () => {
    seedChat();
    const earlierMessageId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, generation_status)
           VALUES (?,?,?,?)`
        )
        .run(CHAT, "user", "earlier doc", "completed").lastInsertRowid
    );
    const targetKey = insertDocumentPresentation(earlierMessageId, "same-doc", 1);
    insertDocumentPresentation(ids.userMessageId, "same-doc", 2);

    rewindPersonaSecretStateForDeletedMessages(getDb(), {
      chatId: CHAT,
      messageIds: [ids.userMessageId, ids.assistantMessageId],
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      count(`SELECT COUNT(*) AS c FROM scene_evidence_events WHERE chat_id=?`, CHAT),
      1
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM investigation_targets
         WHERE owner_scope='CHAT' AND owner_id=? AND target_key=?`,
        String(CHAT),
        targetKey
      ),
      1
    );
  });

  it("deleting latest document prunes only its target", () => {
    seedChat();
    const earlierMessageId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, generation_status)
           VALUES (?,?,?,?)`
        )
        .run(CHAT, "user", "older doc", "completed").lastInsertRowid
    );
    const olderKey = insertDocumentPresentation(earlierMessageId, "older-doc", 1);
    const latestKey = insertDocumentPresentation(ids.userMessageId, "latest-doc", 2);

    rewindPersonaSecretStateForDeletedMessages(getDb(), {
      chatId: CHAT,
      messageIds: [ids.userMessageId, ids.assistantMessageId],
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM investigation_targets
         WHERE owner_scope='CHAT' AND owner_id=? AND target_key=?`,
        String(CHAT),
        olderKey
      ),
      1
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM investigation_targets
         WHERE owner_scope='CHAT' AND owner_id=? AND target_key=?`,
        String(CHAT),
        latestKey
      ),
      0
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
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events
         WHERE chat_id=? AND method='KNOWLEDGE_TRANSFER'`,
        CHAT
      ),
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

  it("assistant provenance removes NULL-source S4 evidence without resurrection", () => {
    seedChat();
    const { evidenceId } = insertVariantScopedS4(0, "null-source", null);
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE evidence_id=?`
    ).run(evidenceId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    assert.equal(knowledge()?.knowledge_state, "CONFIRMED");

    rewindPersonaSecretStateForDeletedMessages(db, {
      chatId: CHAT,
      messageIds: [ids.assistantMessageId],
      assistantMessageId: ids.assistantMessageId,
    });

    assert.equal(
      count(`SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`, CHAT),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE id=?`,
        evidenceId
      ),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE evidence_id=?`,
        evidenceId
      ),
      0
    );
    assert.equal(knowledge(), null);
  });

  it("last-turn failure after worldline rewind rolls back every mutation", () => {
    seedChat();
    insertDiscoveryEvidenceAndKnowledge(ids.userMessageId, "rollback s1");
    const { evidenceId } = insertVariantScopedS4(0, "rollback s4", null);
    const targetKey = insertDocumentPresentation(ids.userMessageId, "rollback-doc", 2);
    insertInvestigationAttemptAndResult(ids.userMessageId, targetKey);
    const db = getDb();
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE evidence_id=?`
    ).run(evidenceId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA,
      secretId: ids.secretId,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });
    const snapshot = () => ({
      messages: db
        .prepare(
          `SELECT id, content, alternates, active_variant FROM messages
           WHERE chat_id=? ORDER BY id`
        )
        .all(CHAT),
      evidence: db
        .prepare(
          `SELECT id, source_message_id, evidence_json
           FROM persona_secret_evidence_events WHERE chat_id=? ORDER BY id`
        )
        .all(CHAT),
      transfers: db
        .prepare(`SELECT id FROM knowledge_transfer_events WHERE chat_id=? ORDER BY id`)
        .all(CHAT),
      activations: db
        .prepare(
          `SELECT evidence_id, is_active
           FROM persona_secret_evidence_activation WHERE chat_id=? ORDER BY evidence_id`
        )
        .all(CHAT),
      knowledge: db
        .prepare(
          `SELECT * FROM chat_character_secret_knowledge WHERE chat_id=?
           ORDER BY persona_id, secret_id, observer_id`
        )
        .all(CHAT),
      scenes: db
        .prepare(`SELECT id FROM scene_evidence_events WHERE chat_id=? ORDER BY id`)
        .all(CHAT),
      targets: db
        .prepare(
          `SELECT id, target_key FROM investigation_targets
           WHERE owner_scope='CHAT' AND owner_id=? ORDER BY id`
        )
        .all(String(CHAT)),
      attempts: db
        .prepare(`SELECT id FROM investigation_attempts WHERE chat_id=? ORDER BY id`)
        .all(CHAT),
      results: db
        .prepare(`SELECT id FROM investigation_results WHERE chat_id=? ORDER BY id`)
        .all(CHAT),
    });
    const before = snapshot();

    assert.throws(
      () =>
        executeLastTurnDeleteTransaction(db, {
          chatId: CHAT,
          characterId: CHAR_SENDER,
          userMessageId: ids.userMessageId,
          assistantMessageId: ids.assistantMessageId,
          revertNumeric: false,
          __testThrowAfterPersonaSecretRewind: true,
        }),
      /TEST_THROW_AFTER_PERSONA_SECRET_REWIND/
    );
    assert.deepEqual(snapshot(), before);
  });

  it("chat delete wipes persona-secret/scene/investigation derived rows", () => {
    seedChat();
    insertDiscoveryEvidenceAndKnowledge(ids.userMessageId, "keep?");
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
    const { evidenceId } = insertVariantScopedS4(0, "act");
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

  it("persona delete preserves another persona activation in the same chat", () => {
    seedChat();
    const db = getDb();
    db.prepare(
      `INSERT INTO user_personas (id, user_id, name, description)
       VALUES (?,?,?,?)`
    ).run(PERSONA_B, USER, "P2", "desc");
    const createdB = createPersonaSecret({
      personaId: PERSONA_B,
      secretKey: `lc_b_${randomUUID().slice(0, 8)}`,
      canonicalSecretText: "HIDDEN B",
      confirmedFactText: "fact B",
      suspectedFactText: "fact B",
    });
    assert.equal(createdB.ok, true);
    if (!createdB.ok) throw new Error("secret B create failed");
    const a = insertVariantScopedS4(0, "fact A");
    const b = insertVariantScopedS4(
      0,
      "fact B",
      ids.userMessageId,
      PERSONA_B,
      createdB.secret.id
    );
    db.prepare(
      `UPDATE persona_secret_evidence_activation SET is_active=1
       WHERE evidence_id IN (?,?)`
    ).run(a.evidenceId, b.evidenceId);
    reprojectObserverSecretKnowledge({
      chatId: CHAT,
      personaId: PERSONA_B,
      secretId: createdB.secret.id,
      observerType: "CHARACTER",
      observerId: String(CHAR_RECEIVER),
      db,
    });

    deletePersonaSecretData(PERSONA, db);

    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE persona_id=?`,
        PERSONA
      ),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE evidence_id=?`,
        a.evidenceId
      ),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE persona_id=?`,
        PERSONA_B
      ),
      1
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE evidence_id=?`,
        b.evidenceId
      ),
      1
    );
    assert.equal(
      getObserverSecretKnowledge({
        chatId: CHAT,
        personaId: PERSONA_B,
        secretId: createdB.secret.id,
        observerType: "CHARACTER",
        observerId: String(CHAR_RECEIVER),
      })?.fact_snapshot,
      "fact B"
    );
  });

  it("true orphan sweep removes only activations without evidence", () => {
    seedChat();
    const { evidenceId } = insertVariantScopedS4(0, "owned");
    const orphanId = randomUUID();
    insertVariantScopedEvidenceActivation({
      evidenceId: orphanId,
      chatId: CHAT,
      assistantMessageId: ids.assistantMessageId,
      generationSequence: 0,
      isActive: true,
    });

    assert.equal(deleteTrueOrphanPersonaSecretActivations(getDb()), 1);
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE evidence_id=?`,
        orphanId
      ),
      0
    );
    assert.equal(
      count(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE evidence_id=?`,
        evidenceId
      ),
      1
    );
  });
});
