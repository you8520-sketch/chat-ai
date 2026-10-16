import type Database from "better-sqlite3";
import {
  formatPromiseLabel,
  type HonorificNames,
  type MemoryMeta,
  type MemoryPromise,
} from "@/lib/chatMemory";
import { scoreTextLexicalRelevance } from "@/lib/episodicMemoryFacts";
import { parsePossessionEntry } from "@/lib/relationshipMetaItems";
import {
  loadChatRelationshipMetaCore,
  loadDeletedTurnRelationshipProvenanceCore,
} from "./memory-relationship-meta";
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

const PROMISE_RECALL_CUE = /약속|기로\s*(?:했|한|하자)|취소|파기|없던|지키|지켜|어기|어겼/u;
const PROMISE_HISTORY_MAX_LINES = 2;
const PROMISE_HISTORY_MAX_CANDIDATES = 40;

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

type EndedPromise = {
  text: string;
  createdTurn: number | null;
  endedTurn: number;
};

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
    });
  }
  return ended.sort((a, b) => b.endedTurn - a.endedTurn).slice(0, PROMISE_HISTORY_MAX_CANDIDATES);
}

/**
 * Past promises that are no longer valid, only when the current user message
 * recalls them (shared token overlap, or an explicit promise/cancel cue).
 * Storage keeps every event; per-turn injection keeps at most two lines.
 */
export function selectPromiseHistoryForPrompt(
  events: readonly RelationshipLedgerEvent[],
  currentUserMessage: string
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
    return `${entry.text} (${span})`;
  });
}
