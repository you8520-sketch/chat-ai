/**
 * Server-side provenance gate for Shared Initial episodic facts.
 *
 * The extractor proposes `evidence:{source_role, source_quote}`. This module
 * resolves the canonical USER / finalized ASSISTANT message of the source turn,
 * proves the quote is a verbatim span of that message, and decides authority from
 * role + evidence_type. A quote proves where words came from, never that the
 * LLM-written `fact_text` is entailed by it, so the verified quote — not
 * `fact_text` — is what the prompt injects (see renderVerifiedEvidenceText):
 *   - user quote            → USER_EXPLICIT (the user's own words/actions/choices)
 *   - assistant claim quote → CHARACTER_CLAIM (attribution only, never objective)
 *   - assistant scene quote → CURRENT_SCENE, except user-owned actions and
 *     durable user↔cast history, which assistant narration cannot authorize.
 * `fact_text` of a verified row is a retrieval gloss only. It may reject or
 * downgrade a fact but never grants authority or reaches the prompt.
 */
import type Database from "better-sqlite3";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";
import {
  clauseNeedsUserAuthority,
  isAttributedMemoryClaim,
  mentionsUser,
  resolvePersonaName,
} from "./memory-source-authority";
import type {
  EpisodicEvidenceRole,
  EpisodicExtractedFact,
} from "./memory-episodic-types";

export const EPISODIC_EVIDENCE_QUOTE_MIN_CHARS = 6;
export const EPISODIC_EVIDENCE_QUOTE_MAX_CHARS = 300;

export type EpisodicEvidenceAuthority = "USER_EXPLICIT" | "CHARACTER_CLAIM" | "CURRENT_SCENE";

export type EpisodicVerifiedEvidence = {
  role: EpisodicEvidenceRole;
  message_id: number;
  /** Verbatim span after NFC / line-ending / whitespace-run normalization only. */
  quote: string;
  authority: EpisodicEvidenceAuthority;
  match: "normalized_exact";
};

export type EpisodicEvidenceRejection =
  | "evidence_missing"
  | "evidence_quote_too_short"
  | "evidence_quote_too_long"
  | "evidence_type_role_mismatch"
  | "evidence_message_unavailable"
  | "evidence_quote_not_in_message"
  | "assistant_evidence_cannot_authorize_user_action"
  | "assistant_evidence_cannot_authorize_user_linked_history";

export type EpisodicEvidenceDecision =
  | { accepted: true; evidence: EpisodicVerifiedEvidence }
  | { accepted: false; reason: EpisodicEvidenceRejection };

export type EpisodicEvidenceBinding = {
  userMessageId: number | null;
  assistantMessageId: number;
};

type CanonicalSource = { id: number; text: string };

export type EpisodicEvidenceSources = {
  user: CanonicalSource | null;
  assistant: CanonicalSource | null;
};

/** NFC, line endings and whitespace runs only. Negation, tense, actors and punctuation are preserved. */
export function normalizeEvidenceSpan(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
}

function positiveId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type MessageRow = {
  id: number;
  role: string;
  content: string | null;
  generation_status: string | null;
};

/** Load the canonical source messages at persist time (same transaction as the write). */
export function loadEpisodicEvidenceSources(
  db: Database.Database,
  chatId: number,
  binding: EpisodicEvidenceBinding
): EpisodicEvidenceSources {
  const read = (id: number | null): MessageRow | null => {
    const messageId = positiveId(id);
    if (messageId == null) return null;
    return (
      (db
        .prepare(
          "SELECT id, role, content, generation_status FROM messages WHERE id=? AND chat_id=?"
        )
        .get(messageId, chatId) as MessageRow | undefined) ?? null
    );
  };
  const userRow = read(binding.userMessageId);
  const assistantRow = read(binding.assistantMessageId);
  return {
    user:
      userRow && userRow.role === "user" && typeof userRow.content === "string"
        ? { id: userRow.id, text: normalizeEvidenceSpan(userRow.content) }
        : null,
    assistant:
      assistantRow &&
      assistantRow.role === "assistant" &&
      isSuccessfulDurableGenerationStatus(assistantRow.generation_status) &&
      typeof assistantRow.content === "string"
        ? { id: assistantRow.id, text: normalizeEvidenceSpan(assistantRow.content) }
        : null,
  };
}

/**
 * Re-binds already-verified evidence to the child chat's own copy of the source message.
 * Returns null unless that message exists in `chatId` with the same role and still contains the quote.
 */
export function rebindVerifiedEvidenceToChat(
  db: Database.Database,
  chatId: number,
  evidence: EpisodicVerifiedEvidence,
  childMessageId: number
): EpisodicVerifiedEvidence | null {
  const sources = loadEpisodicEvidenceSources(db, chatId, {
    userMessageId: evidence.role === "user" ? childMessageId : null,
    assistantMessageId: evidence.role === "assistant" ? childMessageId : 0,
  });
  const source = evidence.role === "user" ? sources.user : sources.assistant;
  if (!source || !source.text.includes(normalizeEvidenceSpan(evidence.quote))) return null;
  return { ...evidence, message_id: source.id };
}

const AUTHORITIES: ReadonlySet<string> = new Set<EpisodicEvidenceAuthority>([
  "USER_EXPLICIT",
  "CHARACTER_CLAIM",
  "CURRENT_SCENE",
]);

const AUTHORITY_LABEL: Record<EpisodicEvidenceAuthority, string> = {
  USER_EXPLICIT: "유저 입력 발췌",
  CURRENT_SCENE: "AI 장면 서술 발췌",
  CHARACTER_CLAIM: "캐릭터 발언(미확정 주장)",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the server-written `metadata.evidence`; anything malformed is treated as absent (legacy row). */
export function readVerifiedEvidence(
  metadata: string | null | undefined
): EpisodicVerifiedEvidence | null {
  if (!metadata) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  const evidence = isRecord(parsed) ? parsed.evidence : null;
  if (!isRecord(evidence)) return null;
  const { role, message_id: messageId, quote, authority, match } = evidence;
  if (role !== "user" && role !== "assistant") return null;
  if (positiveId(messageId) == null) return null;
  if (typeof quote !== "string" || !quote.trim()) return null;
  if (typeof authority !== "string" || !AUTHORITIES.has(authority)) return null;
  if (match !== "normalized_exact") return null;
  return {
    role,
    message_id: Number(messageId),
    quote,
    authority: authority as EpisodicEvidenceAuthority,
    match,
  };
}

/** The only text a verified row may contribute to the prompt: its verbatim quote with a server-set origin label. */
export function renderVerifiedEvidenceText(evidence: EpisodicVerifiedEvidence): string {
  return `[${AUTHORITY_LABEL[evidence.authority]}] “${evidence.quote}”`;
}

function normalizePersonaKey(personaName: string | null): string {
  return (personaName ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/** Facts whose subject is the user (or the saved persona, or a pair keyed by either) describe the user's own words/actions/choices. */
function subjectOwnedByUser(subject: string, personaName: string | null): boolean {
  const key = `_${subject}_`;
  if (key.includes("_user_")) return true;
  const persona = normalizePersonaKey(personaName);
  return persona.length > 0 && key.includes(`_${persona}_`);
}

function reject(reason: EpisodicEvidenceRejection): EpisodicEvidenceDecision {
  return { accepted: false, reason };
}

export function evaluateEpisodicFactEvidence(
  fact: EpisodicExtractedFact,
  sources: EpisodicEvidenceSources,
  opts: { userPersona?: string | null } = {}
): EpisodicEvidenceDecision {
  const claim = fact.evidence;
  if (!claim) return reject("evidence_missing");

  const quote = normalizeEvidenceSpan(claim.source_quote);
  if ([...quote.replace(/\s+/gu, "")].length < EPISODIC_EVIDENCE_QUOTE_MIN_CHARS) {
    return reject("evidence_quote_too_short");
  }
  if ([...quote].length > EPISODIC_EVIDENCE_QUOTE_MAX_CHARS) {
    return reject("evidence_quote_too_long");
  }

  const role = claim.source_role;
  switch (fact.evidence_type) {
    case "explicit_user_statement":
      if (role !== "user") return reject("evidence_type_role_mismatch");
      break;
    case "explicit_character_claim":
      if (role !== "assistant") return reject("evidence_type_role_mismatch");
      break;
    case "explicit_scene_event":
      break;
    case "canon":
    case undefined:
      return reject("evidence_type_role_mismatch");
    default: {
      const exhausted: never = fact.evidence_type;
      return exhausted;
    }
  }

  const source = role === "user" ? sources.user : sources.assistant;
  if (!source) return reject("evidence_message_unavailable");
  if (!source.text.includes(quote)) return reject("evidence_quote_not_in_message");

  const verified = (authority: EpisodicEvidenceAuthority): EpisodicEvidenceDecision => ({
    accepted: true,
    evidence: {
      role,
      message_id: source.id,
      quote,
      authority,
      match: "normalized_exact",
    },
  });

  if (role === "user") return verified("USER_EXPLICIT");
  if (fact.evidence_type === "explicit_character_claim") return verified("CHARACTER_CLAIM");

  const factText = String(fact.fact_text || fact.value || "").trim();
  const personaName = resolvePersonaName(opts.userPersona);
  if (isAttributedMemoryClaim(quote) || isAttributedMemoryClaim(factText)) {
    return verified("CHARACTER_CLAIM");
  }
  if (subjectOwnedByUser(fact.subject, personaName)) {
    return reject("assistant_evidence_cannot_authorize_user_action");
  }
  const userLinkedHistory = [quote, factText].some(
    (text) =>
      mentionsUser(text, personaName) &&
      (fact.category === "relationship" ||
        clauseNeedsUserAuthority(text, personaName, fact.category))
  );
  if (userLinkedHistory) {
    return reject("assistant_evidence_cannot_authorize_user_linked_history");
  }
  return verified("CURRENT_SCENE");
}
