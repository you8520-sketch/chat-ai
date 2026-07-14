/**
 * Streaming chat turn persistence — durable user + assistant rows before / during generation.
 * DB is source of truth; sessionStorage is UI fallback only.
 */

import type Database from "better-sqlite3";
import { normalizeMessageVariants } from "./messageAlternates";

export type GenerationStatus =
  | "submitted"
  | "generating"
  | "completed"
  | "completed_with_postprocess_error"
  | "failed"
  | "failed_partial"
  | "interrupted"
  | "ok"; // legacy synonym for completed

export type StreamingTurnBootstrap = {
  requestId: string;
  userMessageId: number | null;
  assistantMessageId: number;
  reusedExisting: boolean;
  userMessageSaved: boolean;
  assistantPlaceholderCreated: boolean;
};

export type StreamingPersistenceDiag = {
  requestId: string;
  userMessageSaved: boolean;
  assistantPlaceholderCreated: boolean;
  partialSaveCount: number;
  lastPartialChars: number;
  finalized: boolean;
  interrupted: boolean;
  postprocessError: boolean;
  recoveredOnLoad: boolean;
  reusedExisting: boolean;
};

const PARTIAL_SAVE_MIN_MS = 700;
const PARTIAL_SAVE_MIN_CHARS = 700;

export function isTerminalGenerationStatus(status: string | null | undefined): boolean {
  const s = (status ?? "completed").toLowerCase();
  return (
    s === "completed" ||
    s === "ok" ||
    s === "completed_with_postprocess_error" ||
    s === "failed" ||
    s === "failed_partial" ||
    s === "interrupted"
  );
}

export function isInFlightGenerationStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "generating" || s === "submitted";
}

export function normalizeClientRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 80) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function createClientRequestId(): string {
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function logStreamingPersistence(diag: StreamingPersistenceDiag): void {
  if (process.env.NODE_ENV === "production" && !diag.interrupted && !diag.postprocessError) {
    // Keep production quiet for happy path
  }
  console.log("[StreamingPersistence]", {
    request_id: diag.requestId,
    userMessageSaved: diag.userMessageSaved,
    assistantPlaceholderCreated: diag.assistantPlaceholderCreated,
    partialSaveCount: diag.partialSaveCount,
    lastPartialChars: diag.lastPartialChars,
    finalized: diag.finalized,
    interrupted: diag.interrupted,
    postprocessError: diag.postprocessError,
    recoveredOnLoad: diag.recoveredOnLoad,
    reusedExisting: diag.reusedExisting,
  });
}

type ExistingTurnRow = {
  id: number;
  role: string;
  content: string;
  request_id: string | null;
  generation_status: string | null;
  user_message_id: number | null;
  deduction_slices: string | null;
};

/** Look up an in-progress or completed turn by request_id (idempotent bootstrap). */
export function findTurnByRequestId(
  db: Database.Database,
  chatId: number,
  requestId: string
): { userMessageId: number | null; assistantMessageId: number | null; assistantStatus: string | null; alreadyBilled: boolean } {
  const rows = db
    .prepare(
      `SELECT id, role, content, request_id, generation_status, user_message_id, deduction_slices
       FROM messages WHERE chat_id=? AND request_id=? ORDER BY id ASC`
    )
    .all(chatId, requestId) as ExistingTurnRow[];

  let userMessageId: number | null = null;
  let assistantMessageId: number | null = null;
  let assistantStatus: string | null = null;
  let alreadyBilled = false;

  for (const row of rows) {
    if (row.role === "user") userMessageId = row.id;
    if (row.role === "assistant") {
      assistantMessageId = row.id;
      assistantStatus = row.generation_status;
      if (row.deduction_slices && row.deduction_slices !== "[]" && row.deduction_slices !== "null") {
        alreadyBilled = true;
      }
    }
  }
  return { userMessageId, assistantMessageId, assistantStatus, alreadyBilled };
}

/**
 * Save user + assistant placeholder before model call (idempotent by request_id).
 * Regenerate: reuses existing assistant id, marks generating, no new user row.
 */
export function bootstrapStreamingTurn(
  db: Database.Database,
  opts: {
    chatId: number;
    requestId: string;
    userContent: string;
    skipUserInsert: boolean;
    existingUserMessageId?: number | null;
    regenerateAssistantId?: number | null;
    characterId?: number;
    onUserInserted?: () => void;
  }
): StreamingTurnBootstrap {
  const existing = findTurnByRequestId(db, opts.chatId, opts.requestId);
  if (existing.assistantMessageId != null) {
    if (isInFlightGenerationStatus(existing.assistantStatus) || !isTerminalGenerationStatus(existing.assistantStatus)) {
      db.prepare(
        `UPDATE messages SET generation_status='generating', updated_at=datetime('now') WHERE id=? AND chat_id=?`
      ).run(existing.assistantMessageId, opts.chatId);
    }
    return {
      requestId: opts.requestId,
      userMessageId: existing.userMessageId ?? opts.existingUserMessageId ?? null,
      assistantMessageId: existing.assistantMessageId,
      reusedExisting: true,
      userMessageSaved: existing.userMessageId != null || opts.skipUserInsert,
      assistantPlaceholderCreated: false,
    };
  }

  if (opts.regenerateAssistantId != null) {
    const existing = db
      .prepare(
        `SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=? AND chat_id=?`
      )
      .get(opts.regenerateAssistantId, opts.chatId) as
      | {
          content: string;
          model: string;
          usage: string | null;
          alternates: string | null;
          active_variant: number | null;
        }
      | undefined;

    // Keep prior version(s) in alternates before wiping content — failed regen / mid-regen
    // refresh must not lose the last good reply (resolveActiveVariantContent reads alternates).
    let alternatesJson = "[]";
    let activeVariant = 0;
    if (existing) {
      const { variants, activeVariant: active } = normalizeMessageVariants(existing);
      alternatesJson = JSON.stringify(variants);
      activeVariant = variants.length > 0 ? active : 0;
    }

    db.prepare(
      `UPDATE messages SET content='', generation_status='generating', request_id=?, is_refunded=0,
       alternates=?, active_variant=?,
       status_meta=NULL, status_widget_values_json='', status_widget_turn_active=0,
       updated_at=datetime('now') WHERE id=? AND chat_id=?`
    ).run(
      opts.requestId,
      alternatesJson,
      activeVariant,
      opts.regenerateAssistantId,
      opts.chatId
    );
    if (opts.existingUserMessageId != null) {
      db.prepare(`UPDATE messages SET request_id=? WHERE id=? AND chat_id=?`).run(
        opts.requestId,
        opts.existingUserMessageId,
        opts.chatId
      );
    }
    return {
      requestId: opts.requestId,
      userMessageId: opts.existingUserMessageId ?? null,
      assistantMessageId: opts.regenerateAssistantId,
      reusedExisting: true,
      userMessageSaved: true,
      assistantPlaceholderCreated: false,
    };
  }

  let userMessageId = opts.existingUserMessageId ?? null;
  let userMessageSaved = opts.skipUserInsert;

  const tx = db.transaction(() => {
    if (!opts.skipUserInsert) {
      const userMsg = db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, request_id, generation_status)
           VALUES (?,?,?,?,?,?)`
        )
        .run(opts.chatId, "user", opts.userContent, "", opts.requestId, "submitted");
      userMessageId = Number(userMsg.lastInsertRowid);
      userMessageSaved = true;
      opts.onUserInserted?.();
    } else if (userMessageId != null) {
      db.prepare(`UPDATE messages SET request_id=? WHERE id=? AND chat_id=?`).run(
        opts.requestId,
        userMessageId,
        opts.chatId
      );
    }

    const aiMsg = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, request_id, generation_status, user_message_id, alternates, active_variant)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        opts.chatId,
        "assistant",
        "",
        "",
        opts.requestId,
        "generating",
        userMessageId,
        "[]",
        0
      );
    return Number(aiMsg.lastInsertRowid);
  });

  const assistantMessageId = tx();

  return {
    requestId: opts.requestId,
    userMessageId,
    assistantMessageId,
    reusedExisting: false,
    userMessageSaved,
    assistantPlaceholderCreated: true,
  };
}

export function createPartialSaveThrottler(opts?: { minMs?: number; minChars?: number }) {
  const minMs = opts?.minMs ?? PARTIAL_SAVE_MIN_MS;
  const minChars = opts?.minChars ?? PARTIAL_SAVE_MIN_CHARS;
  let lastAt = 0;
  let lastChars = 0;
  let saveCount = 0;

  return {
    get partialSaveCount() {
      return saveCount;
    },
    get lastPartialChars() {
      return lastChars;
    },
    maybeSave(db: Database.Database, assistantMessageId: number, content: string): boolean {
      const now = Date.now();
      const chars = content.length;
      if (now - lastAt < minMs && chars - lastChars < minChars) return false;
      db.prepare(
        `UPDATE messages SET content=?, generation_status='generating', updated_at=datetime('now') WHERE id=?`
      ).run(content, assistantMessageId);
      lastAt = now;
      lastChars = chars;
      saveCount += 1;
      return true;
    },
    forceSave(db: Database.Database, assistantMessageId: number, content: string): void {
      db.prepare(
        `UPDATE messages SET content=?, generation_status='generating', updated_at=datetime('now') WHERE id=?`
      ).run(content, assistantMessageId);
      lastAt = Date.now();
      lastChars = content.length;
      saveCount += 1;
    },
  };
}

/** Persist raw completed stream text before expensive post-processing. */
export function persistStreamCompleteContent(
  db: Database.Database,
  assistantMessageId: number,
  content: string
): void {
  db.prepare(
    `UPDATE messages SET content=?, generation_status='generating', updated_at=datetime('now') WHERE id=?`
  ).run(content, assistantMessageId);
}

export function markAssistantInterrupted(
  db: Database.Database,
  assistantMessageId: number,
  partialContent: string
): void {
  db.prepare(
    `UPDATE messages SET content=?, generation_status=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    partialContent,
    partialContent.trim() ? "interrupted" : "failed_partial",
    assistantMessageId
  );
}

export function markAssistantFailed(
  db: Database.Database,
  assistantMessageId: number,
  partialContent: string
): void {
  db.prepare(
    `UPDATE messages SET content=?, generation_status=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    partialContent,
    partialContent.trim() ? "failed_partial" : "failed",
    assistantMessageId
  );
}

/**
 * Regenerate failed before a usable new reply — restore last good alternate into content
 * so refresh / SSR does not show a blank bubble.
 */
export function restoreAssistantFromAlternatesOnFailedRegen(
  db: Database.Database,
  assistantMessageId: number,
  chatId: number
): boolean {
  const row = db
    .prepare(
      `SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=? AND chat_id=?`
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
  if (!row) return false;

  const { variants, activeVariant } = normalizeMessageVariants(row);
  const prev = variants[activeVariant] ?? variants[variants.length - 1];
  if (!prev?.content?.trim()) return false;

  db.prepare(
    `UPDATE messages SET content=?, model=?, usage=?, active_variant=?,
     generation_status='completed', status='ok', updated_at=datetime('now')
     WHERE id=? AND chat_id=?`
  ).run(
    prev.content,
    prev.model ?? row.model ?? "",
    prev.usage ? JSON.stringify(prev.usage) : row.usage,
    variants.length > 0 ? activeVariant : 0,
    assistantMessageId,
    chatId
  );
  return true;
}

/**
 * Chat load recovery for assistant rows stuck in generating/submitted after an
 * aborted stream or a server path that skipped terminalization.
 * Prefers restoring the last good regen alternate; otherwise marks interrupted/failed.
 */
export function recoverStaleInFlightAssistantMessages(
  db: Database.Database,
  chatId: number,
  rows: Array<{
    id: number;
    role: string;
    content: string;
    generation_status: string | null;
  }>
): number {
  let recovered = 0;
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if (!isInFlightGenerationStatus(row.generation_status)) continue;

    const restored = restoreAssistantFromAlternatesOnFailedRegen(db, row.id, chatId);
    if (restored) {
      recovered++;
      continue;
    }
    markAssistantInterrupted(db, row.id, row.content ?? "");
    recovered++;
  }
  if (recovered > 0) {
    console.warn("[StreamingPersistence] recovered stale in-flight assistant rows", {
      chatId,
      recovered,
    });
  }
  return recovered;
}

export function finalizeAssistantMessage(
  db: Database.Database,
  opts: {
    assistantMessageId: number;
    chatId: number;
    content: string;
    model: string;
    usageJson: string;
    alternatesJson: string;
    activeVariant: number;
    statusWidgetValuesJson?: string;
    statusWidgetTurnActive?: number;
    generationStatus?: GenerationStatus;
    alreadyFinalized?: boolean;
  }
): { wrote: boolean; preservedExistingStatusValues?: boolean; statusWidgetValuesJson?: string } {
  const row = db
    .prepare(
      `SELECT generation_status, deduction_slices, status_widget_values_json
       FROM messages WHERE id=? AND chat_id=?`
    )
    .get(opts.assistantMessageId, opts.chatId) as
    | {
        generation_status: string | null;
        deduction_slices: string | null;
        status_widget_values_json: string | null;
      }
    | undefined;

  if (!row) return { wrote: false };

  const status = opts.generationStatus ?? "completed";
  // Idempotent finalize: never rewrite an already-completed turn (prevents double-write races)
  if (
    row.generation_status === "completed" ||
    row.generation_status === "ok" ||
    row.generation_status === "completed_with_postprocess_error"
  ) {
    return { wrote: false };
  }

  const finalStatusWidgetValuesJson = opts.statusWidgetValuesJson ?? "";

  db.prepare(
    `UPDATE messages SET content=?, model=?, usage=?, alternates=?, active_variant=?,
     is_refunded=0, status_meta=NULL, status_widget_values_json=?, status_widget_turn_active=?,
     generation_status=?, status='ok', updated_at=datetime('now') WHERE id=? AND chat_id=?`
  ).run(
    opts.content,
    opts.model,
    opts.usageJson,
    opts.alternatesJson,
    opts.activeVariant,
    finalStatusWidgetValuesJson,
    opts.statusWidgetTurnActive ?? 0,
    status,
    opts.assistantMessageId,
    opts.chatId
  );
  return {
    wrote: true,
    preservedExistingStatusValues: false,
    statusWidgetValuesJson: finalStatusWidgetValuesJson,
  };
}

/** Safe send wrapper: catch enqueue failures so disconnect never aborts generation/DB work. */
export function createDisconnectSafeSend(
  enqueue: (chunk: Uint8Array) => void,
  encode: (obj: object) => Uint8Array
): { send: (obj: object) => void; isDisconnected: () => boolean } {
  let disconnected = false;
  return {
    isDisconnected: () => disconnected,
    send: (obj: object) => {
      if (disconnected) return;
      try {
        enqueue(encode(obj));
      } catch {
        disconnected = true;
      }
    },
  };
}

const STREAM_DRAFT_PREFIX = "chat-stream-draft:v1:";

export type ChatStreamDraft = {
  requestId: string;
  chatId: number;
  userText: string;
  assistantPartial: string;
  updatedAt: number;
};

export function streamDraftStorageKey(characterId: number, chatId: number | null): string {
  return `${STREAM_DRAFT_PREFIX}${characterId}:${chatId ?? "new"}`;
}

export function writeChatStreamDraft(
  characterId: number,
  chatId: number | null,
  draft: ChatStreamDraft
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(streamDraftStorageKey(characterId, chatId), JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

export function readChatStreamDraft(
  characterId: number,
  chatId: number | null
): ChatStreamDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(streamDraftStorageKey(characterId, chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatStreamDraft;
    if (!parsed?.requestId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearChatStreamDraft(characterId: number, chatId: number | null): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(streamDraftStorageKey(characterId, chatId));
  } catch {
    /* ignore */
  }
}
