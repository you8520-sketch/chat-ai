import { getDb } from "@/lib/db";
import type Database from "better-sqlite3";
import { BACKGROUND_OPENROUTER_MODEL, type Route } from "@/lib/ai";
import { type RelationshipMetaExtractResult } from "@/lib/ai";
import { buildPlatformAsyncTurnLedgerContext } from "@/lib/providerCostLedger";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import {
  EMPTY_MEMORY_META,
  mergeMemoryMeta,
  normalizeMemoryMeta,
  parseMemoryMeta,
  restrictRelationshipMetaDeltaToDurableAutoFacts,
  type HonorificNames,
  type MemoryMeta,
  type MemoryPromise,
  type RelationshipMetaCategory,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  getMemorySourceBoundary,
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";
import { setMemoryRelationshipTaskState } from "./memoryRelationshipTask";
import {
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  generationSequenceForVariant,
  normalizeMessageVariants,
  type RelationshipLedgerChange,
} from "@/lib/messageAlternates";
import { parsePossessionEntry, possessionCurrentHolder } from "@/lib/relationshipMetaItems";

export type { RelationshipMetaCategory };

export type RelationshipMetaApplyResult = {
  meta: MemoryMeta;
  accepted: boolean;
  rejectReason?: "stale_epoch_rejected" | "stale_generation_rejected";
};

export function loadChatRelationshipMetaCore(
  db: Database.Database,
  chatId: number,
  names?: HonorificNames
): MemoryMeta {
  const row = db
    .prepare("SELECT memory_meta FROM chats WHERE id=?")
    .get(chatId) as { memory_meta: string } | undefined;
  const meta = parseMemoryMeta(row?.memory_meta);
  return names ? normalizeMemoryMeta(meta, names) : meta;
}

export function loadChatRelationshipMeta(chatId: number, names?: HonorificNames): MemoryMeta {
  return loadChatRelationshipMetaCore(getDb(), chatId, names);
}

export function saveChatRelationshipMetaCore(
  db: Database.Database,
  chatId: number,
  meta: MemoryMeta
): void {
  db.prepare("UPDATE chats SET memory_meta=? WHERE id=?").run(JSON.stringify(meta), chatId);
}

export function saveChatRelationshipMeta(chatId: number, meta: MemoryMeta): void {
  saveChatRelationshipMetaCore(getDb(), chatId, meta);
}

function parseRelationshipMetaBeforeSnapshot(
  raw: string | null | undefined,
  names: HonorificNames
): MemoryMeta | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeMemoryMeta(parseMemoryMeta(raw), names);
  } catch {
    return null;
  }
}

export function loadRelationshipMetaBeforeSnapshotCore(
  db: Database.Database,
  assistantMessageId: number,
  names: HonorificNames
): MemoryMeta | null {
  const row = db
    .prepare("SELECT memory_relationship_before_json FROM messages WHERE id=? AND role='assistant'")
    .get(assistantMessageId) as { memory_relationship_before_json: string | null } | undefined;
  return parseRelationshipMetaBeforeSnapshot(row?.memory_relationship_before_json ?? null, names);
}

function parseLedgerPromise(value: unknown): MemoryPromise | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (value as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) return null;
  const deadline = (value as { deadline?: unknown }).deadline;
  return typeof deadline === "string" && deadline.trim()
    ? { text: text.trim(), deadline: deadline.trim() }
    : { text: text.trim() };
}

function parseRelationshipLedgerChange(value: unknown): RelationshipLedgerChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { promises?: unknown; items?: unknown };
  if (!Array.isArray(raw.promises) || !Array.isArray(raw.items)) return null;
  const promises: RelationshipLedgerChange["promises"] = [];
  for (const entry of raw.promises) {
    if (!entry || typeof entry !== "object") return null;
    const before = (entry as { before?: unknown }).before;
    const after = (entry as { after?: unknown }).after;
    const parsedBefore = before == null ? null : parseLedgerPromise(before);
    const parsedAfter = after == null ? null : parseLedgerPromise(after);
    if ((before != null && !parsedBefore) || (after != null && !parsedAfter)) return null;
    if (!parsedBefore && !parsedAfter) return null;
    promises.push({ before: parsedBefore, after: parsedAfter });
  }
  const items: RelationshipLedgerChange["items"] = [];
  for (const entry of raw.items) {
    if (!entry || typeof entry !== "object") return null;
    const before = (entry as { before?: unknown }).before;
    const after = (entry as { after?: unknown }).after;
    if (before != null && (typeof before !== "string" || !before.trim())) return null;
    if (after != null && (typeof after !== "string" || !after.trim())) return null;
    if (before == null && after == null) return null;
    items.push({ before: (before as string | null) ?? null, after: (after as string | null) ?? null });
  }
  return { promises, items };
}

function hasRelationshipLedgerChange(change: RelationshipLedgerChange): boolean {
  return change.promises.length > 0 || change.items.length > 0;
}

function samePromise(a: MemoryPromise | null, b: MemoryPromise | null): boolean {
  if (!a || !b) return a === b;
  return a.text === b.text && (a.deadline ?? null) === (b.deadline ?? null);
}

function possessionKey(line: string): string {
  return parsePossessionEntry(line)?.person ?? line;
}

/** key -> single line; a key with several lines is ambiguous and never reverted. */
function indexPossessionLines(items: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const line of items) {
    const key = possessionKey(line);
    index.set(key, [...(index.get(key) ?? []), line]);
  }
  return index;
}

function indexPromises(promises: MemoryPromise[]): Map<string, MemoryPromise[]> {
  const index = new Map<string, MemoryPromise[]>();
  for (const promise of promises) {
    index.set(promise.text, [...(index.get(promise.text) ?? []), promise]);
  }
  return index;
}

function singleState<T>(entries: T[] | undefined): T | null | "ambiguous" {
  if (!entries || entries.length === 0) return null;
  return entries.length === 1 ? entries[0]! : "ambiguous";
}

/** Net per-key transitions between the pre-turn and post-turn projections. */
function diffRelationshipLedger(before: MemoryMeta, after: MemoryMeta): RelationshipLedgerChange {
  const change: RelationshipLedgerChange = { promises: [], items: [] };

  const beforePromises = indexPromises(before.promises);
  const afterPromises = indexPromises(after.promises);
  for (const key of new Set([...beforePromises.keys(), ...afterPromises.keys()])) {
    const b = singleState(beforePromises.get(key));
    const a = singleState(afterPromises.get(key));
    if (b === "ambiguous" || a === "ambiguous") continue;
    if (!samePromise(b, a)) change.promises.push({ before: b, after: a });
  }

  const beforeItems = indexPossessionLines(before.items);
  const afterItems = indexPossessionLines(after.items);
  for (const key of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const b = singleState(beforeItems.get(key));
    const a = singleState(afterItems.get(key));
    if (b === "ambiguous" || a === "ambiguous") continue;
    if (b !== a) change.items.push({ before: b, after: a });
  }
  return change;
}

/** Receivers left on the deleted turn's after-lines, by item name. */
function itemReceiversFromChange(
  change: RelationshipLedgerChange
): Map<string, Set<string>> {
  const receivers = new Map<string, Set<string>>();
  for (const entry of change.items) {
    if (!entry.after) continue;
    const parsed = parsePossessionEntry(entry.after);
    if (!parsed) continue;
    const holder = possessionCurrentHolder(parsed.person);
    for (const item of parsed.items) {
      const name = item.trim();
      receivers.set(name, new Set([...(receivers.get(name) ?? []), holder]));
    }
  }
  return receivers;
}

/**
 * item name -> persons who later received it by an explicit From→To line
 * whose sender was a receiver of the deleted turn. A plain same-name line
 * is a different object and does not block restore.
 */
function possessionHoldersOutside(
  items: string[],
  excludedLines: Set<string>,
  receiversByItem: Map<string, Set<string>>
): Map<string, Set<string>> {
  const holders = new Map<string, Set<string>>();
  for (const line of items) {
    if (excludedLines.has(line)) continue;
    const parsed = parsePossessionEntry(line);
    if (!parsed?.person.includes("→")) continue;
    const fromPerson = parsed.person.split("→")[0]?.trim();
    const toPerson = possessionCurrentHolder(parsed.person);
    if (!fromPerson || !toPerson) continue;
    for (const item of parsed.items) {
      const name = item.trim();
      if (!receiversByItem.get(name)?.has(fromPerson)) continue;
      holders.set(name, new Set([...(holders.get(name) ?? []), toPerson]));
    }
  }
  return holders;
}

/**
 * Restore the previous line except for items a later explicit handoff moved on.
 * Another person's same-named object is not that proof.
 */
function restorablePossessionLine(
  before: string,
  laterHolders: Map<string, Set<string>>
): string | null {
  const parsed = parsePossessionEntry(before);
  if (!parsed || parsed.person.includes("→")) return before;
  const remaining = parsed.items.filter((item) => {
    const holders = laterHolders.get(item.trim());
    return !holders || [...holders].every((holder) => holder === parsed.person);
  });
  if (remaining.length === 0) return null;
  if (remaining.length === parsed.items.length) return before;
  return `${parsed.person}: ${remaining.join(", ")}`;
}

/**
 * Three-way revert of one turn's net change onto the current ledger.
 * An entry is reverted only while the current ledger still holds exactly the
 * state this turn left (`current == after`). Anything a later writer touched
 * (edit, cancel, re-add with other values, unrelated keys) is left alone.
 */
function revertRelationshipLedgerChange(
  current: MemoryMeta,
  change: RelationshipLedgerChange
): MemoryMeta {
  let promises = current.promises;
  const promiseIndex = indexPromises(current.promises);
  for (const entry of change.promises) {
    const key = (entry.before ?? entry.after)!.text;
    const state = singleState(promiseIndex.get(key));
    if (state === "ambiguous" || !samePromise(state, entry.after)) continue;
    if (state && entry.before) {
      promises = promises.map((p) => (p === state ? entry.before! : p));
    } else if (state) {
      promises = promises.filter((p) => p !== state);
    } else if (entry.before) {
      promises = [...promises, entry.before];
    }
  }

  let items = current.items;
  const itemIndex = indexPossessionLines(current.items);
  const stateFor = (entry: RelationshipLedgerChange["items"][number]) =>
    singleState(itemIndex.get(possessionKey((entry.before ?? entry.after)!)));
  // Lines this revert drops or replaces do not count as a later owner.
  const revertedLines = new Set<string>();
  for (const entry of change.items) {
    const state = stateFor(entry);
    if (state && state !== "ambiguous" && state === entry.after) revertedLines.add(state);
  }
  const laterHolders = possessionHoldersOutside(
    current.items,
    revertedLines,
    itemReceiversFromChange(change)
  );
  for (const entry of change.items) {
    const state = stateFor(entry);
    if (state === "ambiguous" || state !== entry.after) continue;
    const restored = entry.before
      ? restorablePossessionLine(entry.before, laterHolders)
      : null;
    if (state && restored) {
      items = items.map((line) => (line === state ? restored : line));
    } else if (state) {
      items = items.filter((line) => line !== state);
    } else if (restored) {
      items = [...items, restored];
    }
  }

  return { ...current, promises, items };
}

export function loadDeletedTurnRelationshipProvenanceCore(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number,
  names: HonorificNames
): { change: RelationshipLedgerChange | null; after: MemoryMeta | null } {
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant
       FROM messages
       WHERE id=? AND chat_id=? AND role='assistant'`
    )
    .get(assistantMessageId, chatId) as
    | {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    | undefined;
  if (!row) return { change: null, after: null };
  const { variants, activeVariant } = normalizeMessageVariants(row);
  const active = variants[activeVariant];
  const afterParsed = parseRelationshipMetaObjectSnapshot(active?.relationshipMetaAfter);
  return {
    change: parseRelationshipLedgerChange(active?.relationshipMetaChange),
    after: afterParsed ? normalizeMemoryMeta(afterParsed, names) : null,
  };
}

function persistRelationshipMetaBeforeSnapshotCore(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number,
  meta: MemoryMeta
): void {
  db.prepare(
    `UPDATE messages
     SET memory_relationship_before_json=?
     WHERE id=? AND chat_id=? AND role='assistant'
       AND memory_relationship_before_json IS NULL`
  ).run(JSON.stringify(meta), assistantMessageId, chatId);
}


function parseRelationshipMetaObjectSnapshot(value: unknown): MemoryMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return parseMemoryMeta(JSON.stringify(value));
  } catch {
    return null;
  }
}

function persistRelationshipMetaAfterSnapshotForGenerationCore(
  db: Database.Database,
  opts: {
    chatId: number;
    assistantMessageId: number;
    generationScope: AssistantGenerationScope;
    meta: MemoryMeta;
    /** Undefined leaves any stored change untouched. Null or empty clears it. */
    change?: RelationshipLedgerChange | null;
  }
): void {
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant
       FROM messages WHERE id=? AND chat_id=? AND role='assistant'`
    )
    .get(opts.assistantMessageId, opts.chatId) as
    | {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    | undefined;
  if (!row) return;

  const { variants, activeVariant } = normalizeMessageVariants(row);
  const active = variants[activeVariant];
  if (!active) return;
  if (
    generationSequenceForVariant(active, activeVariant) !==
    opts.generationScope.generationSequence
  ) {
    return;
  }
  const expectedRequestId = opts.generationScope.generationRequestId?.trim() || null;
  const activeRequestId = active.requestId?.trim() || null;
  if (expectedRequestId && activeRequestId && expectedRequestId !== activeRequestId) {
    return;
  }

  const nextVariant = {
    ...active,
    relationshipMetaAfter: opts.meta,
  };
  if (opts.change !== undefined) {
    if (opts.change && hasRelationshipLedgerChange(opts.change)) {
      nextVariant.relationshipMetaChange = opts.change;
    } else {
      delete nextVariant.relationshipMetaChange;
    }
  }
  variants[activeVariant] = nextVariant;
  db.prepare(
    "UPDATE messages SET alternates=? WHERE id=? AND chat_id=? AND role='assistant'"
  ).run(JSON.stringify(variants), opts.assistantMessageId, opts.chatId);
}

export type RelationshipVariantReprojectionResult =
  | "applied"
  | "already_selected"
  | "external_drift_preserved"
  | "missing_provenance";

export function reprojectRelationshipMetaForVariantSwitchCore(
  db: Database.Database,
  opts: {
    chatId: number;
    activeRelationshipMetaAfter?: MemoryMeta | null;
    selectedRelationshipMetaAfter?: MemoryMeta | null;
  }
): RelationshipVariantReprojectionResult {
  const active = parseRelationshipMetaObjectSnapshot(
    opts.activeRelationshipMetaAfter
  );
  const selected = parseRelationshipMetaObjectSnapshot(
    opts.selectedRelationshipMetaAfter
  );
  if (!active || !selected) return "missing_provenance";

  const current = loadChatRelationshipMetaCore(db, opts.chatId);
  const currentJson = JSON.stringify(current);
  const activeJson = JSON.stringify(active);
  if (currentJson !== activeJson) {
    return "external_drift_preserved";
  }

  const selectedJson = JSON.stringify(selected);
  if (currentJson === selectedJson) return "already_selected";
  saveChatRelationshipMetaCore(db, opts.chatId, selected);
  return "applied";
}

export function removeRelationshipMetaItem(
  meta: MemoryMeta,
  category: RelationshipMetaCategory,
  text: string
): MemoryMeta {
  const needle = text.trim();
  if (!needle) return meta;
  if (category === "promises") {
    return {
      ...meta,
      promises: meta.promises.filter((p) => p.text !== needle),
    };
  }
  return {
    ...meta,
    [category]: meta[category].filter((item) => item !== needle),
  };
}

export function clearChatRelationshipMeta(chatId: number): void {
  saveChatRelationshipMeta(chatId, { ...EMPTY_MEMORY_META });
}

/**
 * Roll back the relationship-meta changes of a deleted turn.
 *
 * Provenance order:
 * 1. `memory_relationship_before_json`, restored whole only while the current
 *    ledger still equals that turn's after snapshot (no later writer). A later
 *    edit is drift, same as variant switch `external_drift_preserved`.
 * 2. Otherwise the turn's own net change (stored `relationshipMetaChange`, or
 *    before vs after when both snapshots exist) is reverted per entry, and only
 *    where the current entry still equals what the turn left. Adds, cancels and
 *    transfers are all inverted; entries a later writer touched stay as they are.
 *    A surviving turn's `relationshipMetaAfter` is never used as a restore source.
 * 3. Conservative substring fallback. Paraphrased leftovers that match neither
 *    surviving nor deleted RAW stay put — unknown old rows are not guessed away.
 */
export function rollbackRelationshipMetaForDeletedTurnCore(
  db: Database.Database,
  opts: {
    chatId: number;
    names: HonorificNames;
    deletedUserText: string;
    deletedAssistantText: string;
    relationshipMetaBeforeJson?: string | null;
    relationshipMetaChange?: RelationshipLedgerChange | null;
    relationshipMetaAfter?: MemoryMeta | null;
  }
): MemoryMeta {
  const before = parseRelationshipMetaBeforeSnapshot(
    opts.relationshipMetaBeforeJson,
    opts.names
  );
  const after = opts.relationshipMetaAfter
    ? normalizeMemoryMeta(opts.relationshipMetaAfter, opts.names)
    : null;
  if (before) {
    const current = loadChatRelationshipMetaCore(db, opts.chatId, opts.names);
    if (!after || JSON.stringify(current) === JSON.stringify(after)) {
      saveChatRelationshipMetaCore(db, opts.chatId, before);
      return before;
    }
  }

  const change =
    parseRelationshipLedgerChange(opts.relationshipMetaChange) ??
    (before && after ? diffRelationshipLedger(before, after) : null);
  if (change) {
    const meta = loadChatRelationshipMetaCore(db, opts.chatId, opts.names);
    const next = revertRelationshipLedgerChange(meta, change);
    if (JSON.stringify(next) !== JSON.stringify(meta)) {
      saveChatRelationshipMetaCore(db, opts.chatId, next);
    }
    return next;
  }

  const rows = db
    .prepare(
      "SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(opts.chatId) as { role: string; content: string }[];
  const survivingText = rows.map((r) => r.content).join("\n");

  const deletedText = `${opts.deletedUserText}\n${opts.deletedAssistantText}`;
  const meta = loadChatRelationshipMetaCore(db, opts.chatId, opts.names);

  const filterOut = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    // Keep if still present in surviving messages.
    if (survivingText.includes(t)) return true;
    // Remove only if it was present in the deleted turn.
    return !deletedText.includes(t);
  };

  const next: MemoryMeta = {
    honorifics: meta.honorifics.filter(filterOut),
    items: meta.items.filter(filterOut),
    thoughts: meta.thoughts.filter(filterOut),
    promises: meta.promises.filter((p) => filterOut(p.text)),
    currentLocation: meta.currentLocation,
  };

  saveChatRelationshipMetaCore(db, opts.chatId, next);
  return next;
}

/**
 * Material user-message edit. Reuses the delete-turn substring rule for
 * promises, items, and honorifics only. Does not re-normalize the projection:
 * that path clears thoughts, and a user edit must not drop unrelated durable state.
 */
export function reconcileRelationshipMetaAfterUserSourceEditCore(
  db: Database.Database,
  opts: {
    chatId: number;
    previousUserText: string;
  }
): MemoryMeta {
  const rows = db
    .prepare("SELECT content FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(opts.chatId) as { content: string }[];
  const survivingText = rows.map((row) => row.content).join("\n");
  const replacedText = opts.previousUserText;
  const keep = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (survivingText.includes(trimmed)) return true;
    return !replacedText.includes(trimmed);
  };

  const meta = loadChatRelationshipMetaCore(db, opts.chatId);
  const next: MemoryMeta = {
    ...meta,
    honorifics: meta.honorifics.filter(keep),
    items: meta.items.filter(keep),
    promises: meta.promises.filter((promise) => keep(promise.text)),
  };
  if (JSON.stringify(next) !== JSON.stringify(meta)) {
    saveChatRelationshipMetaCore(db, opts.chatId, next);
  }
  return next;
}

export function rollbackRelationshipMetaForDeletedTurn(opts: {
  chatId: number;
  names: HonorificNames;
  deletedUserText: string;
  deletedAssistantText: string;
  relationshipMetaBeforeJson?: string | null;
  relationshipMetaChange?: RelationshipLedgerChange | null;
  relationshipMetaAfter?: MemoryMeta | null;
}): MemoryMeta {
  return rollbackRelationshipMetaForDeletedTurnCore(getDb(), opts);
}

function hasRelationshipDelta(delta: RelationshipMetaDelta): boolean {
  return (
    (delta.items?.length ?? 0) > 0 ||
    (delta.itemsRemove?.length ?? 0) > 0 ||
    (delta.promisesAdd?.length ?? 0) > 0 ||
    (delta.promisesRemove?.length ?? 0) > 0
  );
}

export function applyRelationshipDeltaToChat(opts: {
  chatId: number;
  names: HonorificNames;
  delta: RelationshipMetaDelta;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testThrowOnSave?: boolean;
}): RelationshipMetaApplyResult {
  const db = getDb();
  const snapshot = opts.boundarySnapshot ?? getMemorySourceBoundary(opts.chatId);
  return db.transaction((): RelationshipMetaApplyResult => {
    if (opts.generationScope && !isCurrentAssistantGeneration(opts.generationScope, db)) {
      console.info("STALE_GENERATION_RESULT_REJECTED", {
        family: "memory_relationship",
        messageId: opts.generationScope.assistantMessageId,
        generationSequence: opts.generationScope.generationSequence,
        phase: "projection_write",
      });
      return {
        meta: loadChatRelationshipMeta(opts.chatId, opts.names),
        accepted: false,
        rejectReason: "stale_generation_rejected",
      };
    }

    if (
      !isMemoryWriteGuardCurrentCore(db, {
        chatId: opts.chatId,
        snapshot,
        sourceUserMessageIds: [opts.sourceUserMessageId],
      })
    ) {
      console.info("MEMORY_STALE_EPOCH_REJECTED", {
        chat_id: opts.chatId,
        epoch: snapshot.epoch,
        source_message_id: opts.sourceUserMessageId ?? null,
      });
      return {
        meta: loadChatRelationshipMeta(opts.chatId, opts.names),
        accepted: false,
        rejectReason: "stale_epoch_rejected",
      };
    }

    // Merge the delta into the projection as it exists at commit time. Never
    // overwrite a reset with a stale pre-extraction JSON snapshot.
    const prev = loadChatRelationshipMetaCore(db, opts.chatId);
    const prevNormalized = normalizeMemoryMeta(prev, opts.names);
    const durableDelta = restrictRelationshipMetaDeltaToDurableAutoFacts(opts.delta);
    if (!hasRelationshipDelta(durableDelta)) {
      if (JSON.stringify(prev) !== JSON.stringify(prevNormalized)) {
        if (opts.__testThrowOnSave) {
          throw new Error("relationship meta save failed (test)");
        }
        saveChatRelationshipMetaCore(db, opts.chatId, prevNormalized);
      }
      if (opts.assistantMessageId != null && opts.generationScope) {
        persistRelationshipMetaAfterSnapshotForGenerationCore(db, {
          chatId: opts.chatId,
          assistantMessageId: opts.assistantMessageId,
          generationScope: opts.generationScope,
          meta: prevNormalized,
        });
      }
      return { meta: prevNormalized, accepted: true };
    }

    const assistantMessageId =
      opts.assistantMessageId ?? opts.generationScope?.assistantMessageId;
    if (assistantMessageId != null) {
      persistRelationshipMetaBeforeSnapshotCore(
        db,
        opts.chatId,
        assistantMessageId,
        prevNormalized
      );
    }

    const merged = mergeMemoryMeta(prevNormalized, durableDelta, opts.names);
    if (opts.__testThrowOnSave) {
      throw new Error("relationship meta save failed (test)");
    }
    saveChatRelationshipMetaCore(db, opts.chatId, merged);
    if (assistantMessageId != null && opts.generationScope) {
      const baseline =
        loadRelationshipMetaBeforeSnapshotCore(db, assistantMessageId, opts.names) ??
        prevNormalized;
      persistRelationshipMetaAfterSnapshotForGenerationCore(db, {
        chatId: opts.chatId,
        assistantMessageId,
        generationScope: opts.generationScope,
        meta: merged,
        change: diffRelationshipLedger(baseline, normalizeMemoryMeta(merged, opts.names)),
      });
    }
    return { meta: merged, accepted: true };
  }).immediate();
}

type ProviderBackedMergeOpts = {
  chatId: number;
  names: HonorificNames;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
};

function recordProviderBackedTaskTerminalState(
  assistantMessageId: number | undefined,
  outcome: "parse_failed" | "commit_accepted" | "stale_epoch_rejected" | "commit_failed",
  generationScope?: Pick<AssistantGenerationScope, "generationSequence" | "generationRequestId">
): void {
  if (!assistantMessageId) return;
  switch (outcome) {
    case "parse_failed":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "parse_failed", undefined, generationScope);
      break;
    case "commit_accepted":
      setMemoryRelationshipTaskState(assistantMessageId, "succeeded", undefined, undefined, generationScope);
      break;
    case "stale_epoch_rejected":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "stale_epoch_rejected", undefined, generationScope);
      break;
    case "commit_failed":
      setMemoryRelationshipTaskState(assistantMessageId, "failed", "commit_failed", undefined, generationScope);
      break;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

async function runProviderBackedRelationshipMerge(
  opts: ProviderBackedMergeOpts & {
    extract: () => Promise<RelationshipMetaExtractResult>;
  }
): Promise<MemoryMeta> {
  const prev = loadChatRelationshipMeta(opts.chatId);
  const prevNormalized = normalizeMemoryMeta(prev, opts.names);
  const generationScope = opts.generationScope;

  if (opts.assistantMessageId && generationScope) {
    setMemoryRelationshipTaskState(
      opts.assistantMessageId,
      "pending",
      undefined,
      undefined,
      generationScope
    );
  }

  let extractResult: RelationshipMetaExtractResult;
  try {
    extractResult = await opts.extract();
  } catch (e) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_failed",
      generationScope
    );
    console.warn("[memory] relationship provider extract failed:", (e as Error).message);
    return prevNormalized;
  }

  if (!extractResult.parseOk) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "parse_failed",
      generationScope
    );
    return prevNormalized;
  }

  try {
    const applied = applyRelationshipDeltaToChat({
      chatId: opts.chatId,
      names: opts.names,
      delta: extractResult.delta,
      sourceUserMessageId: opts.sourceUserMessageId,
      boundarySnapshot: opts.boundarySnapshot,
      assistantMessageId: opts.assistantMessageId,
      generationScope: generationScope ?? undefined,
      __testThrowOnSave: opts.__testThrowOnSave,
    });
    if (!applied.accepted) {
      if (applied.rejectReason === "stale_generation_rejected") {
        return applied.meta;
      }
      recordProviderBackedTaskTerminalState(
        opts.assistantMessageId,
        "stale_epoch_rejected",
        generationScope
      );
      return applied.meta;
    }
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_accepted",
      generationScope
    );
    return applied.meta;
  } catch (e) {
    recordProviderBackedTaskTerminalState(
      opts.assistantMessageId,
      "commit_failed",
      generationScope
    );
    console.warn("[memory] relationship meta commit failed:", (e as Error).message);
    return prevNormalized;
  }
}

/**
 * Canonical post-turn relationship inference entry for a generation which has
 * not attempted the shared owner yet (for example status-OFF relationship-only).
 * Section/transport failure after an attempt never reaches this function.
 */
async function extractRelationshipDeltaViaSharedOwner(opts: {
  charName: string;
  userName: string;
  userMessage: string;
  assistantMessage: string;
  previousAssistantMessage?: string | null;
  activePromises: readonly string[];
  primaryModelId?: string;
  ledgerOpts?: {
    chatId: number;
    assistantMessageId: number;
    generationSequence: number;
    generationRequestId?: string | null;
    jobAttemptOrdinal?: number;
  };
}): Promise<RelationshipMetaExtractResult> {
  const ledgerContext = opts.ledgerOpts
    ? buildPlatformAsyncTurnLedgerContext({
        chatId: opts.ledgerOpts.chatId,
        assistantMessageId: opts.ledgerOpts.assistantMessageId,
        generationSequence: opts.ledgerOpts.generationSequence,
        generationRequestId: opts.ledgerOpts.generationRequestId ?? null,
        family: "memory_relationship",
        jobAttemptOrdinal: opts.ledgerOpts.jobAttemptOrdinal ?? 1,
        requestKind: POST_TURN_SHARED_INITIAL_REQUEST_KIND,
      })
    : undefined;
  const run = await runPostTurnRelationshipOnlyInitial(
    {
      charName: opts.charName,
      personaName: opts.userName,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantMessage,
      primaryModelId: opts.primaryModelId ?? BACKGROUND_OPENROUTER_MODEL,
      previousAssistantMessage: opts.previousAssistantMessage ?? null,
      activePromises: opts.activePromises,
    },
    undefined,
    ledgerContext
  );
  const section = run.parsed?.relationship;
  if (!run.transportOk || !section || !section.valid) {
    // Missing/malformed section (or transport failure) is a section failure,
    // never a silent empty-delta success.
    return { delta: {}, parseOk: false };
  }
  return { delta: section.delta, parseOk: true };
}

/** 턴 종료 후 호칭·물건·속마음·약속 추출 → chats.memory_meta 병합 */
export async function mergeRelationshipMetaFromTurn(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  assistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** DeepSeek/Qwen — 메인 모델 JSON tail 파싱 성공 시 Flash 생략 */
  mainModelTailParsed?: boolean;
  mainModelDelta?: RelationshipMetaDelta | null;
  /** Shared post-turn Luna call already carried the durable relationship delta. */
  sharedInitialAttempted?: boolean;
  sharedInitialParsed?: boolean;
  sharedInitialDelta?: RelationshipMetaDelta | null;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;

  if (opts.mainModelTailParsed === true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "main_model_tail_satisfied",
        undefined,
        opts.generationScope
      );
    }
    try {
      const applied = applyRelationshipDeltaToChat({
        chatId: opts.chatId,
        names,
        delta: opts.mainModelDelta ?? {},
        sourceUserMessageId: opts.sourceUserMessageId,
        boundarySnapshot: opts.boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
        generationScope: opts.generationScope,
        __testThrowOnSave: opts.__testThrowOnSave,
      });
      return applied.meta;
    } catch (e) {
      console.warn("[memory] relationship main-tail commit failed:", (e as Error).message);
      return loadChatRelationshipMeta(opts.chatId, opts.names);
    }
  }

  const prevNormalized = normalizeMemoryMeta(loadChatRelationshipMeta(opts.chatId), names);

  // An attempted shared request spends the generation's physical-call budget.
  // Invalid/missing relationship output is a terminal no-retry failure and must
  // preserve the previous durable projection rather than fan out to a provider.
  if (opts.sharedInitialAttempted === true && opts.sharedInitialParsed !== true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "shared_section_invalid_no_retry",
        undefined,
        opts.generationScope
      );
    }
    return prevNormalized;
  }

  // Shared post-turn Luna call already produced the durable relationship delta:
  // consume it WITHOUT any independent provider invocation (one physical owner).
  if (opts.sharedInitialParsed === true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "shared_initial_satisfied",
        undefined,
        opts.generationScope
      );
    }
    try {
      const applied = applyRelationshipDeltaToChat({
        chatId: opts.chatId,
        names,
        delta: opts.sharedInitialDelta ?? {},
        sourceUserMessageId: opts.sourceUserMessageId,
        boundarySnapshot: opts.boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
        generationScope: opts.generationScope,
        __testThrowOnSave: opts.__testThrowOnSave,
      });
      return applied.meta;
    } catch (e) {
      console.warn("[memory] relationship shared-initial commit failed:", (e as Error).message);
      return loadChatRelationshipMeta(opts.chatId, opts.names);
    }
  }

  return runProviderBackedRelationshipMerge({
    chatId: opts.chatId,
    names: opts.names,
    sourceUserMessageId: opts.sourceUserMessageId,
    boundarySnapshot: opts.boundarySnapshot,
    assistantMessageId: opts.assistantMessageId,
    generationScope: opts.generationScope,
    __testExtract: opts.__testExtract,
    __testThrowOnSave: opts.__testThrowOnSave,
    extract: () =>
      opts.__testExtract
        ? opts.__testExtract()
        : extractRelationshipDeltaViaSharedOwner({
            charName: names.charName,
            userName: names.userName,
            userMessage: opts.userMessage,
            assistantMessage: opts.assistantMessage,
            activePromises: prevNormalized.promises.map((p) => p.text),
            ledgerOpts:
              opts.assistantMessageId && opts.generationScope
                ? {
                    chatId: opts.chatId,
                    assistantMessageId: opts.assistantMessageId,
                    generationSequence: opts.generationScope.generationSequence,
                    generationRequestId: opts.generationScope.generationRequestId,
                  }
                : undefined,
          }),
  });
}

/** 재생성 — 거부본 대비 소지품·속마음 제거 후 새 정본 반영 */
export async function mergeRelationshipMetaAfterRegenerate(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  newAssistantMessage: string;
  previousAssistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  sourceUserMessageId?: number | null;
  boundarySnapshot?: MemorySourceBoundary;
  assistantMessageId?: number;
  generationScope?: AssistantGenerationScope;
  /** Shared post-turn Luna call (with regen context) already produced the delta. */
  sharedInitialAttempted?: boolean;
  sharedInitialParsed?: boolean;
  sharedInitialDelta?: RelationshipMetaDelta | null;
  __testExtract?: () => Promise<RelationshipMetaExtractResult>;
  __testThrowOnSave?: boolean;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;

  if (opts.sharedInitialAttempted === true && opts.sharedInitialParsed !== true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "shared_section_invalid_no_retry",
        undefined,
        opts.generationScope
      );
    }
    return loadChatRelationshipMeta(opts.chatId, names);
  }

  // Regen shares the SAME physical inference: consume the shared delta (which
  // compared the rejected draft and new canonical reply) without a second call.
  if (opts.sharedInitialParsed === true) {
    if (opts.assistantMessageId) {
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "shared_initial_satisfied",
        undefined,
        opts.generationScope
      );
    }
    try {
      const applied = applyRelationshipDeltaToChat({
        chatId: opts.chatId,
        names,
        delta: opts.sharedInitialDelta ?? {},
        sourceUserMessageId: opts.sourceUserMessageId,
        boundarySnapshot: opts.boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
        generationScope: opts.generationScope,
        __testThrowOnSave: opts.__testThrowOnSave,
      });
      return applied.meta;
    } catch (e) {
      console.warn("[memory] relationship regen shared-initial commit failed:", (e as Error).message);
      return loadChatRelationshipMeta(opts.chatId, opts.names);
    }
  }

  return runProviderBackedRelationshipMerge({
    chatId: opts.chatId,
    names: opts.names,
    sourceUserMessageId: opts.sourceUserMessageId,
    boundarySnapshot: opts.boundarySnapshot,
    assistantMessageId: opts.assistantMessageId,
    generationScope: opts.generationScope,
    __testExtract: opts.__testExtract,
    __testThrowOnSave: opts.__testThrowOnSave,
    extract: () =>
      opts.__testExtract
        ? opts.__testExtract()
        : extractRelationshipDeltaViaSharedOwner({
            charName: names.charName,
            userName: names.userName,
            userMessage: opts.userMessage,
            assistantMessage: opts.newAssistantMessage,
            previousAssistantMessage: opts.previousAssistantMessage,
            activePromises: loadChatRelationshipMeta(opts.chatId, names).promises.map(
              (p) => p.text
            ),
            ledgerOpts:
              opts.assistantMessageId && opts.generationScope
                ? {
                    chatId: opts.chatId,
                    assistantMessageId: opts.assistantMessageId,
                    generationSequence: opts.generationScope.generationSequence,
                    generationRequestId: opts.generationScope.generationRequestId,
                  }
                : undefined,
          }),
  });
}
