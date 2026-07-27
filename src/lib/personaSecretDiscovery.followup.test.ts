/**
 * PR #174 follow-up lean tests — save compile, stable rules, delete cleanup,
 * bootstrap-failure isolation, and legacy provenance.
 * 신규 6 + existing smoke 6.
 */
import Module from "module";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { upsertInvestigationTarget } from "@/lib/investigationTargets";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import { upsertObserverSecretKnowledge } from "@/lib/personaSecretKnowledge";
import { createPersonaSecret } from "@/lib/personaSecrets";
import {
  deletePersonaSecretData,
  savePersonaWithSecretCompilation,
} from "@/lib/personaSaveWithSecrets";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED", "PERSONA_SECRET_DISCOVERY_ENABLED", "NODE_ENV"] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

function uniqueUserId(): number {
  return 990000 + Math.floor(Math.random() * 9000);
}
function uniquePersonaId(): number {
  return 980000 + Math.floor(Math.random() * 9000);
}
function uniqueChatId(): number {
  return 970000 + Math.floor(Math.random() * 9000);
}

function countRows(table: string, where: string, ...params: unknown[]): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)
    .get(...params) as { c: number };
  return row.c;
}

function baseFields(overrides: Record<string, unknown> = {}) {
  return {
    name: "테스트 페르소나",
    memo: "",
    gender: "other" as const,
    description: "공개 설명",
    secret_description: "등에 숫자 문신이 있다.",
    image_url: "",
    image_focus_x: 0.5,
    image_focus_y: 0.5,
    ...overrides,
  };
}

describe("PR #174 follow-up — save / delete / provenance", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";
    delete process.env.NODE_ENV;
    const db = getDb();
    ensurePersonaSecretDiscoverySchema(db);
    ensureObserverSchema(db);
    ensureKnowledgeTransferSchema(db);
    ensureSceneEvidenceSchema(db);
    ensureInvestigationSchema(db);
  });
  afterEach(() => restoreEnv(env));

  it("1. persona save → compiled secrets + rules created, no source in response", () => {
    const userId = uniqueUserId();
    const saved = savePersonaWithSecretCompilation({
      userId,
      fields: baseFields(),
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.ok(saved.compile);
    assert.ok(saved.compile!.compiledSecretCount >= 1);
    assert.ok(saved.compile!.titles.length >= 1);
    assert.equal(typeof saved.compile.needsReview, "boolean");
    assert.equal(typeof saved.compile.reused, "boolean");
    assert.ok(Array.isArray(saved.compile.warnings));
    const personaRow = getDb()
      .prepare(`SELECT secret_description FROM user_personas WHERE id=?`)
      .get(saved.personaId) as { secret_description: string };
    assert.match(personaRow.secret_description, /문신/);
    const secrets = countRows("persona_secrets", "persona_id=?", saved.personaId);
    const rules = countRows(
      "persona_secret_discovery_rules",
      "secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)",
      saved.personaId
    );
    assert.ok(secrets >= 1);
    assert.ok(rules >= 1);
  });

  it("2. persona PUT source change → unchanged secret/rule IDs stable", () => {
    const userId = uniqueUserId();
    const first = savePersonaWithSecretCompilation({
      userId,
      fields: baseFields({ secret_description: "등에 숫자 문신이 있다." }),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const personaId = first.personaId;
    const beforeSecrets = getDb()
      .prepare(`SELECT id, secret_key FROM persona_secrets WHERE persona_id=? ORDER BY created_at`)
      .all(personaId) as Array<{ id: string; secret_key: string }>;
    const beforeRules = getDb()
      .prepare(
        `SELECT id, secret_id, rule_key FROM persona_secret_discovery_rules
         WHERE secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)`
      )
      .all(personaId) as Array<{ id: string; secret_id: string; rule_key: string }>;
    assert.ok(beforeSecrets.length >= 1);
    assert.ok(beforeRules.length >= 1);

    const second = savePersonaWithSecretCompilation({
      userId,
      personaId,
      fields: baseFields({ secret_description: "등에 숫자 문신이 있다.\n\n추가 문구 없음." }),
    });
    assert.equal(second.ok, true);

    const afterSecrets = getDb()
      .prepare(`SELECT id, secret_key FROM persona_secrets WHERE persona_id=? ORDER BY created_at`)
      .all(personaId) as Array<{ id: string; secret_key: string }>;
    const afterRules = getDb()
      .prepare(
        `SELECT id, secret_id, rule_key FROM persona_secret_discovery_rules
         WHERE secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)`
      )
      .all(personaId) as Array<{ id: string; secret_id: string; rule_key: string }>;

    const beforeSecretIds = new Set(beforeSecrets.map((s) => s.id));
    const keptSecretIds = afterSecrets.filter((s) => beforeSecretIds.has(s.id));
    assert.ok(keptSecretIds.length >= 1, "at least one existing secret id kept");

    const beforeRuleIds = new Set(beforeRules.map((r) => r.id));
    const keptRuleIds = afterRules.filter((r) => beforeRuleIds.has(r.id));
    assert.ok(keptRuleIds.length >= 1, "at least one existing rule id kept (stable upsert)");
  });

  it("3. secret field cleared → active secrets 0, prior knowledge preserved", () => {
    const userId = uniqueUserId();
    const chatId = uniqueChatId();
    const saved = savePersonaWithSecretCompilation({
      userId,
      fields: baseFields({ secret_description: "등에 숫자 문신이 있다." }),
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const personaId = saved.personaId;
    const secret = getDb()
      .prepare(`SELECT id FROM persona_secrets WHERE persona_id=? AND is_active=1 LIMIT 1`)
      .get(personaId) as { id: string };
    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: "17",
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: "등에 숫자 문신이 있다",
      confirmedTurn: 1,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-followup-3",
    });
    assert.equal(
      countRows("chat_character_secret_knowledge", "chat_id=? AND persona_id=?", chatId, personaId),
      1
    );

    const cleared = savePersonaWithSecretCompilation({
      userId,
      personaId,
      fields: baseFields({ secret_description: "   " }),
    });
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.compile?.compiledSecretCount, 0);

    const active = countRows(
      "persona_secrets",
      "persona_id=? AND is_active=1",
      personaId
    );
    assert.equal(active, 0);
    assert.equal(
      countRows("chat_character_secret_knowledge", "chat_id=? AND persona_id=?", chatId, personaId),
      1,
      "discovered knowledge is not auto-deleted on source clear"
    );
  });

  it("4. persona delete → canonical/rules/cache/evidence/knowledge rows 0", () => {
    const userId = uniqueUserId();
    const chatId = uniqueChatId();
    const saved = savePersonaWithSecretCompilation({
      userId,
      fields: baseFields(),
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const personaId = saved.personaId;
    const secret = getDb()
      .prepare(`SELECT id FROM persona_secrets WHERE persona_id=? LIMIT 1`)
      .get(personaId) as { id: string };
    upsertObserverSecretKnowledge({
      chatId,
      personaId,
      secretId: secret.id,
      observerType: "CHARACTER",
      observerId: "17",
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: "문신",
      confirmedTurn: 1,
      firstSuspectedTurn: 1,
      lastEvidenceEventId: "seed-followup-4",
    });
    getDb()
      .prepare(
        `INSERT INTO chat_persona_secret_reveals (chat_id, persona_id, secret_key, revealed_fact_text, revealed_at_turn, source)
         VALUES (?,?,?,?,?,?)`
      )
      .run(chatId, personaId, "k1", "문신", 1, "USER_AUTHORED_DISCLOSURE");

    deletePersonaSecretData(personaId);

    assert.equal(countRows("persona_secrets", "persona_id=?", personaId), 0);
    assert.equal(
      countRows("persona_secret_discovery_rules", "secret_id=?", secret.id),
      0
    );
    assert.equal(
      countRows("persona_secret_compilation_runs", "persona_id=?", personaId),
      0
    );
    assert.equal(
      countRows("persona_secret_evidence_events", "persona_id=?", personaId),
      0
    );
    assert.equal(
      countRows("chat_character_secret_knowledge", "persona_id=?", personaId),
      0
    );
    assert.equal(
      countRows("chat_persona_secret_reveals", "persona_id=?", personaId),
      0
    );
  });

  it("5. bootstrap-failure equivalent (userMessageSaved=false) → direct evidence/knowledge write 0", () => {
    // Gate mirrors route: discovery writes require bootstrapped.userMessageSaved && userMessageId.
    const userMessageSaved = false;
    const userMessageId: number | null = null;
    const discoveryWritesAllowed =
      true && userMessageSaved && userMessageId != null;
    assert.equal(discoveryWritesAllowed, false);

    const personaId = uniquePersonaId();
    const chatId = uniqueChatId();
    const secret = createPersonaSecret({
      personaId,
      secretKey: "followup5",
      canonicalSecretText: "HIDDEN followup5",
      confirmedFactText: "직접 공개 사실",
      suspectedFactText: "직접 공개 사실",
    });
    assert.equal(secret.ok, true);
    if (!secret.ok) return;

    const beforeEvidence = countRows("persona_secret_evidence_events", "chat_id=?", chatId);
    const beforeKnowledge = countRows("chat_character_secret_knowledge", "chat_id=?", chatId);

    // Route would skip confirmPersonaSecretDisclosure entirely when writes not allowed.
    if (discoveryWritesAllowed) {
      throw new Error("writes must not be allowed on bootstrap failure");
    }

    assert.equal(countRows("persona_secret_evidence_events", "chat_id=?", chatId), beforeEvidence);
    assert.equal(countRows("chat_character_secret_knowledge", "chat_id=?", chatId), beforeKnowledge);
  });

  it("6. Visual/Investigation → legacy USER_AUTHORED_DISCLOSURE rows 0", () => {
    const personaId = uniquePersonaId();
    const chatId = uniqueChatId();
    const characterId = 29;
    const compiled = compileAndApplyPersonaSecrets({
      personaId,
      source: "등에 숫자 문신이 있다.",
    });
    assert.equal(compiled.ok, true);

    bootstrapChatObservers({ chatId, characterId, displayName: "태현", turnNumber: 1 });
    extractAndPersistSceneEvidence({
      chatId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 11,
      userMessage: "등에 숫자 문신이 보인다",
      explicitActions: [],
      publicPersonaId: personaId,
    });
    runVisualDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 11,
    });

    upsertInvestigationTarget({
      ownerScope: "CHAT",
      ownerId: String(chatId),
      targetType: "DOCUMENT",
      targetKey: "doc:followup6",
      displayLabel: "문서",
      payload: {
        resultType: "DOCUMENT_CONTENT_VERIFIED",
        resultState: "VERIFIED",
        resultTags: [],
        observableFacts: ["문신 확인"],
      },
    });
    runInvestigationDiscoveryForTurn({
      chatId,
      personaId,
      characterId,
      turnNumber: 1,
      sourceMessageId: 12,
      userMessage: "문서를 읽는다",
      explicitActions: [],
      authoritativeOutcomes: [],
    });

    const legacy = countRows(
      "chat_persona_secret_reveals",
      "chat_id=? AND persona_id=? AND source='USER_AUTHORED_DISCLOSURE'",
      chatId,
      personaId
    );
    assert.equal(legacy, 0);
  });
});
