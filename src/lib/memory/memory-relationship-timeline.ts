import type Database from "better-sqlite3";
import {
  formatPromiseLabel,
  type HonorificNames,
  type MemoryMeta,
  type MemoryPromise,
} from "@/lib/chatMemory";
import { scoreTextLexicalRelevance } from "@/lib/episodicMemoryFacts";
import { parsePossessionEntry } from "@/lib/relationshipMetaItems";
import { sanitizeRecalledMemoryFactText } from "@/lib/runtimePromptContaminationGuard";
import {
  loadChatRelationshipMetaCore,
  loadDeletedTurnRelationshipProvenanceCore,
} from "./memory-relationship-meta";
import {
  EPISODIC_EVIDENCE_QUOTE_MIN_CHARS,
  evaluateEpisodicFactEvidence,
  loadEpisodicEvidenceSources,
  normalizeEvidenceSpan,
  renderVerifiedEvidenceText,
  type EpisodicEvidenceSources,
} from "./memory-episodic-evidence";
import type { EpisodicEvidenceRole } from "./memory-episodic-types";
import { loadMemoryEligibleChatTurnsWithMessageIdsCore } from "./memory-turn-loader";
import type {
  RelationshipLedgerEvent,
  RelationshipLedgerEventChange,
  RelationshipLedgerEventValidity,
} from "./memory-relationship-timeline-types";

export type {
  RelationshipLedgerEvent,
  RelationshipLedgerEventCategory,
  RelationshipLedgerEventChange,
  RelationshipLedgerEventValidity,
} from "./memory-relationship-timeline-types";

/**
 * Read-only projection of the per-turn ledger provenance
 * (`relationshipMetaChange` on the active assistant variant) into a timeline.
 * It owns no storage: the ledger (`chats.memory_meta`) stays the only current
 * state, and a deleted/regenerated/switched turn drops its events with its
 * variant, exactly like the provenance it is derived from.
 */

type RawEvent = Omit<RelationshipLedgerEvent, "validity">;

const PROMISE_RECALL_CUE =
  /(?:예전|그때|지난|무슨).{0,20}약속|약속.{0,20}(?:어떻게|됐|했었|했지|기억)|기로\s*(?:했|한)|취소|파기|없던|지키|지켜|어기|어겼/u;
const PROMISE_HISTORY_MAX_LINES = 2;
const PROMISE_RELEASE_CUE =
  /취소|없던|없었던|무산|파기|미뤄|미루|그만|못\s*(?:가|하|지키|만나|보)|사정|때문|미안/u;
const PROMISE_QUOTE_MAX_CHARS = { user: 200, assistant: 160 } as const;

function promiseLabel(promise: MemoryPromise): string {
  return formatPromiseLabel(promise);
}

function changeKind(
  before: unknown,
  after: unknown
): RelationshipLedgerEventChange {
  if (before == null) return "created";
  if (after == null) return "released";
  return "changed";
}

function possessionKey(line: string): string {
  return parsePossessionEntry(line)?.person ?? line;
}

function eventsForTurn(
  change: NonNullable<
    ReturnType<typeof loadDeletedTurnRelationshipProvenanceCore>["change"]
  >,
  turn: { turn: number; assistantMessageId: number; userMessageId: number | null }
): RawEvent[] {
  const events: RawEvent[] = [];
  change.promises.forEach((entry, index) => {
    const source = (entry.after ?? entry.before)!;
    events.push({
      id: `${turn.assistantMessageId}:promise:${index}`,
      category: "promise",
      change: changeKind(entry.before, entry.after),
      key: source.text,
      label: promiseLabel(source),
      previousLabel: entry.before && entry.after ? promiseLabel(entry.before) : null,
      ...turn,
    });
  });
  change.items.forEach((entry, index) => {
    const source = (entry.after ?? entry.before)!;
    events.push({
      id: `${turn.assistantMessageId}:item:${index}`,
      category: "item",
      change: changeKind(entry.before, entry.after),
      key: possessionKey(source),
      label: source,
      previousLabel: entry.before && entry.after ? entry.before : null,
      ...turn,
    });
  });
  return events;
}

function annotateValidity(
  raw: RawEvent[],
  current: MemoryMeta
): RelationshipLedgerEvent[] {
  const lastByKey = new Map<string, string>();
  for (const event of raw) lastByKey.set(`${event.category}:${event.key}`, event.id);
  const currentPromiseKeys = new Set(current.promises.map((p) => p.text));
  const currentItemKeys = new Set(current.items.map(possessionKey));
  return raw.map((event) => {
    const keyId = `${event.category}:${event.key}`;
    let validity: RelationshipLedgerEventValidity;
    if (lastByKey.get(keyId) !== event.id) validity = "superseded";
    else if (event.change === "released") validity = "ended";
    else {
      const held =
        event.category === "promise"
          ? currentPromiseKeys.has(event.key)
          : currentItemKeys.has(event.key);
      validity = held ? "active" : "absent";
    }
    return { ...event, validity };
  });
}

/**
 * Ledger events in turn order. `beforeAssistantMessageId` hides the turn being
 * regenerated and everything after it, so a retry never recalls its own result.
 */
export function loadRelationshipLedgerEventsCore(
  db: Database.Database,
  chatId: number,
  names: HonorificNames,
  opts: { beforeAssistantMessageId?: number | null } = {}
): RelationshipLedgerEvent[] {
  const candidates = db
    .prepare(
      `SELECT id FROM messages
       WHERE chat_id=? AND role='assistant' AND alternates LIKE '%relationshipMetaChange%'
       ORDER BY id ASC`
    )
    .all(chatId) as { id: number }[];
  if (candidates.length === 0) return [];

  const turnByAssistantId = new Map(
    loadMemoryEligibleChatTurnsWithMessageIdsCore(db, chatId).map((turn) => [
      turn.assistantMessageId,
      turn,
    ])
  );
  const cutoff = opts.beforeAssistantMessageId ?? null;
  const raw: RawEvent[] = [];
  for (const { id } of candidates) {
    if (cutoff != null && id >= cutoff) continue;
    const turn = turnByAssistantId.get(id);
    if (!turn) continue;
    const { change } = loadDeletedTurnRelationshipProvenanceCore(db, chatId, id, names);
    if (!change) continue;
    raw.push(
      ...eventsForTurn(change, {
        turn: turn.turnNumber,
        assistantMessageId: id,
        userMessageId: turn.userMessageId,
      })
    );
  }
  return annotateValidity(raw, loadChatRelationshipMetaCore(db, chatId, names));
}

type PromiseSourceRef = {
  turn: number;
  userMessageId: number | null;
  assistantMessageId: number;
};

type EndedPromise = {
  text: string;
  createdTurn: number | null;
  endedTurn: number;
  created: PromiseSourceRef | null;
  ended: PromiseSourceRef;
};

export type PromiseSourceKind = "created" | "released";

/** Verified-source lines for one end of a promise's life; empty when no canonical source supports it. */
export type PromiseEvidenceResolver = (
  ref: PromiseSourceRef,
  kind: PromiseSourceKind,
  promiseText: string
) => string[];

function sourceRef(event: RelationshipLedgerEvent): PromiseSourceRef {
  return {
    turn: event.turn,
    userMessageId: event.userMessageId,
    assistantMessageId: event.assistantMessageId,
  };
}

function endedPromises(events: readonly RelationshipLedgerEvent[]): EndedPromise[] {
  const byKey = new Map<string, RelationshipLedgerEvent[]>();
  for (const event of events) {
    if (event.category !== "promise") continue;
    byKey.set(event.key, [...(byKey.get(event.key) ?? []), event]);
  }
  const ended: EndedPromise[] = [];
  for (const [key, list] of byKey) {
    const last = list[list.length - 1]!;
    if (last.validity !== "ended") continue;
    const created = [...list].reverse().find((e) => e.change === "created");
    ended.push({
      text: key,
      createdTurn: created?.turn ?? null,
      endedTurn: last.turn,
      created: created ? sourceRef(created) : null,
      ended: sourceRef(last),
    });
  }
  return ended;
}

/**
 * Past promises that are no longer valid, only when the current user message
 * recalls them (shared token overlap, or a past-looking promise/cancel cue).
 * A bare 약속 is not enough — proposing a new one must not pull cancelled history.
 * Storage keeps every event; per-turn injection keeps at most two lines. Every ended
 * promise is scored before the cut, so an old one is not dropped for being old.
 */
export function selectPromiseHistoryForPrompt(
  events: readonly RelationshipLedgerEvent[],
  currentUserMessage: string,
  resolveEvidence?: PromiseEvidenceResolver
): string[] {
  const query = currentUserMessage.trim();
  if (!query) return [];
  const cue = PROMISE_RECALL_CUE.test(query);
  const scored = endedPromises(events)
    .map((entry) => ({ entry, score: scoreTextLexicalRelevance(entry.text, query) }))
    .filter(({ score }) => score > 0 || cue)
    .sort(
      (a, b) => b.score - a.score || b.entry.endedTurn - a.entry.endedTurn
    )
    .slice(0, PROMISE_HISTORY_MAX_LINES);
  return scored.map(({ entry }) => {
    const span =
      entry.createdTurn != null
        ? `제${entry.createdTurn}턴 약속 → 제${entry.endedTurn}턴 해제`
        : `제${entry.endedTurn}턴 해제`;
    const evidence = resolveEvidence
      ? [
          ...(entry.created ? resolveEvidence(entry.created, "created", entry.text) : []),
          ...resolveEvidence(entry.ended, "released", entry.text),
        ]
      : [];
    const base = `${entry.text} (${span})`;
    return evidence.length ? `${base} 근거 원문: ${evidence.join(" / ")}` : base;
  });
}

const SENTENCE_BREAK = /(?<=[.!?…。]["'”’]?)\s+/u;
const EDGE_QUOTE_MARKS = /^["'“”‘’\s]+|["'“”‘’\s]+$/gu;

const PROMISE_CLOSING_PREDICATE = /\s+(?:했다|했음|함|한다)[.!]?$/u;

function sourceSpanScore(
  span: string,
  promiseText: string,
  kind: PromiseSourceKind
): number {
  // The ledger's closing "했다" would otherwise match any narration ("스캔했다").
  return (
    scoreTextLexicalRelevance(span, promiseText.replace(PROMISE_CLOSING_PREDICATE, "")) +
    (kind === "released" && PROMISE_RELEASE_CUE.test(span) ? 1 : 0)
  );
}

/**
 * A verbatim span of one canonical message that bears on the promise. The user's
 * message is taken whole when it fits (a reason usually sits next to the cancel);
 * otherwise the best sentence is widened by neighbours that fit the cap. The
 * character's reply is never widened: its surrounding narration is not evidence.
 * Null when nothing in it relates.
 */
function pickPromiseSourceSpan(
  text: string,
  role: EpisodicEvidenceRole,
  promiseText: string,
  kind: PromiseSourceKind
): string | null {
  const cap = PROMISE_QUOTE_MAX_CHARS[role];
  if (sourceSpanScore(text, promiseText, kind) <= 0) return null;
  if (role === "user" && text.length <= cap) return text;
  const sentences = text.split(SENTENCE_BREAK);
  const scores = sentences.map((sentence) => sourceSpanScore(sentence, promiseText, kind));
  const best = scores.indexOf(Math.max(...scores));
  if (scores[best]! <= 0) return null;
  const joinable = (index: number): boolean =>
    role === "user" && sentences[index] !== undefined;
  let from = best;
  let to = best;
  let span = sentences[best]!;
  for (;;) {
    if (joinable(to + 1) && span.length + 1 + sentences[to + 1]!.length <= cap) {
      to += 1;
      span = `${span} ${sentences[to]}`;
    } else if (joinable(from - 1) && span.length + 1 + sentences[from - 1]!.length <= cap) {
      from -= 1;
      span = `${sentences[from]} ${span}`;
    } else break;
  }
  return span.slice(0, cap);
}

function verifiedPromiseQuote(
  sources: EpisodicEvidenceSources,
  role: EpisodicEvidenceRole,
  kind: PromiseSourceKind,
  promiseText: string
): string | null {
  const source = role === "user" ? sources.user : sources.assistant;
  if (!source) return null;
  const picked = pickPromiseSourceSpan(source.text, role, promiseText, kind);
  const quote = picked
    ? normalizeEvidenceSpan(sanitizeRecalledMemoryFactText(picked)).replace(EDGE_QUOTE_MARKS, "")
    : "";
  if ([...quote.replace(/\s+/gu, "")].length < EPISODIC_EVIDENCE_QUOTE_MIN_CHARS) return null;
  const decision = evaluateEpisodicFactEvidence(
    {
      category: "relationship",
      subject: "user",
      attribute: "promise",
      value: promiseText,
      importance: "normal",
      fact_text: promiseText,
      evidence_type: role === "user" ? "explicit_user_statement" : "explicit_character_claim",
      evidence: { source_role: role, source_quote: quote },
    },
    sources
  );
  return decision.accepted ? renderVerifiedEvidenceText(decision.evidence) : null;
}

/**
 * Reads the canonical source messages of a ledger event at prompt time, so a
 * deleted, regenerated or switched turn (no event) and an edited one (no quote
 * that still bears on the promise) can never resurface an old quote. The user's
 * own words come first; the character's reply is added only for a release, as
 * the attributed-claim source the episodic evidence gate already defines.
 */
export function createPromiseEvidenceResolver(
  db: Database.Database,
  chatId: number
): PromiseEvidenceResolver {
  return (ref, kind, promiseText) => {
    const sources = loadEpisodicEvidenceSources(db, chatId, {
      userMessageId: ref.userMessageId,
      assistantMessageId: ref.assistantMessageId,
    });
    const userQuote = verifiedPromiseQuote(sources, "user", kind, promiseText);
    const assistantQuote =
      userQuote == null || kind === "released"
        ? verifiedPromiseQuote(sources, "assistant", kind, promiseText)
        : null;
    return [userQuote, assistantQuote]
      .filter((line): line is string => line != null)
      .map((line) => `제${ref.turn}턴 ${line}`);
  };
}

export function loadPromiseHistoryForPromptCore(
  db: Database.Database,
  chatId: number,
  names: HonorificNames,
  currentUserMessage: string,
  opts: { beforeAssistantMessageId?: number | null } = {}
): string[] {
  return selectPromiseHistoryForPrompt(
    loadRelationshipLedgerEventsCore(db, chatId, names, opts),
    currentUserMessage,
    createPromiseEvidenceResolver(db, chatId)
  );
}
