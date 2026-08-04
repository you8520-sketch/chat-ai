/**
 * Persona Secret Discovery — one-shot server-side audit.
 *
 * Runs INSIDE the Railway production container (reads the production volume DB).
 * Manual-run only: requires --execute flag. No public API, no cookie/token
 * logging, no production DB change on default run (cleans up its own test rows).
 *
 * Verifies (no paid model calls — calls discovery functions directly):
 *  - S1 direct disclosure → knowledge row for (chat, persona, character observer) only
 *  - other character observer knowledge 0, other chat same character 0
 *  - retry same idempotencyKey → no duplicate evidence/knowledge
 *  - new idempotencyKey same message → no duplicate knowledge row
 *  - known-observer prompt fact block present; unknown-observer 0; ensemble 0
 *
 * Usage (inside container):
 *   node --import tsx scripts/audit-persona-secret-discovery.ts --execute
 */
import { getDb } from "@/lib/db";
import { createPersonaSecret, deletePersonaSecret } from "@/lib/personaSecrets";
import { bootstrapChatObservers, upsertChatObserver } from "@/lib/observerBootstrap";
import { upsertScenePresence } from "@/lib/scenePresence";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  detectDeterministicDirectDisclosures,
  confirmPersonaSecretDisclosure,
  buildDeterministicDisclosureIdempotencyKey,
} from "@/lib/personaSecretDirectDisclosure";
import {
  getCharacterSecretKnowledge,
  listConfirmedCharacterSecretKnowledge,
  buildPersonaKnowledgePromptBlock,
} from "@/lib/personaSecretKnowledge";
import {
  resolvePersonaKnowledgePromptDecisionForChat,
  buildGenerationKnowledgeContext,
  type PersonaKnowledgePromptDecision,
} from "@/lib/personaKnowledgePromptPolicy";
import { mainCharacterObserverId } from "@/lib/observerTypes";

const EXECUTE = process.argv.includes("--execute");
if (!EXECUTE) {
  console.error(
    "audit-persona-secret-discovery: manual-run only. Pass --execute to run against the production volume DB."
  );
  process.exit(2);
}

const db = getDb();
const PROBE = `audit_probe_${Date.now()}`;
const CHAT_ID = 990000 + Math.floor(Math.random() * 1000);
const PERSONA_ID = 991000 + Math.floor(Math.random() * 1000);
const CHARACTER_ID = 18; // 라이크 (single_primary)
const OTHER_CHARACTER_ID = 2; // a different character for cross-observer check
const OTHER_CHAT_ID = CHAT_ID + 500000;
const SECRET_KEY = "audit_s1_probe";
const DISCLOSURE_MSG = "나는 audit 프로브 비밀을 직접 고백한다. 이건 사실이야.";
const REVEALED_FACT = "렌이 audit 프로브 비밀을 직접 고백했다.";
const report: Record<string, unknown> = { probe: PROBE, generated_at: new Date().toISOString() };

function countEvidenceForSecret(chatId: number, secretId: string): number {
  return (
    (db
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=? AND secret_id=?`
      )
      .get(chatId, secretId) as { c: number }).c
  );
}

function countKnowledgeFor(chatId: number, personaId: number, secretId: string): number {
  return (
    (db
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=?`
      )
      .get(chatId, personaId, secretId) as { c: number }).c
  );
}

function countKnowledgeForObserver(
  chatId: number,
  personaId: number,
  secretId: string,
  observerType: string,
  observerId: string
): number {
  return (
    (db
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=? AND observer_type=? AND observer_id=?`
      )
      .get(chatId, personaId, secretId, observerType, observerId) as { c: number }).c
  );
}

try {
  // 1. create test persona + secret (with direct disclosure alias)
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, pref, points, is_adult, nsfw_on, onboarding_completed_at)
     VALUES (?, ?, ?, ?, 0, 1, 0, datetime('now'))`
  ).run(PERSONA_ID, `${PROBE}@example.com`, PROBE, "x", "male");
  const secret = createPersonaSecret({
    personaId: PERSONA_ID,
    secretKey: SECRET_KEY,
    canonicalSecretText: "audit 프로브 비밀 원문.",
    confirmedFactText: REVEALED_FACT,
    directDisclosureAliases: ["audit 프로브 비밀을 직접 고백한다"],
  });
  report.secret_created = Boolean(secret.ok);

  // 2. bootstrap chat observer for the test character (single_primary main character)
  bootstrapChatObservers({
    chatId: CHAT_ID,
    characterId: CHARACTER_ID,
    displayName: "라이크",
    turnNumber: 0,
    userId: PERSONA_ID,
  });
  const scene = getActiveChatScene(CHAT_ID)!;
  upsertScenePresence({
    sceneId: scene.id,
    chatId: CHAT_ID,
    observerType: "CHARACTER",
    observerId: String(CHARACTER_ID),
    presenceState: "PRESENT",
    awarenessState: "AWARE",
    visualCapability: "NORMAL",
    auditoryCapability: "NORMAL",
    joinedTurn: 1,
    sourceType: "SERVER_SCENE_EVENT",
  });

  // 3. S1 direct disclosure detection + confirm
  const matches = detectDeterministicDirectDisclosures(DISCLOSURE_MSG, PERSONA_ID);
  report.disclosure_matches = matches.length;
  if (matches.length === 0) {
    throw new Error("S1 disclosure did not match — alias mismatch");
  }
  const match = matches[0]!;
  const idempotencyKey = buildDeterministicDisclosureIdempotencyKey({
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
    secretId: match.secret.id,
    characterId: CHARACTER_ID,
    sourceMessageId: 1,
    turnNumber: 1,
  });
  const result = confirmPersonaSecretDisclosure({
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
    secretId: match.secret.id,
    characterId: CHARACTER_ID,
    turnNumber: 1,
    sourceMessageId: 1,
    sourceType: "USER_MESSAGE_DETERMINISTIC",
    discoveryRuleId: match.rule.id,
    revealedFactText: REVEALED_FACT,
    idempotencyKey,
  });
  report.s1_disclosure_changed = result.changed;
  report.s1_knowledge_state = result.knowledgeState;

  // 4. knowledge row for (chat, persona, character observer) only
  const knowledge = getCharacterSecretKnowledge({
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
    secretId: match.secret.id,
    characterId: CHARACTER_ID,
  });
  report.s1_knowledge_row = Boolean(knowledge);
  report.s1_knowledge_state = knowledge?.knowledge_state;
  report.s1_fact_snapshot = knowledge?.factSnapshot;
  report.s1_evidence_count = countEvidenceForSecret(CHAT_ID, match.secret.id);

  // 5. other character observer knowledge 0
  report.other_character_knowledge = countKnowledgeForObserver(
    CHAT_ID,
    PERSONA_ID,
    match.secret.id,
    "CHARACTER",
    String(OTHER_CHARACTER_ID)
  );
  // 6. other chat same character knowledge 0
  report.other_chat_knowledge = countKnowledgeFor(
    OTHER_CHAT_ID,
    PERSONA_ID,
    match.secret.id
  );

  // 7. retry same idempotencyKey → no duplicate
  const beforeEvidence = countEvidenceForSecret(CHAT_ID, match.secret.id);
  const beforeKnowledgeRows = countKnowledgeFor(CHAT_ID, PERSONA_ID, match.secret.id);
  const retryResult = confirmPersonaSecretDisclosure({
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
    secretId: match.secret.id,
    characterId: CHARACTER_ID,
    turnNumber: 1,
    sourceMessageId: 1,
    sourceType: "USER_MESSAGE_DETERMINISTIC",
    discoveryRuleId: match.rule.id,
    revealedFactText: REVEALED_FACT,
    idempotencyKey, // SAME idempotencyKey
  });
  report.retry_changed = retryResult.changed;
  report.retry_evidence_delta =
    countEvidenceForSecret(CHAT_ID, match.secret.id) - beforeEvidence;
  report.retry_knowledge_delta =
    countKnowledgeFor(CHAT_ID, PERSONA_ID, match.secret.id) - beforeKnowledgeRows;

  // 8. new idempotencyKey same message → no duplicate knowledge row
  const newKeyResult = confirmPersonaSecretDisclosure({
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
    secretId: match.secret.id,
    characterId: CHARACTER_ID,
    turnNumber: 2,
    sourceMessageId: 2,
    sourceType: "USER_MESSAGE_DETERMINISTIC",
    discoveryRuleId: match.rule.id,
    revealedFactText: REVEALED_FACT,
    idempotencyKey: idempotencyKey + "_new_turn",
  });
  report.new_key_knowledge_delta =
    countKnowledgeFor(CHAT_ID, PERSONA_ID, match.secret.id) - beforeKnowledgeRows;

  // 9. observer prompt: known observer → fact block; unknown observer → 0; ensemble → 0
  const knownDecision: PersonaKnowledgePromptDecision = {
    mode: "OBSERVER_SPECIFIC",
    observerType: "CHARACTER",
    observerId: mainCharacterObserverId(CHARACTER_ID),
    reasonCode: "AUTHORITATIVE_SINGLE_SPEAKER",
  };
  const knownBlock = buildPersonaKnowledgePromptBlock({
    decision: knownDecision,
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
  });
  report.known_observer_prompt_has_fact = Boolean(knownBlock && knownBlock.includes(REVEALED_FACT));
  report.known_observer_prompt_has_canonical = Boolean(knownBlock && knownBlock.includes("audit 프로브 비밀 원문."));

  const unknownDecision: PersonaKnowledgePromptDecision = {
    mode: "OBSERVER_SPECIFIC",
    observerType: "CHARACTER",
    observerId: mainCharacterObserverId(OTHER_CHARACTER_ID),
    reasonCode: "AUTHORITATIVE_SINGLE_SPEAKER",
  };
  const unknownBlock = buildPersonaKnowledgePromptBlock({
    decision: unknownDecision,
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
  });
  report.unknown_observer_prompt_has_fact = Boolean(unknownBlock && unknownBlock.includes(REVEALED_FACT));

  // ensemble (different chat context → ENSEMBLE_REDACTED → 0)
  const ensembleCtx = buildGenerationKnowledgeContext({
    contentKind: "character",
    characterId: CHARACTER_ID,
  simulationCast: null,
  });
  const ensembleDecision = resolvePersonaKnowledgePromptDecisionForChat(ensembleCtx, { chatId: CHAT_ID });
  const ensembleBlock = buildPersonaKnowledgePromptBlock({
    decision: ensembleDecision,
    chatId: CHAT_ID,
    personaId: PERSONA_ID,
  });
  report.ensemble_prompt_has_fact = Boolean(ensembleBlock && ensembleBlock.includes(REVEALED_FACT));
  report.ensemble_prompt_has_canonical = Boolean(
    ensembleBlock && ensembleBlock.includes("audit 프로브 비밀 원문.")
  );

  // verdict
  report.verdict =
    report.secret_created &&
    report.s1_knowledge_row &&
    report.s1_knowledge_state === "CONFIRMED" &&
    report.s1_evidence_count === 1 &&
    report.other_character_knowledge === 0 &&
    report.other_chat_knowledge === 0 &&
    report.retry_changed === false &&
    report.retry_evidence_delta === 0 &&
    report.retry_knowledge_delta === 0 &&
    report.new_key_knowledge_delta === 0 &&
    report.known_observer_prompt_has_fact &&
    !report.known_observer_prompt_has_canonical &&
    !report.unknown_observer_prompt_has_fact &&
    !report.ensemble_prompt_has_fact &&
    !report.ensemble_prompt_has_canonical
      ? "PERSONA_SECRET_DISCOVERY_S1_AUDIT_PASS"
      : "PERSONA_SECRET_DISCOVERY_S1_AUDIT_FAIL";
} finally {
  // 10. cleanup: delete test persona/secret/knowledge/evidence rows (no production user data touched)
  db.prepare(`DELETE FROM chat_character_secret_knowledge WHERE persona_id=?`).run(PERSONA_ID);
  db.prepare(`DELETE FROM persona_secret_evidence_events WHERE persona_id=?`).run(PERSONA_ID);
  db.prepare(`DELETE FROM persona_secret_discovery_rules WHERE secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)`).run(PERSONA_ID);
  deletePersonaSecret({ personaId: PERSONA_ID, secretKey: SECRET_KEY });
  db.prepare(`DELETE FROM chat_scenes WHERE chat_id=?`).run(CHAT_ID);
  db.prepare(`DELETE FROM chat_observers WHERE chat_id=?`).run(CHAT_ID);
  db.prepare(`DELETE FROM users WHERE id=?`).run(PERSONA_ID);
  report.cleaned_up = true;
}

console.log(JSON.stringify(report, null, 2));
if (report.verdict !== "PERSONA_SECRET_DISCOVERY_S1_AUDIT_PASS") process.exit(1);
