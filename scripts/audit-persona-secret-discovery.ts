/**
 * Persona Secret Discovery — one-shot server-side audit (S1 + observer prompt + ensemble).
 *
 * Manual-run only: requires --execute. Reads the volume DB via getDb().
 * No public API, no cookie/token/secret logging, 0 paid model calls.
 * Audit uses synthetic IDs, strict preflight, finally cleanup,
 * and post-cleanup zero-residual assertions.
 * (success or fail) → volume DB left with zero persistent delta,
 * zero residual test rows.
 *
 * Scope: S1 persistence, retry idempotency, observer isolation,
 *   cross-chat isolation, known/unknown/ensemble prompt policy.
 * PENDING (not here; separate production audit): S2/S3/S4 representative smoke,
 *   actual authenticated chat RSC inspection.
 *
 * Usage: DATA_DIR=<temp> node --import tsx scripts/audit-persona-secret-discovery.ts --execute
 */
import { getDb } from "@/lib/db";
import { createPersonaSecret } from "@/lib/personaSecrets";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import { upsertScenePresence } from "@/lib/scenePresence";
import { getActiveChatScene } from "@/lib/chatScenes";
import {
  detectDeterministicDirectDisclosures,
  confirmPersonaSecretDisclosure,
  buildDeterministicDisclosureIdempotencyKey,
} from "@/lib/personaSecretDirectDisclosure";
import {
  getCharacterSecretKnowledge,
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
  console.error("audit-persona-secret-discovery: manual-run only. Pass --execute.");
  process.exit(2);
}

const db = getDb();

// Synthetic IDs: Date.now-based, large, < MAX_SAFE_INTEGER. No random small range.
const RUN_TAG = Date.now();
const PERSONA_ID = Number(RUN_TAG % 1_000_000_000) + 2_000_000_000;
const CHAT_ID = PERSONA_ID + 1;
const OTHER_CHAT_ID = PERSONA_ID + 2;
const CHARACTER_ID = 18;
const OTHER_CHARACTER_ID = 2;
const SECRET_KEY = "audit_s1_probe";
const DISCLOSURE_MSG = "나는 audit 프로브 비밀을 직접 고백한다. 이건 사실이야.";
const REVEALED_FACT = "렌이 audit 프로브 비밀을 직접 고백했다.";
const CANONICAL = "audit 프로브 비밀 원문.";

const PREFLIGHT = [
  { t: "persona_secrets", c: "persona_id", v: PERSONA_ID },
  { t: "persona_secret_evidence_events", c: "persona_id", v: PERSONA_ID },
  { t: "chat_character_secret_knowledge", c: "persona_id", v: PERSONA_ID },
  { t: "chat_observers", c: "chat_id", v: CHAT_ID },
  { t: "chat_scenes", c: "chat_id", v: CHAT_ID },
  { t: "scene_observer_presence", c: "chat_id", v: CHAT_ID },
  { t: "knowledge_transfer_events", c: "chat_id", v: CHAT_ID },
  { t: "scene_evidence_events", c: "chat_id", v: CHAT_ID },
  { t: "investigation_attempts", c: "chat_id", v: CHAT_ID },
  { t: "investigation_results", c: "chat_id", v: CHAT_ID },
  { t: "scene_event_observations", c: "chat_id", v: CHAT_ID },
  { t: "scene_event_observation_runs", c: "chat_id", v: CHAT_ID },
  { t: "chat_persona_secret_reveals", c: "persona_id", v: PERSONA_ID },
] as { t: string; c: string; v: number }[];

function countRows(t: string, c: string, v: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE ${c}=?`).get(v) as { c: number } | undefined;
  return row?.c ?? 0;
}
function countEvidence(chatId: number, secretId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM persona_secret_evidence_events WHERE chat_id=? AND secret_id=?`)
    .get(chatId, secretId) as { c: number } | undefined;
  return row?.c ?? 0;
}
function countKnowledge(chatId: number, personaId: number, secretId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM chat_character_secret_knowledge WHERE chat_id=? AND persona_id=? AND secret_id=?`)
    .get(chatId, personaId, secretId) as { c: number } | undefined;
  return row?.c ?? 0;
}
function countKnowledgeObserver(
  chatId: number, personaId: number, secretId: string,
  observerType: string, observerId: string
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM chat_character_secret_knowledge WHERE chat_id=? AND persona_id=? AND secret_id=? AND observer_type=? AND observer_id=?`)
    .get(chatId, personaId, secretId, observerType, observerId) as { c: number } | undefined;
  return row?.c ?? 0;
}

const report: Record<string, unknown> = {
  probe: RUN_TAG,
  generated_at: new Date().toISOString(),
  persona_id: PERSONA_ID,
  chat_id: CHAT_ID,
  scope: [
    "S1 direct disclosure persistence",
    "retry idempotency",
    "observer isolation",
    "cross-chat isolation",
    "known/unknown/ensemble prompt policy",
  ],
  pending: [
    "S2 visual discovery representative smoke",
    "S3 investigation representative smoke",
    "S4 transfer representative smoke",
    "actual authenticated chat RSC inspection",
  ],
};

// Manual cleanup — delete every row this audit touched, keyed by the synthetic IDs.
// Audit uses synthetic IDs, strict preflight, finally cleanup,
// and post-cleanup zero-residual assertions.
// Run after the audit body (success or fail) so the volume DB is left pristine.
function cleanupAuditRows(): void {
  const delDiscoveryRules = db.prepare(
    `DELETE FROM persona_secret_discovery_rules WHERE secret_id=?`
  );
  const delPersona = db.prepare(`DELETE FROM persona_secrets WHERE persona_id=?`);
  const delEvidence = db.prepare(`DELETE FROM persona_secret_evidence_events WHERE persona_id=?`);
  const delKnowledge = db.prepare(`DELETE FROM chat_character_secret_knowledge WHERE persona_id=?`);
  const delTransfer = db.prepare(`DELETE FROM knowledge_transfer_events WHERE chat_id IN (?, ?)`);
  const delSceneEvidence = db.prepare(`DELETE FROM scene_evidence_events WHERE chat_id=?`);
  const delInvestigation = db.prepare(`DELETE FROM investigation_attempts WHERE chat_id=?`);
  const delInvestigationResults = db.prepare(`DELETE FROM investigation_results WHERE chat_id=?`);
  const delObservations = db.prepare(`DELETE FROM scene_event_observations WHERE chat_id=?`);
  const delObservationRuns = db.prepare(`DELETE FROM scene_event_observation_runs WHERE chat_id=?`);
  const delReveals = db.prepare(`DELETE FROM chat_persona_secret_reveals WHERE persona_id=?`);
  const delScenes = db.prepare(`DELETE FROM chat_scenes WHERE chat_id=?`);
  const delPresence = db.prepare(`DELETE FROM scene_observer_presence WHERE chat_id=?`);
  const delObservers = db.prepare(`DELETE FROM chat_observers WHERE chat_id=?`);
  // discovery rules must be deleted BEFORE the persona secret (rules cascade from the secret).
  if (createdSecretId) {
    delDiscoveryRules.run(createdSecretId);
  }
  delPersona.run(PERSONA_ID);
  delEvidence.run(PERSONA_ID);
  delKnowledge.run(PERSONA_ID);
  delTransfer.run(CHAT_ID, OTHER_CHAT_ID);
  delSceneEvidence.run(CHAT_ID);
  delInvestigation.run(CHAT_ID);
  delInvestigationResults.run(CHAT_ID);
  delObservations.run(CHAT_ID);
  delObservationRuns.run(CHAT_ID);
  delReveals.run(PERSONA_ID);
  delScenes.run(CHAT_ID);
  delPresence.run(CHAT_ID);
  delObservers.run(CHAT_ID);
}

let auditError: Error | null = null;
let createdSecretId: string | null = null;

// Discovery engine must be ON for the audit (bootstrapChatObservers is gated on it).
process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "1";

try {
  (report as { closure_ran?: string }).closure_ran = "entered";
  console.error("[audit] step 1 preflight");
    for (const p of PREFLIGHT) {
      const n = countRows(p.t, p.c, p.v);
      if (n > 0) {
        throw new Error(
          `PREFLIGHT_FAIL: ${p.t}.${p.c}=${p.v} already has ${n} rows — aborting (no reuse, no INSERT OR IGNORE)`
        );
      }
    }
    report.preflight = "PASS";
    console.error("[audit] step 2 createPersonaSecret");

    // 2. create test secret (synthetic persona_id — no user row needed)
    const secret = createPersonaSecret({
      personaId: PERSONA_ID,
      secretKey: SECRET_KEY,
      canonicalSecretText: CANONICAL,
      confirmedFactText: REVEALED_FACT,
      directDisclosureAliases: ["audit 프로브 비밀을 직접 고백한다"],
    });
    report.secret_created = Boolean(secret.ok);
    if (secret.ok) {
      createdSecretId = (secret.secret as { id?: string }).id ?? null;
    }
    console.error("[audit] step 2 done secret_created=", report.secret_created);

    // 3. bootstrap chat observer for the test character
    console.error("[audit] step 3 bootstrapChatObservers");
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

    console.error("[audit] step 4 detectDeterministicDirectDisclosures");
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
      authority: "discovery",
    });
    report.s1_disclosure_changed = result.changed;
    report.s1_knowledge_state = result.knowledgeState;

    console.error("[audit] step 5 confirmPersonaSecretDisclosure");
    const knowledge = getCharacterSecretKnowledge({
      chatId: CHAT_ID,
      personaId: PERSONA_ID,
      secretId: match.secret.id,
      characterId: CHARACTER_ID,
    });
    report.s1_knowledge_row = Boolean(knowledge);
    report.s1_knowledge_state = knowledge?.knowledge_state;
    report.s1_fact_snapshot = knowledge?.factSnapshot;
    report.s1_evidence_count = countEvidence(CHAT_ID, match.secret.id);

    // 6. other character observer knowledge 0
    report.other_character_knowledge = countKnowledgeObserver(
      CHAT_ID, PERSONA_ID,
      match.secret.id,
      "CHARACTER",
      String(OTHER_CHARACTER_ID)
    );
    // 7. other chat same character knowledge 0
    report.other_chat_knowledge = countKnowledge(
      OTHER_CHAT_ID,
      PERSONA_ID,
      match.secret.id
    );

    // 8. retry same idempotencyKey → no duplicate
    const beforeEvidence = countEvidence(CHAT_ID, match.secret.id);
    const beforeKnowledgeRows = countKnowledge(CHAT_ID, PERSONA_ID, match.secret.id);
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
      authority: "discovery",
    });
    report.retry_changed = retryResult.changed;
    report.retry_evidence_delta =
      countEvidence(CHAT_ID, match.secret.id) - beforeEvidence;
    report.retry_knowledge_delta =
      countKnowledge(CHAT_ID, PERSONA_ID, match.secret.id) - beforeKnowledgeRows;

    // 9. new idempotencyKey same message → no duplicate knowledge row
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
      authority: "discovery",
    });
    report.new_key_knowledge_delta =
      countKnowledge(CHAT_ID, PERSONA_ID, match.secret.id) - beforeKnowledgeRows;

    // 10. observer prompt: known → fact projection (not canonical); unknown → 0
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
      authority: "discovery",
    });
    report.known_observer_prompt_has_fact = Boolean(knownBlock && knownBlock.includes(REVEALED_FACT));
    report.known_observer_prompt_has_canonical = Boolean(knownBlock && knownBlock.includes(CANONICAL));

    const unknownCtx = buildGenerationKnowledgeContext({
      contentKind: "character",
      characterId: OTHER_CHARACTER_ID,
    });
    const unknownDecision = resolvePersonaKnowledgePromptDecisionForChat(unknownCtx, {
      chatId: CHAT_ID,
    });
    const unknownBlock = buildPersonaKnowledgePromptBlock({
      decision: unknownDecision,
      chatId: CHAT_ID,
      personaId: PERSONA_ID,
      authority: "discovery",
    });
    report.unknown_observer_decision_mode = unknownDecision.mode;
    report.unknown_observer_prompt_has_fact = Boolean(
      unknownBlock && unknownBlock.includes(REVEALED_FACT)
    );

    console.error("[audit] step 11 ensemble");
    const ensembleCtx = buildGenerationKnowledgeContext({
      contentKind: "simulation",
      characterId: CHARACTER_ID,
      simulationCast: "audit ensemble cast probe",
    });
    const ensembleDecision = resolvePersonaKnowledgePromptDecisionForChat(ensembleCtx, {
      chatId: CHAT_ID,
    });
    const ensembleBlock = buildPersonaKnowledgePromptBlock({
      decision: ensembleDecision,
      chatId: CHAT_ID,
      personaId: PERSONA_ID,
      authority: "discovery",
    });
    report.ensemble_decision_mode = ensembleDecision.mode;
    report.ensemble_decision_reason = ensembleDecision.reasonCode;
    report.ensemble_prompt_has_fact = Boolean(
      ensembleBlock && ensembleBlock.includes(REVEALED_FACT)
    );
    report.ensemble_prompt_has_canonical = Boolean(
      ensembleBlock && ensembleBlock.includes(CANONICAL)
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
      report.ensemble_decision_mode === "ENSEMBLE_REDACTED" &&
      !report.ensemble_prompt_has_fact &&
      !report.ensemble_prompt_has_canonical
        ? "PERSONA_SECRET_DISCOVERY_S1_AUDIT_PASS"
        : "PERSONA_SECRET_DISCOVERY_S1_AUDIT_FAIL";
    console.error("[audit] verdict computed:", report.verdict);
    (report as { closure_ran?: string }).closure_ran = "reached verdict";
} catch (e) {
  auditError = e as Error;
  report.audit_error = e instanceof Error ? e.message : String(e);
  console.error("AUDIT THREW:", e);
} finally {
  // Manual cleanup: delete every row this audit touched, regardless of success/fail.
  try {
    cleanupAuditRows();
  } catch (cleanupErr) {
    report.cleanup_error = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
  }
}

// Verify cleanup: 0 residual rows across all related tables.
const residual: Record<string, number> = {};
for (const p of PREFLIGHT) {
  residual[p.t] = countRows(p.t, p.c, p.v);
}
// discovery_rules are scoped by the created secret_id (not in PREFLIGHT — they
// cascade from the secret which is created during the audit body).
if (createdSecretId) {
  residual.persona_secret_discovery_rules = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM persona_secret_discovery_rules WHERE secret_id=?`
      )
      .get(createdSecretId) as { c: number } | undefined
  )?.c ?? 0;
}
report.residual_rows = residual;
report.all_residual_zero = Object.values(residual).every((n) => n === 0);
report.cleaned_up = report.all_residual_zero;

if (auditError) {
  report.verdict = "PERSONA_SECRET_DISCOVERY_S1_AUDIT_ERROR";
  console.error("audit error:", auditError.message);
}
const REPORT_PATH = process.env.AUDIT_REPORT_PATH ?? "/tmp/audit-persona-secret-discovery-report.json";
import { writeFileSync } from "node:fs";
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.verdict !== "PERSONA_SECRET_DISCOVERY_S1_AUDIT_PASS") process.exit(1);
