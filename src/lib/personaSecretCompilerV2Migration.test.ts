/**
 * v1 → v2 compiler migration — existing data compatibility (PR #677 audit).
 */
import Module from "module";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import {
  buildDeterministicDisclosureIdempotencyKey,
  confirmPersonaSecretDisclosure,
} from "@/lib/personaSecretDirectDisclosure";
import {
  compileAndApplyPersonaSecrets,
  hashPersonaSecretSource,
} from "@/lib/personaSecretCompiler";
import { findSuccessfulCompilationRun } from "@/lib/personaSecretCompilerApply";
import { PERSONA_SECRET_COMPILER_VERSION } from "@/lib/personaSecretCompilerCatalog";
import {
  countEnabledDiscoveryRules,
  countV1DormantDiscoveryRules,
  migratePersonaSecretCompilerV2,
  PERSONA_SECRET_COMPILER_V1,
} from "@/lib/personaSecretCompilerV2Migration";
import {
  getCharacterSecretKnowledge,
  listKnownCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";
import { listEligibleVisualDiscoveryRules } from "@/lib/visualDiscoveryEligibility";
import { upsertInvestigationTarget } from "@/lib/investigationTargets";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { listEligibleInvestigationDiscoveryRules } from "@/lib/investigationEligibility";

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

function uniqueIds() {
  const n = Math.floor(Math.random() * 10000);
  return {
    userId: 970000 + n,
    personaId: 971000 + n,
    chatId: 972000 + n,
    characterId: 17,
  };
}

function insertPersona(opts: {
  userId: number;
  personaId: number;
  source: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO user_personas
       (id, user_id, name, memo, gender, description, secret_description, speech_examples, image_url, image_focus_x, image_focus_y)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      opts.personaId,
      opts.userId,
      "migration-test",
      "",
      "other",
      "public",
      opts.source,
      "",
      "",
      0.5,
      0.5
    );
}

/** Simulate compiler v1 storage: VISUAL/INVESTIGATION enabled=0, dormant:true. */
function downgradeRulesToCompilerV1(personaId: number) {
  const db = getDb();
  const rules = db
    .prepare(
      `SELECT r.id, r.method, r.conditions_json
       FROM persona_secret_discovery_rules r
       JOIN persona_secrets s ON s.id = r.secret_id
       WHERE s.persona_id=? AND s.is_active=1
         AND r.method IN ('VISUAL_DISCOVERY', 'INVESTIGATION_DISCOVERY')`
    )
    .all(personaId) as Array<{ id: string; method: string; conditions_json: string }>;

  for (const rule of rules) {
    let conditions: Record<string, unknown> = {};
    try {
      conditions = JSON.parse(rule.conditions_json) as Record<string, unknown>;
    } catch {
      conditions = {};
    }
    conditions.dormant = true;
    db.prepare(
      `UPDATE persona_secret_discovery_rules
       SET enabled=0, conditions_json=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(JSON.stringify(conditions), rule.id);
  }

  db.prepare(
    `DELETE FROM persona_secret_compilation_runs
     WHERE persona_id=? AND compiler_version=?`
  ).run(personaId, PERSONA_SECRET_COMPILER_VERSION);

  const persona = db
    .prepare(`SELECT secret_description FROM user_personas WHERE id=?`)
    .get(personaId) as { secret_description: string };
  const sourceHash = hashPersonaSecretSource(persona.secret_description);
  db.prepare(
    `INSERT INTO persona_secret_compilation_runs
     (id, persona_id, source_hash, compiler_version, status, result_json, error_code)
     VALUES (?,?,?,?,?,?,NULL)`
  ).run(randomUUID(), personaId, sourceHash, PERSONA_SECRET_COMPILER_V1, "success", "{}");
}

function countPersonaTableRows(table: string, personaId: number): number {
  if (table === "persona_secret_discovery_rules") {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_discovery_rules r
         JOIN persona_secrets s ON s.id = r.secret_id WHERE s.persona_id=?`
      )
      .get(personaId) as { c: number };
    return row.c;
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE persona_id=?`)
    .get(personaId) as { c: number };
  return row.c;
}

function countRows(table: string, where: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)
    .get() as { c: number };
  return row.c;
}

function countKnowledgeSnapshots(chatId: number, personaId: number): string {
  const rows = getDb()
    .prepare(
      `SELECT secret_id, observer_id, knowledge_state, fact_snapshot
       FROM chat_character_secret_knowledge
       WHERE chat_id=? AND persona_id=?
       ORDER BY secret_id, observer_id`
    )
    .all(chatId, personaId) as Array<Record<string, string>>;
  return JSON.stringify(rows);
}

describe("Persona Secret compiler v1 → v2 migration", () => {
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
  });
  afterEach(() => restoreEnv(env));

  it("v1 VISUAL dormant → pre-migration discovery 0 → migration → enabled=1 → discovery PASS", () => {
    const { userId, personaId, chatId, characterId } = uniqueIds();
    const source = "렌의 등에 실험체 시절 생긴 017 문신이 있다.";
    insertPersona({ userId, personaId, source });
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source }).ok, true);
    downgradeRulesToCompilerV1(personaId);

    assert.ok(countV1DormantDiscoveryRules(personaId).visual >= 1);
    assert.equal(listEligibleVisualDiscoveryRules(personaId).length, 0);

    bootstrapChatObservers({ chatId, characterId, displayName: "A" });
    extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    const before = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 1,
    });
    assert.equal(before.matchCount, 0);
    assert.equal(before.changedCount, 0);

    const migrated = migratePersonaSecretCompilerV2({
      personaId,
      execute: true,
      userId,
    });
    assert.equal(migrated.status, "migrated");
    assert.equal(countV1DormantDiscoveryRules(personaId).visual, 0);
    assert.ok(listEligibleVisualDiscoveryRules(personaId).length >= 1);
    assert.ok(countEnabledDiscoveryRules(personaId).visual >= 1);

    extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 2,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    const after = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 2,
    });
    assert.ok(after.matchCount >= 1);
    assert.ok(after.changedCount >= 1);
  });

  it("v1 INVESTIGATION dormant → pre-migration discovery 0 → migration → enabled=1 → investigation PASS", () => {
    const { userId, personaId, chatId, characterId } = uniqueIds();
    const source = "렌은 거액의 빚이 있다.";
    insertPersona({ userId, personaId, source });
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source }).ok, true);
    downgradeRulesToCompilerV1(personaId);

    assert.ok(countV1DormantDiscoveryRules(personaId).investigation >= 1);
    assert.equal(listEligibleInvestigationDiscoveryRules(personaId).length, 0);

    bootstrapChatObservers({ chatId, characterId, displayName: "A" });
    upsertInvestigationTarget({
      ownerScope: "CHAT",
      ownerId: String(chatId),
      targetType: "DOCUMENT",
      targetKey: "doc:독촉장",
      displayLabel: "독촉장",
      payload: {
        resultType: "DOCUMENT_CONTENT_VERIFIED",
        resultState: "VERIFIED",
        resultTags: ["debt_notice", "debtor_identity_match"],
        observableFacts: ["독촉장"],
        requiredAccess: { allowedActions: ["READ_DOCUMENT"] },
      },
    });
    const before = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 1,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.equal(before.changedCount, 0);

    const migrated = migratePersonaSecretCompilerV2({
      personaId,
      execute: true,
      userId,
    });
    assert.equal(migrated.status, "migrated");
    assert.ok(listEligibleInvestigationDiscoveryRules(personaId).length >= 1);

    const after = runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 2,
      sourceMessageId: 2,
      explicitActions: [{ actionType: "READ_DOCUMENT", targetKey: "doc:독촉장" }],
    });
    assert.ok(after.changedCount >= 1);
  });

  it("stale removed rule stays enabled=0 after migration; runtime discovery 0", () => {
    const { userId, personaId, chatId, characterId } = uniqueIds();
    const markSource = "렌의 등에 실험체 시절 생긴 017 문신이 있다.";
    const plainSource = "렌은 평범한 가이드다.";
    insertPersona({ userId, personaId, source: markSource });
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source: markSource }).ok, true);
    downgradeRulesToCompilerV1(personaId);

    getDb()
      .prepare(`UPDATE user_personas SET secret_description=? WHERE id=?`)
      .run(plainSource, personaId);

    const markVisualRule = getDb()
      .prepare(
        `SELECT r.id, r.enabled, s.is_active
         FROM persona_secret_discovery_rules r
         JOIN persona_secrets s ON s.id = r.secret_id
         WHERE s.persona_id=? AND r.method='VISUAL_DISCOVERY' AND s.is_active=1
         LIMIT 1`
      )
      .get(personaId) as { id: string; enabled: number; is_active: number } | undefined;
    assert.ok(markVisualRule);
    assert.equal(Number(markVisualRule!.enabled), 0);

    const migrated = migratePersonaSecretCompilerV2({
      personaId,
      execute: true,
      userId,
    });
    assert.equal(migrated.status, "migrated");
    assert.equal(listEligibleVisualDiscoveryRules(personaId).length, 0);

    const staleAfter = getDb()
      .prepare(`SELECT enabled FROM persona_secret_discovery_rules WHERE id=?`)
      .get(markVisualRule!.id) as { enabled: number };
    assert.equal(Number(staleAfter.enabled), 0, "stale rule remains disabled");

    bootstrapChatObservers({ chatId, characterId, displayName: "A" });
    extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 1,
      userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
      publicPersonaId: personaId,
    });
    const visual = runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 1,
    });
    assert.equal(visual.matchCount, 0);
  });

  it("second migration run produces zero DB delta", () => {
    const { userId, personaId } = uniqueIds();
    const source = "렌의 등에 실험체 시절 생긴 017 문신이 있다.";
    insertPersona({ userId, personaId, source });
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source }).ok, true);
    downgradeRulesToCompilerV1(personaId);

    assert.equal(
      migratePersonaSecretCompilerV2({ personaId, execute: true, userId }).status,
      "migrated"
    );

    const tables = [
      "persona_secrets",
      "persona_secret_discovery_rules",
      "persona_secret_compilation_runs",
    ] as const;
    const before = Object.fromEntries(
      tables.map((t) => [t, countPersonaTableRows(t, personaId)])
    ) as Record<(typeof tables)[number], number>;

    const second = migratePersonaSecretCompilerV2({ personaId, execute: true, userId });
    assert.equal(second.status, "skipped", "already has v2 success cache");

    for (const t of tables) {
      assert.equal(countPersonaTableRows(t, personaId), before[t], `${t} unchanged`);
    }
  });

  it("knowledge and evidence history unchanged by migration", () => {
    const { userId, personaId, chatId, characterId } = uniqueIds();
    const source = "렌의 등에 실험체 시절 생긴 017 문신이 있다.";
    insertPersona({ userId, personaId, source });
    assert.equal(compileAndApplyPersonaSecrets({ personaId, source }).ok, true);
    downgradeRulesToCompilerV1(personaId);

    bootstrapChatObservers({ chatId, characterId, displayName: "A" });
    const secret = getDb()
      .prepare(`SELECT id, confirmed_fact_text FROM persona_secrets WHERE persona_id=? AND is_active=1 LIMIT 1`)
      .get(personaId) as { id: string; confirmed_fact_text: string };

    confirmPersonaSecretDisclosure({
      chatId,
      personaId,
      secretId: secret.id,
      characterId,
      turnNumber: 1,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      revealedFactText: secret.confirmed_fact_text,
      authority: "discovery",
      idempotencyKey: buildDeterministicDisclosureIdempotencyKey({
        chatId,
        personaId,
        secretId: secret.id,
        characterId,
        turnNumber: 1,
      }),
    });

    const knowledgeBefore = countKnowledgeSnapshots(chatId, personaId);
    const evidenceBefore = countRows(
      "persona_secret_evidence_events",
      `chat_id=${chatId} AND persona_id=${personaId}`
    );
    const revealsBefore = countRows(
      "chat_persona_secret_reveals",
      `chat_id=${chatId} AND persona_id=${personaId}`
    );
    const knowledgeRowsBefore = listKnownCharacterSecretKnowledge({
      chatId,
      personaId,
      characterId,
    });

    assert.equal(
      migratePersonaSecretCompilerV2({ personaId, execute: true, userId }).status,
      "migrated"
    );

    assert.equal(countKnowledgeSnapshots(chatId, personaId), knowledgeBefore);
    assert.equal(
      countRows("persona_secret_evidence_events", `chat_id=${chatId} AND persona_id=${personaId}`),
      evidenceBefore
    );
    assert.equal(
      countRows("chat_persona_secret_reveals", `chat_id=${chatId} AND persona_id=${personaId}`),
      revealsBefore
    );

    const knowledgeRowsAfter = listKnownCharacterSecretKnowledge({
      chatId,
      personaId,
      characterId,
    });
    assert.equal(knowledgeRowsAfter.length, knowledgeRowsBefore.length);
    for (let i = 0; i < knowledgeRowsBefore.length; i++) {
      assert.equal(knowledgeRowsAfter[i]!.fact_snapshot, knowledgeRowsBefore[i]!.fact_snapshot);
      assert.equal(
        knowledgeRowsAfter[i]!.knowledge_state,
        knowledgeRowsBefore[i]!.knowledge_state
      );
    }

    assert.ok(
      findSuccessfulCompilationRun({
        personaId,
        sourceHash: hashPersonaSecretSource(source),
        compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
      })
    );
    assert.equal(
      getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId,
      })?.knowledge_state,
      "CONFIRMED"
    );
  });
});
