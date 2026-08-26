import type Database from "better-sqlite3";

import { EMPTY_MEMORY_META, parseMemoryMeta, type MemoryMeta } from "@/lib/chatMemory";
import { getDb } from "@/lib/db";
import { buildNumericIdempotencyKey } from "@/lib/rpNumericState/persistence";
import type { NumericStateSourceKind } from "@/lib/rpNumericState/types";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  forkSummarizedTurnCount,
  FORK_MEMORY_TURN_INTERVAL,
} from "./memory-fork-turn-count";
import { resolveLorebookFromRecords } from "./memory-lorebook-resolve";
import {
  encodeScopePayload,
  parseScopePayload,
  type BranchControlMutation,
  type ScopePayloadV1,
} from "./memory-summary-scope";
import type { MemoryTier } from "./memory-types";

export { countCompletedTurnsUpToMessageId, forkSummarizedTurnCount, FORK_MEMORY_TURN_INTERVAL } from "./memory-fork-turn-count";
export { countMemoryEligibleCompletedTurnsUpToMessageId } from "./memory-fork-turn-count";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return row?.ok === 1;
}

function remapOptionalId(
  messageIdMap: ReadonlyMap<number, number>,
  id: number | null | undefined
): number | null {
  if (id == null || !Number.isFinite(id) || id <= 0) return null;
  return messageIdMap.get(id) ?? null;
}

function parentIdAfterFork(
  id: number | null | undefined,
  forkMessageId: number
): boolean {
  return id != null && Number.isFinite(id) && id > forkMessageId;
}

function asNumericSourceKind(raw: string): NumericStateSourceKind {
  switch (raw) {
    case "definition_initial":
    case "legacy_bootstrap":
    case "extractor":
    case "manual_override":
    case "variant_switch":
      return raw;
    default:
      return "extractor";
  }
}

function transcriptContains(transcript: string, text: string): boolean {
  const needle = text.trim();
  return needle.length > 0 && transcript.includes(needle);
}

/**
 * Parent relationship ledger is a live projection (turn 400 state).
 * Keep only entries that still appear in the copied (pre-fork) transcript so
 * later-turn items/promises cannot leak into the child room.
 */
export function snapshotForkRelationshipMeta(opts: {
  parentMemoryMeta: string | null | undefined;
  copiedContents: readonly string[];
}): string {
  const meta = parseMemoryMeta(opts.parentMemoryMeta);
  const transcript = opts.copiedContents.join("\n");
  const next: MemoryMeta = {
    honorifics: meta.honorifics.filter((entry) => transcriptContains(transcript, entry)),
    items: meta.items.filter((entry) => transcriptContains(transcript, entry)),
    thoughts: [],
    promises: meta.promises.filter((entry) => transcriptContains(transcript, entry.text)),
    currentLocation: undefined,
  };
  if (
    next.honorifics.length === 0 &&
    next.items.length === 0 &&
    next.promises.length === 0
  ) {
    return JSON.stringify({ ...EMPTY_MEMORY_META });
  }
  return JSON.stringify(next);
}

export function isForkMutationAfterBoundary(
  mutation: BranchControlMutation,
  forkMessageId: number,
  forkTurnCount: number
): boolean {
  const sourceUserMessageId = mutation.sourceUserMessageId;
  if (sourceUserMessageId != null && sourceUserMessageId > 0) {
    return sourceUserMessageId > forkMessageId;
  }
  const sourceTurn = mutation.sourceTurn;
  if (sourceTurn != null && sourceTurn > 0) {
    return sourceTurn > forkTurnCount;
  }
  const sourceBatchStart = mutation.sourceBatchStart;
  if (sourceBatchStart != null && sourceBatchStart > 0) {
    return sourceBatchStart + FORK_MEMORY_TURN_INTERVAL - 1 > forkTurnCount;
  }
  return false;
}

function rewindScopePayloadToFork(opts: {
  summaryKind: string;
  summary: string;
  scopePayload: string | null;
  branchId: string | null;
  branchStatus: string | null;
  promotedBy: string | null;
  promotedAt: string | null;
  inactive: number;
  forkMessageId: number;
  forkTurnCount: number;
  messageIdMap: ReadonlyMap<number, number>;
}): {
  summaryKind: string;
  summary: string;
  scopePayload: string | null;
  branchId: string | null;
  branchStatus: string | null;
  promotedBy: string | null;
  promotedAt: string | null;
  inactive: number;
} {
  const parsed = parseScopePayload(opts.scopePayload);
  if (!parsed) {
    return {
      summaryKind: opts.summaryKind,
      summary: opts.summary,
      scopePayload: opts.scopePayload,
      branchId: opts.branchId,
      branchStatus: opts.branchStatus,
      promotedBy: opts.promotedBy,
      promotedAt: opts.promotedAt,
      inactive: opts.inactive,
    };
  }

  const mutations = [...(parsed.branchControlMutations ?? [])];
  let summaryKind = opts.summaryKind;
  let summary = opts.summary;
  let scopes = { ...parsed.scopes };
  let branchId = opts.branchId ?? parsed.branchId ?? null;
  let branchStatus = opts.branchStatus ?? parsed.branchStatus ?? null;
  let promotedBy = opts.promotedBy ?? parsed.promotedBy ?? null;
  let promotedAt = opts.promotedAt ?? parsed.promotedAt ?? null;
  let inactive = opts.inactive;

  while (mutations.length > 0) {
    const top = mutations[mutations.length - 1]!;
    if (!isForkMutationAfterBoundary(top, opts.forkMessageId, opts.forkTurnCount)) {
      break;
    }
    mutations.pop();
    const previous = top.previous;
    summaryKind = previous.summaryKind;
    scopes = { ...previous.scopes };
    branchId = previous.branchId;
    branchStatus = previous.branchStatus;
    promotedBy = previous.promotedBy;
    promotedAt = previous.promotedAt;
    summary =
      previous.scopes[previous.summaryKind]?.trim() ||
      previous.scopes.branch_canon ||
      previous.scopes.noncanon ||
      previous.scopes.main_canon ||
      summary;
    if (parsed.inactive && top.action === "close_branch") {
      inactive = 0;
    }
  }

  const remappedMutations: BranchControlMutation[] = mutations.map((mutation) => ({
    ...mutation,
    sourceUserMessageId: remapOptionalId(opts.messageIdMap, mutation.sourceUserMessageId) ?? undefined,
  }));
  const remappedSourceMessageIds = (parsed.sourceMessageIds ?? [])
    .map((id) => remapOptionalId(opts.messageIdMap, id))
    .filter((id): id is number => id != null);

  const nextPayload: ScopePayloadV1 = {
    v: 1,
    scopes,
    branchId,
    branchStatus: branchStatus as ScopePayloadV1["branchStatus"],
    promotedBy,
    promotedAt,
    sourceMessageIds: remappedSourceMessageIds.length > 0 ? remappedSourceMessageIds : undefined,
    branchControlMutations: remappedMutations.length > 0 ? remappedMutations : undefined,
    inactive: inactive === 1 ? true : parsed.inactive,
  };

  return {
    summaryKind,
    summary,
    scopePayload: encodeScopePayload(nextPayload),
    branchId,
    branchStatus,
    promotedBy,
    promotedAt,
    inactive,
  };
}

export function remapForkResetBoundary(opts: {
  parentResetAfterMessageId: number | null;
  forkMessageId: number;
  copiedParentMessageIds: readonly number[];
  messageIdMap: ReadonlyMap<number, number>;
}): number | null {
  if (opts.parentResetAfterMessageId == null) return null;
  const parentBoundaryAtFork = Math.min(
    opts.parentResetAfterMessageId,
    opts.forkMessageId
  );
  let lastBlockedParentMessageId: number | null = null;
  for (const parentMessageId of opts.copiedParentMessageIds) {
    if (parentMessageId > parentBoundaryAtFork) break;
    lastBlockedParentMessageId = parentMessageId;
  }
  return lastBlockedParentMessageId == null
    ? null
    : (opts.messageIdMap.get(lastBlockedParentMessageId) ?? null);
}

/** 부모 채팅의 롤링 요약 페이지를 분기 시점까지 새 채팅에 복사 */
export function copyForkTurnSummaries(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    forkMessageId: number;
    messageIdMap: Map<number, number>;
  }
): number {
  if (opts.forkTurnCount < FORK_MEMORY_TURN_INTERVAL) return 0;
  if (!tableExists(db, "chat_turn_summaries")) return 0;

  const rows = db
    .prepare(
      `SELECT turn_number, assistant_message_id,
              source_start_user_message_id, source_end_user_message_id,
              summary, user_edited,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              scope_payload, branch_id, branch_status, promoted_by, promoted_at,
              COALESCE(inactive, 0) AS inactive
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(opts.sourceChatId) as {
    turn_number: number;
    assistant_message_id: number | null;
    source_start_user_message_id: number | null;
    source_end_user_message_id: number | null;
    summary: string;
    user_edited: number;
    summary_kind: string;
    scope_payload: string | null;
    branch_id: string | null;
    branch_status: string | null;
    promoted_by: string | null;
    promoted_at: string | null;
    inactive: number;
  }[];

  const ins = db.prepare(
    `INSERT INTO chat_turn_summaries
      (chat_id, turn_number, assistant_message_id, summary, user_edited,
       summary_kind, scope_payload, branch_id, branch_status, promoted_by, promoted_at, inactive,
       source_start_user_message_id, source_end_user_message_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  let copied = 0;
  for (const row of rows) {
    const turnEnd = row.turn_number + FORK_MEMORY_TURN_INTERVAL - 1;
    if (turnEnd > opts.forkTurnCount) continue;
    if (parentIdAfterFork(row.assistant_message_id, opts.forkMessageId)) continue;
    if (parentIdAfterFork(row.source_start_user_message_id, opts.forkMessageId)) continue;
    if (parentIdAfterFork(row.source_end_user_message_id, opts.forkMessageId)) continue;

    const rewound = rewindScopePayloadToFork({
      summaryKind: row.summary_kind,
      summary: row.summary,
      scopePayload: row.scope_payload,
      branchId: row.branch_id,
      branchStatus: row.branch_status,
      promotedBy: row.promoted_by,
      promotedAt: row.promoted_at,
      inactive: row.inactive ?? 0,
      forkMessageId: opts.forkMessageId,
      forkTurnCount: opts.forkTurnCount,
      messageIdMap: opts.messageIdMap,
    });

    ins.run(
      opts.newChatId,
      row.turn_number,
      remapOptionalId(opts.messageIdMap, row.assistant_message_id),
      rewound.summary,
      row.user_edited ?? 0,
      rewound.summaryKind,
      rewound.scopePayload,
      rewound.branchId,
      rewound.branchStatus,
      rewound.promotedBy,
      rewound.promotedAt,
      rewound.inactive,
      remapOptionalId(opts.messageIdMap, row.source_start_user_message_id),
      remapOptionalId(opts.messageIdMap, row.source_end_user_message_id)
    );
    copied += 1;
  }

  return copied;
}

/** 분기 시점 이전 구조화 에피소드 사실만 새 채팅으로 복사 */
export function copyForkEpisodicMemoryFacts(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    parentResetAfterMessageId: number | null;
    messageIdMap: ReadonlyMap<number, number>;
  }
): number {
  if (!tableExists(db, "episodic_memory_facts")) return 0;

  const rows = db
    .prepare(
      `SELECT character_id, user_id, source_turn, source_user_message_id,
              category, subject, attribute, value, importance, fact_text, metadata
       FROM episodic_memory_facts WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.sourceChatId) as {
    character_id: number | null;
    user_id: number | null;
    source_turn: number;
    source_user_message_id: number | null;
    category: string;
    subject: string;
    attribute: string;
    value: string;
    importance: string;
    fact_text: string;
    metadata: string;
  }[];

  const ins = db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, character_id, user_id, source_turn, source_user_message_id,
       category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  let copied = 0;
  for (const row of rows) {
    const sourceUserMessageId = row.source_user_message_id;
    if (sourceUserMessageId != null && sourceUserMessageId > 0) {
      if (!opts.messageIdMap.has(sourceUserMessageId)) continue;
      if (
        opts.parentResetAfterMessageId != null &&
        sourceUserMessageId <= opts.parentResetAfterMessageId
      ) {
        continue;
      }
    } else if (row.source_turn > opts.forkTurnCount) {
      continue;
    } else if (opts.parentResetAfterMessageId != null) {
      continue;
    }

    let metadata = row.metadata || "{}";
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const assistantId = Number(parsed.assistant_message_id);
      if (Number.isFinite(assistantId) && assistantId > 0) {
        const remapped = opts.messageIdMap.get(assistantId);
        if (remapped != null) parsed.assistant_message_id = remapped;
        else delete parsed.assistant_message_id;
      }
      metadata = JSON.stringify(parsed);
    } catch {
      metadata = row.metadata || "{}";
    }

    ins.run(
      opts.newChatId,
      row.character_id,
      row.user_id,
      row.source_turn,
      remapOptionalId(opts.messageIdMap, sourceUserMessageId),
      row.category,
      row.subject,
      row.attribute,
      row.value,
      row.importance,
      row.fact_text,
      metadata
    );
    copied += 1;
  }
  return copied;
}

/** 분기 시점까지 활성화된 키워드 로어북 캐리오버만 복사 */
export function copyForkLorebookActiveEntries(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
  }
): number {
  if (!tableExists(db, "lorebook_active_entries")) return 0;
  const rows = db
    .prepare(
      `SELECT lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn
       FROM lorebook_active_entries WHERE chat_id=? AND last_turn <= ?`
    )
    .all(opts.sourceChatId, opts.forkTurnCount) as {
    lorebook_id: number;
    entry_key: string;
    content: string;
    keyword: string;
    last_source: string;
    last_turn: number;
    expires_after_turn: number;
  }[];
  if (rows.length === 0) return 0;
  const ins = db.prepare(
    `INSERT INTO lorebook_active_entries
      (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const row of rows) {
    ins.run(
      opts.newChatId,
      row.lorebook_id,
      row.entry_key,
      row.content,
      row.keyword,
      row.last_source,
      row.last_turn,
      row.expires_after_turn
    );
  }
  return rows.length;
}

/** 분기 시점 이전에 발화한 상태 트리거만 복사 — 이후 턴 fire_once 재발화 방지 */
export function copyForkStatusTriggerEvents(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    messageIdMap: ReadonlyMap<number, number>;
  }
): number {
  if (!tableExists(db, "status_trigger_events")) return 0;
  const rows = db
    .prepare(
      `SELECT character_id, trigger_id, event_key, source_turn, effect_text,
              is_consumed, fired_at, consumed_at, metadata, source_message_id,
              request_id, generation_sequence,
              COALESCE(is_superseded, 0) AS is_superseded,
              superseded_at, superseded_reason
       FROM status_trigger_events WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.sourceChatId) as {
    character_id: number | null;
    trigger_id: string;
    event_key: string;
    source_turn: number;
    effect_text: string;
    is_consumed: number;
    fired_at: string;
    consumed_at: string | null;
    metadata: string | null;
    source_message_id: number | null;
    request_id: string | null;
    generation_sequence: number | null;
    is_superseded: number;
    superseded_at: string | null;
    superseded_reason: string | null;
  }[];

  const ins = db.prepare(
    `INSERT INTO status_trigger_events
      (chat_id, character_id, trigger_id, event_key, source_turn, effect_text,
       is_consumed, fired_at, consumed_at, metadata, source_message_id,
       request_id, generation_sequence, is_superseded, superseded_at, superseded_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  let copied = 0;
  for (const row of rows) {
    const sourceMessageId = row.source_message_id;
    if (sourceMessageId != null && sourceMessageId > 0) {
      if (!opts.messageIdMap.has(sourceMessageId)) continue;
    } else if (row.source_turn > opts.forkTurnCount) {
      continue;
    }
    ins.run(
      opts.newChatId,
      row.character_id,
      row.trigger_id,
      row.event_key,
      row.source_turn,
      row.effect_text,
      row.is_consumed,
      row.fired_at,
      row.consumed_at,
      row.metadata,
      remapOptionalId(opts.messageIdMap, sourceMessageId),
      row.request_id,
      row.generation_sequence,
      row.is_superseded,
      row.superseded_at,
      row.superseded_reason
    );
    copied += 1;
  }
  return copied;
}

/** 분기 시점까지의 수치 상태 이벤트만 복사하고 current를 그 시점 값으로 재구성 */
export function copyForkNumericState(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    messageIdMap: ReadonlyMap<number, number>;
  }
): number {
  if (!tableExists(db, "rp_numeric_state_events")) return 0;

  const events = db
    .prepare(
      `SELECT id, character_id, state_key, mutation_id,
              before_value, proposed_value, proposed_delta, applied_delta, after_value,
              outcome, adjustments_json, source_turn, assistant_message_id, request_id,
              generation_sequence, source_kind, replaces_event_id,
              revision_before, revision_after, policy_version, definition_hash
       FROM rp_numeric_state_events WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.sourceChatId) as {
    id: number;
    character_id: number | null;
    state_key: string;
    mutation_id: string;
    before_value: number | null;
    proposed_value: number | null;
    proposed_delta: number | null;
    applied_delta: number | null;
    after_value: number | null;
    outcome: string;
    adjustments_json: string;
    source_turn: number | null;
    assistant_message_id: number | null;
    request_id: string | null;
    generation_sequence: number | null;
    source_kind: string;
    replaces_event_id: number | null;
    revision_before: number;
    revision_after: number;
    policy_version: number;
    definition_hash: string | null;
  }[];

  const ins = db.prepare(
    `INSERT INTO rp_numeric_state_events (
      chat_id, character_id, state_key, mutation_id,
      before_value, proposed_value, proposed_delta, applied_delta, after_value,
      outcome, adjustments_json, source_turn, assistant_message_id, request_id,
      generation_sequence, source_kind, replaces_event_id,
      revision_before, revision_after, policy_version, definition_hash, idempotency_key
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const eventIdMap = new Map<number, number>();
  const latestByKey = new Map<
    string,
    {
      characterId: number | null;
      afterValue: number;
      revision: number;
      eventId: number;
      sourceTurn: number | null;
      assistantMessageId: number | null;
      requestId: string | null;
      generationSequence: number | null;
    }
  >();

  for (const event of events) {
    const assistantMessageId = event.assistant_message_id;
    if (assistantMessageId != null && assistantMessageId > 0) {
      if (!opts.messageIdMap.has(assistantMessageId)) continue;
    } else if (event.source_turn != null && event.source_turn > opts.forkTurnCount) {
      continue;
    }

    const remappedAssistantId = remapOptionalId(opts.messageIdMap, assistantMessageId);
    const remappedReplacesId =
      event.replaces_event_id != null ? (eventIdMap.get(event.replaces_event_id) ?? null) : null;
    const idempotencyKey = buildNumericIdempotencyKey({
      chatId: opts.newChatId,
      stateKey: event.state_key,
      mutationId: event.mutation_id,
      sourceKind: asNumericSourceKind(event.source_kind),
    });

    const info = ins.run(
      opts.newChatId,
      event.character_id,
      event.state_key,
      event.mutation_id,
      event.before_value,
      event.proposed_value,
      event.proposed_delta,
      event.applied_delta,
      event.after_value,
      event.outcome,
      event.adjustments_json,
      event.source_turn,
      remappedAssistantId,
      event.request_id,
      event.generation_sequence,
      event.source_kind,
      remappedReplacesId,
      event.revision_before,
      event.revision_after,
      event.policy_version,
      event.definition_hash,
      idempotencyKey
    );
    const newEventId = Number(info.lastInsertRowid);
    eventIdMap.set(event.id, newEventId);
    if (event.after_value != null && Number.isFinite(event.after_value)) {
      latestByKey.set(event.state_key, {
        characterId: event.character_id,
        afterValue: event.after_value,
        revision: event.revision_after,
        eventId: newEventId,
        sourceTurn: event.source_turn,
        assistantMessageId: remappedAssistantId,
        requestId: event.request_id,
        generationSequence: event.generation_sequence,
      });
    }
  }

  if (!tableExists(db, "rp_numeric_state_current")) return eventIdMap.size;
  const upsert = db.prepare(
    `INSERT INTO rp_numeric_state_current (
      chat_id, character_id, state_key, numeric_value, revision,
      last_event_id, last_source_turn, last_source_message_id,
      last_request_id, last_generation_sequence, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
     ON CONFLICT(chat_id, state_key) DO UPDATE SET
       character_id=excluded.character_id,
       numeric_value=excluded.numeric_value,
       revision=excluded.revision,
       last_event_id=excluded.last_event_id,
       last_source_turn=excluded.last_source_turn,
       last_source_message_id=excluded.last_source_message_id,
       last_request_id=excluded.last_request_id,
       last_generation_sequence=excluded.last_generation_sequence,
       updated_at=datetime('now')`
  );
  for (const [stateKey, current] of latestByKey) {
    upsert.run(
      opts.newChatId,
      current.characterId,
      stateKey,
      current.afterValue,
      current.revision,
      current.eventId,
      current.sourceTurn,
      current.assistantMessageId,
      current.requestId,
      current.generationSequence
    );
  }
  return eventIdMap.size;
}

export function copyForkMemoryArtifacts(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    forkMessageId: number;
    parentResetAfterMessageId: number | null;
    messageIdMap: Map<number, number>;
  }
): { copiedSummaryPages: number } {
  remapCopiedUserMessageIds(db, {
    sourceChatId: opts.sourceChatId,
    forkMessageId: opts.forkMessageId,
    messageIdMap: opts.messageIdMap,
  });
  const copiedSummaryPages = copyForkTurnSummaries(db, {
    sourceChatId: opts.sourceChatId,
    newChatId: opts.newChatId,
    forkTurnCount: opts.forkTurnCount,
    forkMessageId: opts.forkMessageId,
    messageIdMap: opts.messageIdMap,
  });
  copyForkEpisodicMemoryFacts(db, {
    sourceChatId: opts.sourceChatId,
    newChatId: opts.newChatId,
    forkTurnCount: opts.forkTurnCount,
    parentResetAfterMessageId: opts.parentResetAfterMessageId,
    messageIdMap: opts.messageIdMap,
  });
  copyForkLorebookActiveEntries(db, {
    sourceChatId: opts.sourceChatId,
    newChatId: opts.newChatId,
    forkTurnCount: opts.forkTurnCount,
  });
  copyForkStatusTriggerEvents(db, {
    sourceChatId: opts.sourceChatId,
    newChatId: opts.newChatId,
    forkTurnCount: opts.forkTurnCount,
    messageIdMap: opts.messageIdMap,
  });
  copyForkNumericState(db, {
    sourceChatId: opts.sourceChatId,
    newChatId: opts.newChatId,
    forkTurnCount: opts.forkTurnCount,
    messageIdMap: opts.messageIdMap,
  });
  return { copiedSummaryPages };
}

export function remapCopiedUserMessageIds(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    forkMessageId: number;
    messageIdMap: ReadonlyMap<number, number>;
  }
): void {
  const rows = db
    .prepare(
      `SELECT id, user_message_id FROM messages
       WHERE chat_id=? AND id <= ? AND user_message_id IS NOT NULL`
    )
    .all(opts.sourceChatId, opts.forkMessageId) as {
    id: number;
    user_message_id: number | null;
  }[];
  const upd = db.prepare(`UPDATE messages SET user_message_id=? WHERE id=?`);
  for (const row of rows) {
    const newAssistantId = opts.messageIdMap.get(row.id);
    const newUserId = remapOptionalId(opts.messageIdMap, row.user_message_id);
    if (newAssistantId == null || newUserId == null) continue;
    upd.run(newUserId, newAssistantId);
  }
}

/** 복사된 히스토리 페이지로 분기 채팅 장기기억 초기화 */
export async function initializeForkChatMemory(opts: {
  newChatId: number;
  userId: number;
  characterId: number;
  forkTurnCount: number;
  tier: MemoryTier;
  memoryCapacity: number;
}): Promise<{ recentSummary: string; summarizedTurnCount: number }> {
  const summarizedTurnCount = forkSummarizedTurnCount(opts.forkTurnCount);

  if (!isMemoryFeatureEnabled()) {
    return { recentSummary: "", summarizedTurnCount: 0 };
  }

  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);
  let recentSummary = "";
  let compressed = false;

  if (summarizedTurnCount >= FORK_MEMORY_TURN_INTERVAL) {
    const resolved = await resolveLorebookFromRecords(opts.newChatId, budget.lorebook);
    recentSummary = resolved.text;
    compressed = resolved.compressed;
  }

  getOrCreateChatMemory(opts.newChatId, opts.userId, opts.characterId, opts.tier);
  updateChatMemory(opts.newChatId, opts.userId, opts.characterId, {
    recent_summary: recentSummary,
    archive_summary: "",
    message_count: opts.forkTurnCount,
    summarized_turn_count: summarizedTurnCount,
    membership_tier: opts.tier,
    last_compressed_at: compressed ? new Date().toISOString() : null,
  });

  const db = getDb();
  db.prepare(
    `UPDATE chats SET memory=?, current_summary=?, memory_archived_turns=? WHERE id=? AND user_id=?`
  ).run(recentSummary, recentSummary, summarizedTurnCount, opts.newChatId, opts.userId);

  return { recentSummary, summarizedTurnCount };
}
