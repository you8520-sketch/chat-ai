import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { assertObserverSpecificKnowledgeQueryAllowed } from "@/lib/personaKnowledgePromptPolicy";
import type { PersonaKnowledgePromptDecision } from "@/lib/personaKnowledgePromptPolicy";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  ChatCharacterSecretKnowledgeRow,
  PersonaSecretImportance,
  PersonaSecretKnowledgeState,
  PersonaSecretObserverType,
} from "@/lib/personaSecretDiscoveryTypes";
import {
  filterVisiblePersonaSecretReveals,
  listChatPersonaSecretReveals,
  sanitizeRevealedFactForPrompt,
  type ChatPersonaSecretRevealRow,
} from "@/lib/personaSecretReveal";
import { getPersonaSecretById } from "@/lib/personaSecrets";

/** Discovery ON uses knowledge rows only (read-only prompt build). Legacy uses reveal-table compat. */
export type PersonaKnowledgePromptAuthority = "discovery" | "legacy";

/** Omitted authority defaults to legacy (test/compatibility callers only — production must pass explicit). */
function resolvePromptAuthority(
  authority?: PersonaKnowledgePromptAuthority
): PersonaKnowledgePromptAuthority {
  return authority ?? "legacy";
}

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 1200;

const IMPORTANCE_RANK: Record<PersonaSecretImportance, number> = {
  CRITICAL: 0,
  IMPORTANT: 1,
  NORMAL: 2,
};

export function getObserverSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  observerType: PersonaSecretObserverType;
  observerId: string;
  db?: Database.Database;
}): ChatCharacterSecretKnowledgeRow | null {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const row = db
    .prepare(
      `SELECT * FROM chat_character_secret_knowledge
       WHERE chat_id=? AND persona_id=? AND secret_id=?
         AND observer_type=? AND observer_id=?`
    )
    .get(
      opts.chatId,
      opts.personaId,
      opts.secretId,
      opts.observerType,
      opts.observerId
    ) as ChatCharacterSecretKnowledgeRow | undefined;
  return row ?? null;
}

export function getCharacterSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  characterId: number;
  db?: Database.Database;
}): ChatCharacterSecretKnowledgeRow | null {
  return getObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: "CHARACTER",
    observerId: String(opts.characterId),
    db: opts.db,
  });
}

export function listConfirmedCharacterSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  db?: Database.Database;
}): ChatCharacterSecretKnowledgeRow[] {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  return db
    .prepare(
      `SELECT * FROM chat_character_secret_knowledge
       WHERE chat_id=? AND persona_id=?
         AND observer_type='CHARACTER' AND observer_id=?
         AND knowledge_state='CONFIRMED'
       ORDER BY updated_at DESC, secret_id ASC`
    )
    .all(opts.chatId, opts.personaId, String(opts.characterId)) as ChatCharacterSecretKnowledgeRow[];
}

export function listKnownCharacterSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  db?: Database.Database;
}): ChatCharacterSecretKnowledgeRow[] {
  return listKnownObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: "CHARACTER",
    observerId: String(opts.characterId),
    db: opts.db,
  });
}

export function listKnownObserverSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  observerType: PersonaSecretObserverType;
  observerId: string;
  db?: Database.Database;
}): ChatCharacterSecretKnowledgeRow[] {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  return db
    .prepare(
      `SELECT * FROM chat_character_secret_knowledge
       WHERE chat_id=? AND persona_id=?
         AND observer_type=? AND observer_id=?
         AND knowledge_state IN ('SUSPECTED','CONFIRMED')
       ORDER BY
         CASE knowledge_state WHEN 'CONFIRMED' THEN 0 ELSE 1 END,
         updated_at DESC, secret_id ASC`
    )
    .all(
      opts.chatId,
      opts.personaId,
      opts.observerType,
      opts.observerId
    ) as ChatCharacterSecretKnowledgeRow[];
}

export function upsertObserverSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  observerType: PersonaSecretObserverType;
  observerId: string;
  knowledgeState: PersonaSecretKnowledgeState;
  confidence: number;
  factSnapshot: string;
  confirmedTurn?: number | null;
  firstSuspectedTurn?: number | null;
  lastEvidenceEventId: string;
  db?: Database.Database;
}): void {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const fact = sanitizeRevealedFactForPrompt(opts.factSnapshot);
  if (!fact) return;
  db.prepare(
    `INSERT INTO chat_character_secret_knowledge (
       chat_id, persona_id, secret_id, observer_type, observer_id,
       knowledge_state, confidence, fact_snapshot,
       first_suspected_turn, confirmed_turn, last_evidence_event_id, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(chat_id, persona_id, secret_id, observer_type, observer_id)
     DO UPDATE SET
       knowledge_state=excluded.knowledge_state,
       confidence=excluded.confidence,
       fact_snapshot=excluded.fact_snapshot,
       first_suspected_turn=COALESCE(
         chat_character_secret_knowledge.first_suspected_turn,
         excluded.first_suspected_turn
       ),
       confirmed_turn=COALESCE(
         excluded.confirmed_turn,
         chat_character_secret_knowledge.confirmed_turn
       ),
       last_evidence_event_id=excluded.last_evidence_event_id,
       updated_at=datetime('now')`
  ).run(
    opts.chatId,
    opts.personaId,
    opts.secretId,
    opts.observerType,
    opts.observerId,
    opts.knowledgeState,
    opts.confidence,
    fact,
    opts.firstSuspectedTurn ?? null,
    opts.confirmedTurn ?? null,
    opts.lastEvidenceEventId
  );
}

export function upsertCharacterSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  characterId: number;
  knowledgeState: PersonaSecretKnowledgeState;
  confidence: number;
  factSnapshot: string;
  confirmedTurn?: number | null;
  firstSuspectedTurn?: number | null;
  lastEvidenceEventId: string;
  db?: Database.Database;
}): void {
  upsertObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: "CHARACTER",
    observerId: String(opts.characterId),
    knowledgeState: opts.knowledgeState,
    confidence: opts.confidence,
    factSnapshot: opts.factSnapshot,
    confirmedTurn: opts.confirmedTurn,
    firstSuspectedTurn: opts.firstSuspectedTurn,
    lastEvidenceEventId: opts.lastEvidenceEventId,
    db: opts.db,
  });
}

type RuntimeFact = {
  secretId: string;
  fact: string;
  importance: PersonaSecretImportance;
  updatedAt: string;
};

/**
 * Lazy-migrate a legacy reveal row into S1 knowledge when secret_key matches exactly.
 * Kept local (no disclosure module import) to avoid circular deps.
 */
export function migrateLegacyRevealIfMatched(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  reveal: ChatPersonaSecretRevealRow;
  db?: Database.Database;
}): boolean {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const secret = db
    .prepare(
      `SELECT id, confirmed_fact_text FROM persona_secrets
       WHERE persona_id=? AND secret_key=?
       LIMIT 1`
    )
    .get(opts.personaId, opts.reveal.secret_key) as
    | { id: string; confirmed_fact_text: string }
    | undefined;
  if (!secret) return false;

  const existing = getCharacterSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: secret.id,
    characterId: opts.characterId,
    db,
  });
  if (existing?.knowledge_state === "CONFIRMED") return false;

  const fact =
    sanitizeRevealedFactForPrompt(opts.reveal.revealed_fact_text) ||
    sanitizeRevealedFactForPrompt(secret.confirmed_fact_text);
  if (!fact) return false;

  const eventId = randomUUID();
  const idempotencyKey = `legacy:${opts.chatId}:${opts.personaId}:${secret.id}:${opts.characterId}:${opts.reveal.id}`;
  const insert = db
    .prepare(
      `INSERT OR IGNORE INTO persona_secret_evidence_events (
         id, idempotency_key, chat_id, turn_number, source_message_id,
         persona_id, secret_id, discovery_rule_id,
         observer_type, observer_id, method, source_type, resulting_state,
         revealed_fact_snapshot, evidence_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      eventId,
      idempotencyKey,
      opts.chatId,
      opts.reveal.revealed_at_turn,
      null,
      opts.personaId,
      secret.id,
      null,
      "CHARACTER",
      String(opts.characterId),
      "DIRECT_DISCLOSURE",
      "LEGACY_REVEAL_MIGRATION",
      "CONFIRMED",
      fact,
      JSON.stringify({
        legacyRevealId: opts.reveal.id,
        legacySource: opts.reveal.source,
        legacyTurn: opts.reveal.revealed_at_turn,
      })
    );
  if (insert.changes === 0) return false;

  upsertCharacterSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: secret.id,
    characterId: opts.characterId,
    knowledgeState: "CONFIRMED",
    confidence: 100,
    factSnapshot: fact,
    confirmedTurn: opts.reveal.revealed_at_turn,
    lastEvidenceEventId: eventId,
    db,
  });
  return true;
}

/**
 * Build runtime known-facts block for one authoritative observer.
 * Never includes canonical_secret_text, titles, or UNKNOWN counts.
 * Forbidden inside ENSEMBLE_REDACTED assembly scope.
 */
export function buildKnownPersonaFactsForObserver(opts: {
  chatId: number;
  personaId: number;
  observerType: PersonaSecretObserverType;
  observerId: string;
  /** Optional legacy secret_description for filtering old reveal rows (legacy authority only). */
  legacySecretDescription?: string;
  /** discovery = knowledge rows only, no legacy IO. legacy = reveal-table compatibility. */
  authority?: PersonaKnowledgePromptAuthority;
  /** S4 opaque fact refs — inline on lines only (secretId → K1). */
  factRefBySecretId?: Map<string, string>;
  db?: Database.Database;
}): string | null {
  assertObserverSpecificKnowledgeQueryAllowed();
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const authority = resolvePromptAuthority(opts.authority);

  // Legacy reveal migration only applies to CHARACTER observers with numeric ids.
  const characterIdForLegacy =
    authority === "legacy" &&
    opts.observerType === "CHARACTER" &&
    /^\d+$/.test(opts.observerId)
      ? Number(opts.observerId)
      : null;

  const legacyReveals =
    characterIdForLegacy != null
      ? listChatPersonaSecretReveals(opts.chatId, opts.personaId, db)
      : [];
  const visibleLegacy =
    characterIdForLegacy != null
      ? opts.legacySecretDescription
        ? filterVisiblePersonaSecretReveals(legacyReveals, opts.legacySecretDescription)
        : legacyReveals
      : [];
  if (characterIdForLegacy != null) {
    for (const reveal of visibleLegacy) {
      if (String(reveal.source).toLowerCase().includes("assistant")) continue;
      migrateLegacyRevealIfMatched({
        chatId: opts.chatId,
        personaId: opts.personaId,
        characterId: characterIdForLegacy,
        reveal,
        db,
      });
    }
  }

  const knowledge = listKnownObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    db,
  });

  type RuntimeFactWithState = RuntimeFact & { state: "SUSPECTED" | "CONFIRMED" };
  const facts: RuntimeFactWithState[] = [];
  const seen = new Set<string>();

  for (const row of knowledge) {
    const fact = sanitizeRevealedFactForPrompt(row.fact_snapshot);
    if (!fact || seen.has(fact)) continue;
    const secret = getPersonaSecretById(row.secret_id, db);
    const importance = (secret?.importance as PersonaSecretImportance) || "NORMAL";
    facts.push({
      secretId: row.secret_id,
      fact,
      importance,
      updatedAt: row.updated_at,
      state: row.knowledge_state === "SUSPECTED" ? "SUSPECTED" : "CONFIRMED",
    });
    seen.add(fact);
  }

  // Compatibility: legacy reveals without matching persona_secrets still inject fact snapshots.
  if (authority !== "legacy") {
    if (facts.length === 0) return null;
  } else for (const reveal of visibleLegacy) {
    if (String(reveal.source).toLowerCase().includes("assistant")) continue;
    const fact = sanitizeRevealedFactForPrompt(reveal.revealed_fact_text);
    if (!fact || seen.has(fact)) continue;
    const matched = db
      .prepare(
        `SELECT id FROM persona_secrets WHERE persona_id=? AND secret_key=? LIMIT 1`
      )
      .get(opts.personaId, reveal.secret_key) as { id: string } | undefined;
    if (matched && knowledge.some((k) => k.secret_id === matched.id)) continue;
    facts.push({
      secretId: matched?.id ?? `legacy:${reveal.secret_key}`,
      fact,
      importance: "NORMAL",
      updatedAt: reveal.created_at,
      state: "CONFIRMED",
    });
    seen.add(fact);
  }

  if (facts.length === 0) return null;

  facts.sort((a, b) => {
    if (a.state !== b.state) return a.state === "CONFIRMED" ? -1 : 1;
    const ia = IMPORTANCE_RANK[a.importance] ?? 2;
    const ib = IMPORTANCE_RANK[b.importance] ?? 2;
    if (ia !== ib) return ia - ib;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.secretId.localeCompare(b.secretId);
  });

  const critical = facts.filter((f) => f.importance === "CRITICAL");
  const rest = facts.filter((f) => f.importance !== "CRITICAL");
  const selected = [...critical, ...rest].slice(0, MAX_FACTS);

  const confirmedLines: string[] = [];
  const suspectedLines: string[] = [];
  let chars = 0;
  for (const item of selected) {
    const ref = opts.factRefBySecretId?.get(item.secretId);
    const prefix = ref ? `[${ref}] ` : "";
    const line = `- ${prefix}${item.fact}`;
    if (chars + line.length > MAX_FACT_CHARS && confirmedLines.length + suspectedLines.length > 0) {
      break;
    }
    if (item.state === "SUSPECTED") suspectedLines.push(line);
    else confirmedLines.push(line);
    chars += line.length + 1;
  }
  if (confirmedLines.length + suspectedLines.length === 0) return null;

  const sections: string[] = [
    "[CHARACTER-KNOWN FACTS ABOUT THE USER]",
    "아래는 현재 채팅의 현재 캐릭터가 실제로 관찰·확인한 유저 관련 사실이다.",
    "목록에 없는 비밀은 캐릭터 지식으로 간주하지 않는다.",
    "반응의 강도와 표현은 캐릭터 성격과 현재 상황에 맞춘다. 이 목록을 중심으로 장면을 강제하지 않는다.",
  ];
  if (confirmedLines.length > 0) {
    sections.push("", "CONFIRMED", ...confirmedLines);
  }
  if (suspectedLines.length > 0) {
    sections.push(
      "",
      "SUSPECTED",
      "다음은 목격·단서로 짐작되는 사실이다. 확정된 원인·명칭·소속·의미로 단정하지 않는다.",
      ...suspectedLines
    );
  }
  return sections.join("\n");
}

/**
 * Character-observer convenience wrapper (1:1 authoritative speaker path).
 */
export function buildCharacterKnownFactsBlock(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  legacySecretDescription?: string;
  authority?: PersonaKnowledgePromptAuthority;
  db?: Database.Database;
}): string | null {
  return buildKnownPersonaFactsForObserver({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: "CHARACTER",
    observerId: String(opts.characterId),
    legacySecretDescription: opts.legacySecretDescription,
    authority: opts.authority,
    db: opts.db,
  });
}

/**
 * Top-level assembler: ENSEMBLE_REDACTED omits the block entirely (no empty stub).
 */
export function buildPersonaKnowledgePromptBlock(opts: {
  decision: PersonaKnowledgePromptDecision;
  chatId: number;
  personaId: number;
  legacySecretDescription?: string;
  authority?: PersonaKnowledgePromptAuthority;
  factRefBySecretId?: Map<string, string>;
  db?: Database.Database;
}): string | null {
  if (opts.decision.mode === "ENSEMBLE_REDACTED") return null;
  if (!opts.decision.observerType || !opts.decision.observerId) return null;
  const authority = resolvePromptAuthority(opts.authority);
  return buildKnownPersonaFactsForObserver({
    chatId: opts.chatId,
    personaId: opts.personaId,
    observerType: opts.decision.observerType,
    observerId: opts.decision.observerId,
    legacySecretDescription:
      authority === "legacy" ? opts.legacySecretDescription : undefined,
    authority,
    factRefBySecretId: opts.factRefBySecretId,
    db: opts.db,
  });
}

