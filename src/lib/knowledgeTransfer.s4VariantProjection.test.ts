/**
 * S4 variant projection foundation — test matrix A–O.
 */
import Module from "module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import { parseKnowledgeTransferAuthoritativeActions } from "@/lib/knowledgeTransferActions";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import {
  reconcileS4KnowledgeForVariantSwitch,
  seedVariantScopedKnowledgeTransfer,
  S4HistoricalVariantReplayUnsupportedError,
  assertS4VariantSwitchAllowed,
} from "@/lib/knowledgeTransferVariant";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertChatObserver } from "@/lib/observerIdentity";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  getEvidenceActivation,
  hasVariantScopedS4EvidenceOnAssistant,
} from "@/lib/personaSecretEvidenceActivation";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { reprojectObserverSecretKnowledge } from "@/lib/personaSecretKnowledgeReprojection";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { upsertScenePresence } from "@/lib/scenePresence";
import {
  executeAtomicVariantSwitchCore,
  executeVariantSwitchMutationCore,
  hasLaterCanonicalTurn,
} from "@/lib/rpDerivedStateLifecycle";
import type { MessageVariant } from "@/lib/messageAlternates";
import { readFileSync } from "node:fs";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = [
  "PERSONA_SECRET_BOUNDARY_ENABLED",
  "PERSONA_SECRET_DISCOVERY_ENABLED",
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

type Fixture = {
  chatId: number;
  personaId: number;
  locoId: number;
  taehyunId: number;
  secretId: string;
  fact: string;
  assistantMessageId: number;
  userMessageId: number;
};

function seedSecret(personaId: number, key: string, fact: string) {
  const uniqueKey = `${key}_${randomUUID().slice(0, 8)}`;
  const created = createPersonaSecret({
    personaId,
    secretKey: uniqueKey,
    canonicalSecretText: `HIDDEN ${key}`,
    confirmedFactText: fact,
    suspectedFactText: fact,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("secret create failed");
  return created.secret;
}

function setupFixture(): Fixture {
  const n = Math.floor(Math.random() * 10000);
  const chatId = 880000 + n;
  const personaId = 881000 + n;
  const locoId = 17;
  const taehyunId = 29;
  const fact = "유효 전달 사실.";
  bootstrapChatObservers({
    chatId,
    characterId: locoId,
    displayName: "로코",
    userId: 1,
  });
  upsertChatObserver({
    chatId,
    observerType: "CHARACTER",
    observerId: String(taehyunId),
    canonicalSourceType: "PARTY_CHARACTER",
    displayName: "태현",
    createdTurn: 1,
  });
  const scene = getActiveChatScene(chatId)!;
  for (const observerId of [String(locoId), String(taehyunId)]) {
    upsertScenePresence({
      sceneId: scene.id,
      chatId,
      observerType: "CHARACTER",
      observerId,
      presenceState: "PRESENT",
      awarenessState: "AWARE",
      visualCapability: "NORMAL",
      auditoryCapability: "NORMAL",
      joinedTurn: 1,
      sourceType: "SERVER_SCENE_EVENT",
    });
  }
  const secret = seedSecret(personaId, `s4vp_${n}`, fact);
  upsertObserverSecretKnowledge({
    chatId,
    personaId,
    secretId: secret.id,
    observerType: "CHARACTER",
    observerId: String(locoId),
    knowledgeState: "CONFIRMED",
    confidence: 100,
    factSnapshot: fact,
    confirmedTurn: 1,
    firstSuspectedTurn: 1,
    lastEvidenceEventId: `seed-${secret.id}`,
  });

  const db = getDb();
  ensureKnowledgeTransferSchema(db);
  const userMsg = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status)
       VALUES (?,?,?,?,?)`
    )
    .run(chatId, "user", "user turn", "", "completed");
  const userMessageId = Number(userMsg.lastInsertRowid);
  const asstMsg = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id, alternates, active_variant)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      chatId,
      "assistant",
      "variant 0 prose",
      "test-model",
      "completed",
      userMessageId,
      JSON.stringify([
        {
          content: "variant 0 prose",
          model: "test-model",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
      ]),
      0
    );
  const assistantMessageId = Number(asstMsg.lastInsertRowid);

  return {
    chatId,
    personaId,
    locoId,
    taehyunId,
    secretId: secret.id,
    fact,
    assistantMessageId,
    userMessageId,
  };
}

function transferAction(f: Fixture) {
  return {
    secretId: f.secretId,
    sender: { observerType: "CHARACTER" as const, observerId: String(f.locoId) },
    receiver: { observerType: "CHARACTER" as const, observerId: String(f.taehyunId) },
    transferType: "DIRECT_STATEMENT" as const,
  };
}

function seedVariantTransfer(
  f: Fixture,
  generationSequence: number,
  opts?: { userMessageId?: number }
) {
  return seedVariantScopedKnowledgeTransfer({
    chatId: f.chatId,
    personaId: f.personaId,
    characterId: f.locoId,
    turnNumber: 2,
    sourceAssistantMessageId: f.assistantMessageId,
    sourceGenerationSequence: generationSequence,
    userMessageId: opts?.userMessageId ?? f.userMessageId,
    action: transferAction(f),
  });
}

function setAssistantVariants(
  f: Fixture,
  variants: MessageVariant[],
  activeVariant: number,
  content?: string
) {
  const db = getDb();
  const active = variants[activeVariant]!;
  db.prepare(
    `UPDATE messages SET content=?, alternates=?, active_variant=? WHERE id=?`
  ).run(content ?? active.content, JSON.stringify(variants), activeVariant, f.assistantMessageId);
}

function receiverKnowledge(f: Fixture) {
  return getObserverSecretKnowledge({
    chatId: f.chatId,
    personaId: f.personaId,
    secretId: f.secretId,
    observerType: "CHARACTER",
    observerId: String(f.taehyunId),
  });
}

function insertNonS4Evidence(opts: {
  f: Fixture;
  method: string;
  sourceType: string;
  state: "SUSPECTED" | "CONFIRMED";
  fact: string;
  turnNumber?: number;
}) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO persona_secret_evidence_events (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       persona_id, secret_id, discovery_rule_id,
       observer_type, observer_id, method, source_type, resulting_state,
       revealed_fact_snapshot, evidence_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    `evidence:${id}`,
    opts.f.chatId,
    opts.turnNumber ?? 1,
    opts.f.userMessageId,
    opts.f.personaId,
    opts.f.secretId,
    null,
    "CHARACTER",
    String(opts.f.taehyunId),
    opts.method,
    opts.sourceType,
    opts.state,
    opts.fact,
    "{}"
  );
  reprojectObserverSecretKnowledge({
    chatId: opts.f.chatId,
    personaId: opts.f.personaId,
    secretId: opts.f.secretId,
    observerType: "CHARACTER",
    observerId: String(opts.f.taehyunId),
  });
}

function countEvidenceRows(chatId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=?`)
    .get(chatId) as { c: number };
  return row.c;
}

type S4TableCounts = {
  transferEvents: number;
  evidenceEvents: number;
  activations: number;
  knowledgeRows: number;
};

function countS4Tables(chatId: number, personaId: number, secretId: string): S4TableCounts {
  const db = getDb();
  const transferEvents = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`)
      .get(chatId) as { c: number }
  ).c;
  const evidenceEvents = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=?`)
      .get(chatId) as { c: number }
  ).c;
  const activations = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM persona_secret_evidence_activation WHERE chat_id=?`)
      .get(chatId) as { c: number }
  ).c;
  const knowledgeRows = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=?`
      )
      .get(chatId, personaId, secretId) as { c: number }
  ).c;
  return { transferEvents, evidenceEvents, activations, knowledgeRows };
}

function applyTransferWithProvenance(
  f: Fixture,
  provenance: {
    sourceAssistantMessageId?: number | null;
    sourceGenerationSequence?: number | null;
    sourceMessageId?: number;
  }
) {
  return applyKnowledgeTransferAction({
    chatId: f.chatId,
    personaId: f.personaId,
    characterId: f.locoId,
    turnNumber: 2,
    sourceType: "SERVER_STRUCTURED_TRANSFER",
    action: {
      ...transferAction(f),
      actionId: "test-provenance",
      ...provenance,
    },
  });
}

function assertZeroS4Delta(
  before: S4TableCounts,
  after: S4TableCounts,
  label: string
): void {
  assert.equal(after.transferEvents, before.transferEvents, `${label}: transfer events`);
  assert.equal(after.evidenceEvents, before.evidenceEvents, `${label}: evidence events`);
  assert.equal(after.activations, before.activations, `${label}: activations`);
  assert.equal(after.knowledgeRows, before.knowledgeRows, `${label}: knowledge rows`);
}

describe("S4 variant projection foundation", () => {
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    ensureKnowledgeTransferSchema(getDb());
  });

  afterEach(() => restoreEnv(env));

  it("A: variant0 S4 only → switch no-transfer variant1 → UNKNOWN", () => {
    const f = setupFixture();
    seedVariantTransfer(f, 0);
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");

    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(receiverKnowledge(f), null);
  });

  it("B: S2 SUSPECTED + variant0 S4 CONFIRMED → switch away → SUSPECTED", () => {
    const f = setupFixture();
    insertNonS4Evidence({
      f,
      method: "VISUAL_MATCH",
      sourceType: "SCENE_EVIDENCE",
      state: "SUSPECTED",
      fact: "S2 suspected fact.",
    });
    seedVariantTransfer(f, 0);
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");

    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "SUSPECTED");
  });

  it("C: S1 CONFIRMED + S4 CONFIRMED → switch S4 away → CONFIRMED unchanged", () => {
    const f = setupFixture();
    insertNonS4Evidence({
      f,
      method: "DIRECT_DISCLOSURE",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      state: "CONFIRMED",
      fact: "S1 confirmed fact.",
      turnNumber: 1,
    });
    seedVariantTransfer(f, 0);
    const before = receiverKnowledge(f)!.fact_snapshot;
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
    assert.equal(receiverKnowledge(f)?.fact_snapshot, before);
  });

  it("D: S3 CONFIRMED + S4 CONFIRMED → switch S4 away → CONFIRMED unchanged", () => {
    const f = setupFixture();
    insertNonS4Evidence({
      f,
      method: "INVESTIGATION_MATCH",
      sourceType: "INVESTIGATION_DISCOVERY",
      state: "CONFIRMED",
      fact: "S3 confirmed fact.",
      turnNumber: 1,
    });
    seedVariantTransfer(f, 0);
    const before = receiverKnowledge(f)!.fact_snapshot;
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
    assert.equal(receiverKnowledge(f)?.fact_snapshot, before);
  });

  it("E/F/G: regen generation identity + switch back", () => {
    const f = setupFixture();
    seedVariantTransfer(f, 0);
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(receiverKnowledge(f), null);

    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
        {
          content: "v2",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 2,
        },
      ],
      2
    );
    seedVariantTransfer(f, 2);
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 2,
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");

    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 0,
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
  });

  it("H: duplicate same generation → idempotent", () => {
    const f = setupFixture();
    const first = seedVariantTransfer(f, 0);
    const second = seedVariantTransfer(f, 0);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(second.reason, "DUPLICATE");
      assert.equal(first.transferEventId, second.transferEventId);
    }
    const db = getDb();
    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`
      )
      .get(f.chatId) as { c: number };
    assert.equal(count.c, 1);
  });

  it("I: same message different generationSequence → NOT duplicate", () => {
    const f = setupFixture();
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      0
    );
    const g0 = seedVariantTransfer(f, 0);
    const g1 = seedVariantTransfer(f, 1);
    assert.equal(g0.ok, true);
    assert.equal(g1.ok, true);
    if (g0.ok && g1.ok) {
      assert.notEqual(g0.transferEventId, g1.transferEventId);
    }
    const db = getDb();
    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`
      )
      .get(f.chatId) as { c: number };
    assert.equal(count.c, 2);
  });

  it("J: historical message + later canonical turn + S4 variants → 409", () => {
    const f = setupFixture();
    seedVariantTransfer(f, 0);
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id)
       VALUES (?,?,?,?,?,?)`
    ).run(f.chatId, "user", "later", "", "completed", f.userMessageId);
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id)
       VALUES (?,?,?,?,?,?)`
    ).run(
      f.chatId,
      "assistant",
      "later assistant",
      "test-model",
      "completed",
      f.userMessageId
    );
    assert.equal(hasLaterCanonicalTurn(db, f.chatId, f.assistantMessageId), true);
    assert.throws(
      () =>
        assertS4VariantSwitchAllowed(
          db,
          f.chatId,
          f.assistantMessageId,
          true
        ),
      S4HistoricalVariantReplayUnsupportedError
    );
  });

  it("K: historical message with NO S4 evidence → gate passes", () => {
    const f = setupFixture();
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id)
       VALUES (?,?,?,?,?,?)`
    ).run(f.chatId, "user", "later", "", "completed", f.userMessageId);
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id)
       VALUES (?,?,?,?,?,?)`
    ).run(
      f.chatId,
      "assistant",
      "later assistant",
      "test-model",
      "completed",
      f.userMessageId
    );
    assert.equal(
      hasVariantScopedS4EvidenceOnAssistant(db, f.chatId, f.assistantMessageId),
      false
    );
    assert.doesNotThrow(() =>
      assertS4VariantSwitchAllowed(db, f.chatId, f.assistantMessageId, true)
    );
  });

  it("L: activation / knowledge atomic failure rolls back", () => {
    const f = setupFixture();
    seedVariantTransfer(f, 0);
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      0
    );
    const db = getDb();
    const beforeActive = db
      .prepare(`SELECT active_variant FROM messages WHERE id=?`)
      .get(f.assistantMessageId) as { active_variant: number };

    assert.throws(() => {
      const tx = db.transaction(() => {
        executeVariantSwitchMutationCore(db, {
          chatId: f.chatId,
          messageId: f.assistantMessageId,
          content: "v1",
          model: "m",
          usageJson: null,
          adultRouteMetaJson: "",
          variantsJson: JSON.stringify([
            {
              content: "v0",
              model: "m",
              usage: null,
              created_at: "",
              generationSequence: 0,
            },
            {
              content: "v1",
              model: "m",
              usage: null,
              created_at: "",
              generationSequence: 1,
            },
          ]),
          variantIndex: 1,
          sourceTurn: 1,
          selectedFacts: [],
          selectedRequestId: null,
          selectedGenerationSequence: 1,
          __testThrowAfterS4Reprojection: true,
        });
      });
      tx();
    }, /TEST_THROW_AFTER_S4_REPROJECTION/);

    const afterActive = db
      .prepare(`SELECT active_variant FROM messages WHERE id=?`)
      .get(f.assistantMessageId) as { active_variant: number };
    assert.equal(afterActive.active_variant, beforeActive.active_variant);
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
  });

  it("M: S1/S2/S3 evidence rows never deleted/updated on variant switch", () => {
    const f = setupFixture();
    insertNonS4Evidence({
      f,
      method: "VISUAL_MATCH",
      sourceType: "SCENE_EVIDENCE",
      state: "SUSPECTED",
      fact: "immutable s2",
    });
    insertNonS4Evidence({
      f,
      method: "DIRECT_DISCLOSURE",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      state: "CONFIRMED",
      fact: "immutable s1",
    });
    const beforeCount = countEvidenceRows(f.chatId);
    seedVariantTransfer(f, 0);
    const afterSeedCount = countEvidenceRows(f.chatId);
    assert.equal(afterSeedCount, beforeCount + 1);
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      1
    );
    reconcileS4KnowledgeForVariantSwitch(getDb(), {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    assert.equal(countEvidenceRows(f.chatId), afterSeedCount);
    const db = getDb();
    const s2 = db
      .prepare(
        `SELECT revealed_fact_snapshot FROM persona_secret_evidence_events
         WHERE chat_id=? AND method='VISUAL_MATCH'`
      )
      .get(f.chatId) as { revealed_fact_snapshot: string };
    assert.equal(s2.revealed_fact_snapshot, "immutable s2");
  });

  it("N: reprojection path does not read canonical secret text", () => {
    const src = readFileSync(
      new URL("./personaSecretKnowledgeReprojection.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /getPersonaSecretById/);
    assert.doesNotMatch(src, /canonical_secret_text/);
  });

  it("O: public body cannot inject authoritative variant S4", () => {
    const forged = parseKnowledgeTransferAuthoritativeActions([
      {
        secretId: "forged",
        sender: { observerType: "CHARACTER", observerId: "1" },
        receiver: { observerType: "CHARACTER", observerId: "2" },
        transferType: "DIRECT_STATEMENT",
        sourceAssistantMessageId: 99,
        sourceGenerationSequence: 0,
        sourceType: "SERVER_STRUCTURED_TRANSFER",
      },
    ]);
    assert.equal(forged.length, 0);
  });

  it("reprojection semantics: UNKNOWN+SUSPECTED → SUSPECTED", () => {
    const f = setupFixture();
    insertNonS4Evidence({
      f,
      method: "VISUAL_MATCH",
      sourceType: "SCENE_EVIDENCE",
      state: "SUSPECTED",
      fact: "sus only",
    });
    assert.equal(receiverKnowledge(f)?.knowledge_state, "SUSPECTED");
  });

  it("activation overlay toggles with generationSequence", () => {
    const f = setupFixture();
    seedVariantTransfer(f, 0);
    setAssistantVariants(
      f,
      [
        {
          content: "v0",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 0,
        },
        {
          content: "v1",
          model: "m",
          usage: null,
          created_at: "",
          generationSequence: 1,
        },
      ],
      0
    );
    seedVariantTransfer(f, 1);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT generation_sequence, is_active FROM persona_secret_evidence_activation
         WHERE assistant_message_id=? ORDER BY generation_sequence`
      )
      .all(f.assistantMessageId) as Array<{
      generation_sequence: number;
      is_active: number;
    }>;
    assert.equal(rows.length, 2);
    reconcileS4KnowledgeForVariantSwitch(db, {
      chatId: f.chatId,
      assistantMessageId: f.assistantMessageId,
      selectedGenerationSequence: 1,
    });
    const refreshed = db
      .prepare(
        `SELECT generation_sequence, is_active FROM persona_secret_evidence_activation
         WHERE assistant_message_id=? ORDER BY generation_sequence`
      )
      .all(f.assistantMessageId) as Array<{
      generation_sequence: number;
      is_active: number;
    }>;
    assert.deepEqual(
      refreshed.map((r) => [r.generation_sequence, r.is_active]),
      [
        [0, 0],
        [1, 1],
      ]
    );
  });

  it("legacy user transfer remains variant-unscoped and effective", () => {
    const f = setupFixture();
    const result = applyKnowledgeTransferAction({
      chatId: f.chatId,
      personaId: f.personaId,
      characterId: f.locoId,
      turnNumber: 2,
      sourceType: "USER_EXPLICIT_TRANSFER",
      action: {
        ...transferAction(f),
        sourceMessageId: f.userMessageId,
      },
    });
    assert.equal(result.ok, true);
    const db = getDb();
    const row = db
      .prepare(
        `SELECT source_assistant_message_id, source_generation_sequence
         FROM knowledge_transfer_events WHERE chat_id=?`
      )
      .get(f.chatId) as {
      source_assistant_message_id: number | null;
      source_generation_sequence: number | null;
    };
    assert.equal(row.source_assistant_message_id, null);
    assert.equal(row.source_generation_sequence, null);
    const evidenceRows = db
      .prepare(
        `SELECT id FROM persona_secret_evidence_events WHERE chat_id=? AND method='KNOWLEDGE_TRANSFER'`
      )
      .all(f.chatId) as Array<{ id: string }>;
    assert.equal(evidenceRows.length, 1);
    assert.equal(getEvidenceActivation(evidenceRows[0]!.id), null);
    assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
  });

  describe("variant provenance fail-closed P1–P10", () => {
    it("P1: assistantMessageId only → reject, DB delta 0", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceAssistantMessageId: f.assistantMessageId,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "INVALID_VARIANT_PROVENANCE");
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P1");
    });

    it("P2: generation only → reject, DB delta 0", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceGenerationSequence: 0,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "INVALID_VARIANT_PROVENANCE");
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P2");
    });

    it("P3: nonexistent assistant message → reject, DB delta 0", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceAssistantMessageId: 999_999_999,
        sourceGenerationSequence: 0,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "VARIANT_PROVENANCE_MESSAGE_NOT_FOUND");
      }
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P3");
    });

    it("P4: assistant from another chat → reject, DB delta 0", () => {
      const f = setupFixture();
      const other = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceAssistantMessageId: other.assistantMessageId,
        sourceGenerationSequence: 0,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "VARIANT_PROVENANCE_WRONG_CHAT");
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P4");
    });

    it("P5: USER-role message id → reject, DB delta 0", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceAssistantMessageId: f.userMessageId,
        sourceGenerationSequence: 0,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "VARIANT_PROVENANCE_NON_ASSISTANT");
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P5");
    });

    it("P6: valid assistant + unknown generationSequence → reject, DB delta 0", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const result = applyTransferWithProvenance(f, {
        sourceAssistantMessageId: f.assistantMessageId,
        sourceGenerationSequence: 99,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "VARIANT_PROVENANCE_UNKNOWN_GENERATION");
      }
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P6");
    });

    it("P7: valid assistant + generationSequence=0 → PASS", () => {
      const f = setupFixture();
      const result = seedVariantTransfer(f, 0);
      assert.equal(result.ok, true);
      assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
    });

    it("P8: same assistant + regen generationSequence=1 → PASS, distinct from gen0", () => {
      const f = setupFixture();
      setAssistantVariants(
        f,
        [
          {
            content: "v0",
            model: "m",
            usage: null,
            created_at: "",
            generationSequence: 0,
          },
          {
            content: "v1",
            model: "m",
            usage: null,
            created_at: "",
            generationSequence: 1,
          },
        ],
        0
      );
      const g0 = seedVariantTransfer(f, 0);
      const g1 = seedVariantTransfer(f, 1);
      assert.equal(g0.ok, true);
      assert.equal(g1.ok, true);
      if (g0.ok && g1.ok) {
        assert.notEqual(g0.transferEventId, g1.transferEventId);
      }
      const db = getDb();
      const count = db
        .prepare(`SELECT COUNT(*) AS c FROM knowledge_transfer_events WHERE chat_id=?`)
        .get(f.chatId) as { c: number };
      assert.equal(count.c, 2);
    });

    it("P9: both provenance fields null → legacy unscoped S4 unchanged", () => {
      const f = setupFixture();
      const result = applyKnowledgeTransferAction({
        chatId: f.chatId,
        personaId: f.personaId,
        characterId: f.locoId,
        turnNumber: 2,
        sourceType: "USER_EXPLICIT_TRANSFER",
        action: {
          ...transferAction(f),
          sourceMessageId: f.userMessageId,
        },
      });
      assert.equal(result.ok, true);
      const db = getDb();
      const row = db
        .prepare(
          `SELECT source_assistant_message_id, source_generation_sequence
           FROM knowledge_transfer_events WHERE chat_id=?`
        )
        .get(f.chatId) as {
        source_assistant_message_id: number | null;
        source_generation_sequence: number | null;
      };
      assert.equal(row.source_assistant_message_id, null);
      assert.equal(row.source_generation_sequence, null);
      assert.equal(receiverKnowledge(f)?.knowledge_state, "CONFIRMED");
    });

    it("P10: malformed provenance rejection leaves all S4 tables unchanged", () => {
      const f = setupFixture();
      const before = countS4Tables(f.chatId, f.personaId, f.secretId);
      const cases = [
        { sourceAssistantMessageId: f.assistantMessageId },
        { sourceGenerationSequence: 0 },
        {
          sourceAssistantMessageId: 999_999_999,
          sourceGenerationSequence: 0,
        },
        {
          sourceAssistantMessageId: f.userMessageId,
          sourceGenerationSequence: 0,
        },
        {
          sourceAssistantMessageId: f.assistantMessageId,
          sourceGenerationSequence: 99,
        },
      ] as const;
      for (const provenance of cases) {
        const result = applyTransferWithProvenance(f, provenance);
        assert.equal(result.ok, false);
      }
      assertZeroS4Delta(before, countS4Tables(f.chatId, f.personaId, f.secretId), "P10");
    });
  });
});
