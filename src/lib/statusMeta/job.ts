import { getDb } from "@/lib/db";
import { extractStatusMetaFromTurn } from "./extract";
import {
  rebalanceTableMarkdownWithFormatSpec,
  tableMarkdownHasContent,
} from "./formatSpec";
import { statusMetaHasDisplayContent } from "./render";
import {
  parseStatusMetaRecord,
  serializeStatusMetaRecord,
  type StatusMeta,
  type StatusMetaRecord,
} from "./types";

const running = new Set<number>();
const STALE_PENDING_MS = 90_000;
const EXTRACT_MAX_ATTEMPTS = 3;

export function loadMessageStatusMeta(messageId: number): StatusMetaRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT status_meta FROM messages WHERE id=?")
    .get(messageId) as { status_meta: string | null } | undefined;
  return parseStatusMetaRecord(row?.status_meta ?? null);
}

export function isStatusMetaRecordStalePending(record: StatusMetaRecord | null): boolean {
  if (!record?.pending || !record.extractedAt) return false;
  const age = Date.now() - new Date(record.extractedAt).getTime();
  return age >= STALE_PENDING_MS;
}

/** Last completed status meta before optional excludeMessageId (current turn being extracted) */
export function loadPreviousTurnStatusMeta(
  chatId: number,
  excludeMessageId?: number
): StatusMeta | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, status_meta FROM messages
       WHERE chat_id=? AND role='assistant' AND (model IS NULL OR model != 'greeting')
       AND status_meta IS NOT NULL AND status_meta != ''
       ORDER BY id DESC LIMIT 12`
    )
    .all(chatId) as { id: number; status_meta: string }[];

  for (const row of rows) {
    if (excludeMessageId != null && row.id === excludeMessageId) continue;
    const rec = parseStatusMetaRecord(row.status_meta);
    if (rec && !rec.pending && !rec.failed && statusMetaHasDisplayContent(rec.meta, rec.formatSpec)) {
      return rec.meta;
    }
  }
  return null;
}

/** @deprecated use loadPreviousTurnStatusMeta */
export function loadLastMessageStatusMeta(chatId: number): StatusMeta | null {
  return loadPreviousTurnStatusMeta(chatId);
}

function writePending(messageId: number, formatSpec?: string | null): void {
  const db = getDb();
  const pending: StatusMetaRecord = {
    meta: {
      tableMarkdown: "",
      datetime: "",
      location: "",
      relationship: "",
      npcEmotion: "",
      npcIntent: "",
      nextObjective: "",
      hiddenThought: "",
      sceneSummary: "",
    },
    extractedAt: new Date().toISOString(),
    source: "background-flash",
    pending: true,
    failed: false,
    formatSpec: formatSpec ?? null,
  };
  db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(
    serializeStatusMetaRecord(pending),
    messageId
  );
}

function writeMeta(
  messageId: number,
  meta: StatusMeta,
  formatSpec?: string | null,
  failed = false
): void {
  const db = getDb();
  const record: StatusMetaRecord = {
    meta,
    extractedAt: new Date().toISOString(),
    source: "background-flash",
    pending: false,
    failed,
    formatSpec: formatSpec ?? null,
  };
  db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(
    serializeStatusMetaRecord(record),
    messageId
  );
}

/** 재생성 시작 — 이전 status_meta 즉시 pending으로 교체 (폴링·SSR stale 방지) */
export function markMessageStatusMetaPending(
  messageId: number,
  formatSpec?: string | null
): void {
  writePending(messageId, formatSpec);
}

async function runStatusMetaExtraction(opts: {
  messageId: number;
  chatId: number;
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
  memoryBlock?: string;
  loreBlock?: string;
  formatSpec?: string | null;
}): Promise<StatusMeta> {
  const formatSpec = opts.formatSpec?.trim() || null;
  const previousMeta = loadPreviousTurnStatusMeta(opts.chatId, opts.messageId);
  let lastMeta: StatusMeta = {
    tableMarkdown: "",
    datetime: "",
    location: "",
    relationship: "",
    npcEmotion: "",
    npcIntent: "",
    nextObjective: "",
    hiddenThought: "",
    sceneSummary: "",
  };

  for (let attempt = 1; attempt <= EXTRACT_MAX_ATTEMPTS; attempt++) {
    try {
      const meta = await extractStatusMetaFromTurn({
        ...opts,
        previousMeta,
        formatSpec,
      });
      lastMeta = meta;
      if (statusMetaHasDisplayContent(meta, formatSpec)) {
        if (attempt > 1) {
          console.info("[STATUS-META] extraction succeeded on retry", {
            messageId: opts.messageId,
            attempt,
          });
        }
        return meta;
      }
      console.warn("[STATUS-META] empty extraction result", {
        messageId: opts.messageId,
        attempt,
        hasTable: Boolean(meta.tableMarkdown?.trim()),
      });
    } catch (e) {
      console.error("[STATUS-META-ERROR] extraction attempt failed", {
        messageId: opts.messageId,
        attempt,
        error: (e as Error).message,
      });
    }
    if (attempt < EXTRACT_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }

  return lastMeta;
}

/** Fire-and-forget — Flash sub-model, never blocks main RP generation */
export function scheduleStatusMetaExtraction(opts: {
  messageId: number;
  chatId: number;
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
  memoryBlock?: string;
  loreBlock?: string;
  formatSpec?: string | null;
  /** 모델 본문에서 분리한 pipe-table — Flash 대신 즉시 StatusMetaCard에 사용 */
  prefilledTableMarkdown?: string | null;
}): void {
  if (running.has(opts.messageId)) return;
  running.add(opts.messageId);

  const formatSpec = opts.formatSpec?.trim() || null;
  const prefilled = opts.prefilledTableMarkdown?.trim() || null;

  if (prefilled && tableMarkdownHasContent(prefilled)) {
    try {
      writeMeta(
        opts.messageId,
        {
          tableMarkdown: rebalanceTableMarkdownWithFormatSpec(prefilled, formatSpec ?? ""),
          datetime: "",
          location: "",
          relationship: "",
          npcEmotion: "",
          npcIntent: "",
          nextObjective: "",
          hiddenThought: "",
          sceneSummary: "",
        },
        formatSpec,
        false
      );
    } catch (e) {
      console.error("[STATUS-META-ERROR] prefilled table write failed", (e as Error).message);
    } finally {
      running.delete(opts.messageId);
    }
    return;
  }

  try {
    writePending(opts.messageId, formatSpec);
  } catch (e) {
    console.error("[STATUS-META-ERROR] pending write failed", (e as Error).message);
  }

  void (async () => {
    try {
      const meta = await runStatusMetaExtraction(opts);
      const ok = statusMetaHasDisplayContent(meta, formatSpec);
      writeMeta(opts.messageId, meta, formatSpec, !ok);
      if (!ok) {
        console.error("[STATUS-META-ERROR] extraction finished without displayable meta", {
          messageId: opts.messageId,
          chatId: opts.chatId,
        });
      }
    } catch (e) {
      console.error("[STATUS-META-ERROR] extraction job failed", (e as Error).message);
      try {
        writeMeta(
          opts.messageId,
          {
            tableMarkdown: "",
            datetime: "",
            location: "",
            relationship: "",
            npcEmotion: "",
            npcIntent: "",
            nextObjective: "",
            hiddenThought: "",
            sceneSummary: "",
          },
          formatSpec,
          true
        );
      } catch (writeErr) {
        console.error(
          "[STATUS-META-ERROR] failed to write failed meta after job error",
          (writeErr as Error).message
        );
      }
    } finally {
      running.delete(opts.messageId);
    }
  })();
}

/** pending stuck / failed — status-meta GET에서 재시도 (과도한 재큐 방지) */
export function requeueStatusMetaExtractionIfNeeded(messageId: number): boolean {
  const record = loadMessageStatusMeta(messageId);
  if (!record) return false;

  const stalePending = record.pending === true && isStatusMetaRecordStalePending(record);
  let staleFailed = false;
  if (record.failed === true && !record.pending) {
    const age = Date.now() - new Date(record.extractedAt || 0).getTime();
    staleFailed = age >= 15_000;
  }
  if (!stalePending && !staleFailed) return false;
  if (running.has(messageId)) return true;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id, m.chat_id, m.content, m.user_message_id, c.character_id, c.user_note,
              ch.name AS char_name
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN characters ch ON ch.id = c.character_id
       WHERE m.id=? AND m.role='assistant'`
    )
    .get(messageId) as
    | {
        id: number;
        chat_id: number;
        content: string;
        user_message_id: number | null;
        user_note: string | null;
        char_name: string;
      }
    | undefined;

  if (!row) return false;

  let userMessage = "";
  if (row.user_message_id) {
    const userRow = db
      .prepare("SELECT content FROM messages WHERE id=?")
      .get(row.user_message_id) as { content: string } | undefined;
    userMessage = userRow?.content ?? "";
  }
  if (!userMessage.trim()) {
    const prevUser = db
      .prepare(
        `SELECT content FROM messages
         WHERE chat_id=? AND role='user' AND id < ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(row.chat_id, messageId) as { content: string } | undefined;
    userMessage = prevUser?.content ?? "";
  }

  console.info("[STATUS-META] requeue extraction", {
    messageId,
    chatId: row.chat_id,
    wasFailed: record.failed === true,
    wasStalePending: record.pending === true,
  });

  scheduleStatusMetaExtraction({
    messageId,
    chatId: row.chat_id,
    charName: row.char_name,
    personaName: "유저",
    userMessage,
    assistantProse: row.content,
    userNote: row.user_note ?? undefined,
    formatSpec: record.formatSpec ?? null,
  });
  return true;
}
