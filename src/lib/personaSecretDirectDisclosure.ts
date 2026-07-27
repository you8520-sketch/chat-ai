import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  PersonaSecretDiscoveryRuleRow,
  PersonaSecretEvidenceSourceType,
  PersonaSecretRow,
} from "@/lib/personaSecretDiscoveryTypes";
import {
  listDirectDisclosureRulesForPersona,
  parseDirectDisclosureConditions,
} from "@/lib/personaSecrets";
import {
  insertChatPersonaSecretReveal,
  sanitizeRevealedFactForPrompt,
} from "@/lib/personaSecretReveal";
import {
  getCharacterSecretKnowledge,
  upsertCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";

function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”"']/g, "");
}

function isQuestionLike(text: string): boolean {
  return /[?？]|인가\??|일까\??|할까요|겠니|겠어\??|같아\??|생각해\??/.test(text);
}

function isHypothetical(text: string): boolean {
  return /(?:라면|다면|였다면|왔다면|라면서|가정이|만약|만약에|한다면)/.test(text);
}

function isNegatedDisclosure(text: string): boolean {
  return /(?:아니(?:야|에요|다)|아닌|온\s*게\s*아니|온\s*적이\s*없|그런\s*적\s*없)/.test(
    text
  );
}

function isThirdPartyOrQuotedDisclosure(text: string): boolean {
  return /(?:들었|이야기(?:를)?\s*들었|사람이|누군가|친구가|소설|설정(?:으로|상)|작품\s*속)/.test(
    text
  );
}

function hasFirstPersonCue(text: string): boolean {
  return /(?:^|\s)(?:나|난|내가|나는|저|제가|저는)\b|나\s|난\s|내가\s|나는\s|저는\s|제가\s/.test(
    text
  );
}

function hasAssertiveCue(text: string): boolean {
  return /(?:사실|솔직히|진짜|맞아|왔어|출신|생겼|생겼어|생겼어\.|이야|이야\.|야\.|에요|예요)/.test(
    text
  );
}

export type DirectDisclosureMatch = {
  secret: PersonaSecretRow;
  rule: PersonaSecretDiscoveryRuleRow;
  revealedFactText: string;
  matchedAlias: string;
};

/**
 * High-precision deterministic detector — false negative preferred.
 * Never uses canonical_secret_text against the model; aliases only.
 */
export function detectDeterministicDirectDisclosures(
  userMessage: string,
  personaId: number,
  db: Database.Database = getDb()
): DirectDisclosureMatch[] {
  const msg = userMessage.trim();
  if (!msg) return [];
  if (
    isQuestionLike(msg) ||
    isHypothetical(msg) ||
    isNegatedDisclosure(msg) ||
    isThirdPartyOrQuotedDisclosure(msg)
  ) {
    return [];
  }
  if (!hasFirstPersonCue(msg) || !hasAssertiveCue(msg)) return [];

  const normalizedMsg = normalizeForMatch(msg);
  const rules = listDirectDisclosureRulesForPersona(personaId, db);
  const out: DirectDisclosureMatch[] = [];

  for (const rule of rules) {
    const conditions = parseDirectDisclosureConditions(rule.conditions_json);
    if (conditions.requires_first_person === false) continue;
    if (conditions.requires_assertive_statement === false) continue;
    let matchedAlias = "";
    for (const alias of conditions.aliases) {
      const normalizedAlias = normalizeForMatch(alias);
      if (!normalizedAlias) continue;
      if (normalizedMsg.includes(normalizedAlias)) {
        matchedAlias = alias;
        break;
      }
    }
    if (!matchedAlias) continue;
    const fact =
      sanitizeRevealedFactForPrompt(rule.revealed_fact_text) ||
      sanitizeRevealedFactForPrompt(rule.secret.confirmed_fact_text);
    if (!fact) continue;
    out.push({
      secret: rule.secret,
      rule,
      revealedFactText: fact,
      matchedAlias,
    });
  }
  return out;
}

export type ConfirmPersonaSecretDisclosureInput = {
  chatId: number;
  personaId: number;
  secretId: string;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  sourceType: PersonaSecretEvidenceSourceType;
  discoveryRuleId?: string | null;
  revealedFactText: string;
  evidenceJson?: Record<string, unknown>;
  /** Stable across retries for the same logical disclosure. */
  idempotencyKey: string;
};

export type DisclosureResult = {
  changed: boolean;
  knowledgeState: "CONFIRMED";
  eventId: string | null;
};

export function confirmPersonaSecretDisclosure(
  input: ConfirmPersonaSecretDisclosureInput,
  db: Database.Database = getDb()
): DisclosureResult {
  ensurePersonaSecretDiscoverySchema(db);
  const fact = sanitizeRevealedFactForPrompt(input.revealedFactText);
  if (!fact) {
    return { changed: false, knowledgeState: "CONFIRMED", eventId: null };
  }

  const observerId = String(input.characterId);
  const forbiddenSources = new Set([
    "ASSISTANT_ACK",
    "ASSISTANT_INVENTED_EVENT",
    "SUMMARY_INFERENCE",
    "MODEL_GUESS",
  ]);
  if (forbiddenSources.has(input.sourceType)) {
    return { changed: false, knowledgeState: "CONFIRMED", eventId: null };
  }

  const run = db.transaction((): DisclosureResult => {
    const existingKnowledge = getCharacterSecretKnowledge({
      chatId: input.chatId,
      personaId: input.personaId,
      secretId: input.secretId,
      characterId: input.characterId,
      db,
    });
    if (existingKnowledge?.knowledge_state === "CONFIRMED") {
      return {
        changed: false,
        knowledgeState: "CONFIRMED",
        eventId: existingKnowledge.last_evidence_event_id,
      };
    }

    const eventId = randomUUID();
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
        input.idempotencyKey,
        input.chatId,
        input.turnNumber,
        input.sourceMessageId ?? null,
        input.personaId,
        input.secretId,
        input.discoveryRuleId ?? null,
        "CHARACTER",
        observerId,
        "DIRECT_DISCLOSURE",
        input.sourceType,
        "CONFIRMED",
        fact,
        JSON.stringify(input.evidenceJson ?? {})
      );

    if (insert.changes === 0) {
      const existing = getCharacterSecretKnowledge({
        chatId: input.chatId,
        personaId: input.personaId,
        secretId: input.secretId,
        characterId: input.characterId,
        db,
      });
      return {
        changed: false,
        knowledgeState: "CONFIRMED",
        eventId: existing?.last_evidence_event_id ?? null,
      };
    }

    upsertCharacterSecretKnowledge({
      chatId: input.chatId,
      personaId: input.personaId,
      secretId: input.secretId,
      characterId: input.characterId,
      knowledgeState: "CONFIRMED",
      confidence: 100,
      factSnapshot: fact,
      confirmedTurn: input.turnNumber,
      lastEvidenceEventId: eventId,
      db,
    });

    // Compatibility row for pre-S1 readers — never assistant_ack.
    const secret = db
      .prepare(`SELECT secret_key FROM persona_secrets WHERE id=?`)
      .get(input.secretId) as { secret_key: string } | undefined;
    if (secret?.secret_key) {
      insertChatPersonaSecretReveal(
        {
          chatId: input.chatId,
          personaId: input.personaId,
          secretKey: secret.secret_key,
          revealedFactText: fact,
          revealedAtTurn: input.turnNumber,
          source:
            input.sourceType === "USER_EXPLICIT_UI"
              ? "MANUAL_REVEAL"
              : "USER_AUTHORED_DISCLOSURE",
        },
        db
      );
    }

    return { changed: true, knowledgeState: "CONFIRMED", eventId };
  });

  return run();
}

export function buildDeterministicDisclosureIdempotencyKey(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  characterId: number;
  sourceMessageId?: number | null;
  turnNumber: number;
}): string {
  const msg = opts.sourceMessageId ?? `turn:${opts.turnNumber}`;
  return `det:${opts.chatId}:${opts.personaId}:${opts.secretId}:${opts.characterId}:${msg}`;
}

export function buildExplicitUiDisclosureIdempotencyKey(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  characterId: number;
  sourceMessageId: number;
}): string {
  return `ui:${opts.chatId}:${opts.personaId}:${opts.secretId}:${opts.characterId}:${opts.sourceMessageId}`;
}
