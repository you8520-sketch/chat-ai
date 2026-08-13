import { getDb } from "@/lib/db";
import { extractSuggestedRepliesFromTurn } from "./extract";
import {
  parseSuggestedRepliesRecord,
  serializeSuggestedRepliesRecord,
  suggestedRepliesHaveContent,
} from "./parse";
import type { SuggestedRepliesRecord, SuggestedReplyItem } from "./types";

const running = new Set<number>();
const STALE_PENDING_MS = 90_000;
const EXTRACT_MAX_ATTEMPTS = 3;

export function loadMessageSuggestedReplies(messageId: number): SuggestedRepliesRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT suggested_replies_json FROM messages WHERE id=?")
    .get(messageId) as { suggested_replies_json: string | null } | undefined;
  return parseSuggestedRepliesRecord(row?.suggested_replies_json ?? null);
}

export function isSuggestedRepliesRecordStalePending(
  record: SuggestedRepliesRecord | null
): boolean {
  if (!record?.pending || !record.extractedAt) return false;
  const age = Date.now() - new Date(record.extractedAt).getTime();
  return age >= STALE_PENDING_MS;
}

function writePending(messageId: number): void {
  const db = getDb();
  const pending: SuggestedRepliesRecord = {
    replies: [],
    extractedAt: new Date().toISOString(),
    source: "background-deepseek",
    pending: true,
    failed: false,
  };
  db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
    serializeSuggestedRepliesRecord(pending),
    messageId
  );
}

function writeReplies(messageId: number, replies: SuggestedReplyItem[], failed = false): void {
  const db = getDb();
  const record: SuggestedRepliesRecord = {
    replies,
    extractedAt: new Date().toISOString(),
    source: "background-deepseek",
    pending: false,
    failed,
  };
  db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
    serializeSuggestedRepliesRecord(record),
    messageId
  );
}

/** 재생성 시작 — 이전 추천을 즉시 pending으로 교체 */
export function markMessageSuggestedRepliesPending(messageId: number): void {
  writePending(messageId);
}

async function runSuggestedRepliesExtraction(opts: {
  messageId: number;
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
}): Promise<SuggestedReplyItem[]> {
  let last: SuggestedReplyItem[] = [];
  for (let attempt = 1; attempt <= EXTRACT_MAX_ATTEMPTS; attempt++) {
    try {
      const replies = await extractSuggestedRepliesFromTurn(opts);
      last = replies;
      if (suggestedRepliesHaveContent(replies)) {
        if (attempt > 1) {
          console.info("[SUGGESTED-REPLIES] extraction succeeded on retry", {
            messageId: opts.messageId,
            attempt,
          });
        }
        return replies;
      }
      console.warn("[SUGGESTED-REPLIES] empty extraction result", {
        messageId: opts.messageId,
        attempt,
      });
    } catch (e) {
      console.error("[SUGGESTED-REPLIES-ERROR] extraction attempt failed", {
        messageId: opts.messageId,
        attempt,
        error: (e as Error).message,
      });
    }
    if (attempt < EXTRACT_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  return last;
}

/** Fire-and-forget — Flash sub-model, never blocks main RP generation */
export function scheduleSuggestedRepliesExtraction(opts: {
  messageId: number;
  chatId: number;
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
}): void {
  if (running.has(opts.messageId)) return;
  running.add(opts.messageId);

  try {
    writePending(opts.messageId);
  } catch (e) {
    console.error("[SUGGESTED-REPLIES-ERROR] pending write failed", (e as Error).message);
  }

  void (async () => {
    try {
      const replies = await runSuggestedRepliesExtraction(opts);
      const ok = suggestedRepliesHaveContent(replies);
      writeReplies(opts.messageId, replies, !ok);
      if (!ok) {
        console.error("[SUGGESTED-REPLIES-ERROR] extraction finished without 3 replies", {
          messageId: opts.messageId,
          chatId: opts.chatId,
        });
      }
    } catch (e) {
      console.error("[SUGGESTED-REPLIES-ERROR] extraction job failed", (e as Error).message);
      try {
        writeReplies(opts.messageId, [], true);
      } catch (writeErr) {
        console.error(
          "[SUGGESTED-REPLIES-ERROR] failed to write failed replies after job error",
          (writeErr as Error).message
        );
      }
    } finally {
      running.delete(opts.messageId);
    }
  })();
}

export function requeueSuggestedRepliesExtractionIfNeeded(messageId: number): boolean {
  const record = loadMessageSuggestedReplies(messageId);
  if (!record) return false;

  const stalePending = record.pending === true && isSuggestedRepliesRecordStalePending(record);
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
      `SELECT m.id, m.chat_id, m.content, m.user_message_id, c.selected_persona_id,
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
        selected_persona_id: number | null;
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

  let personaName = "유저";
  let personaDescription: string | null = null;
  let personaSpeechExamples: string | null = null;
  if (row.selected_persona_id) {
    const persona = db
      .prepare("SELECT name, description, speech_examples FROM user_personas WHERE id=?")
      .get(row.selected_persona_id) as
      | { name: string; description: string; speech_examples: string }
      | undefined;
    if (persona) {
      personaName = persona.name?.trim() || personaName;
      personaDescription = persona.description ?? null;
      personaSpeechExamples = persona.speech_examples ?? null;
    }
  }

  console.info("[SUGGESTED-REPLIES] requeue extraction", {
    messageId,
    chatId: row.chat_id,
    wasFailed: record.failed === true,
    wasStalePending: record.pending === true,
  });

  scheduleSuggestedRepliesExtraction({
    messageId,
    chatId: row.chat_id,
    charName: row.char_name,
    personaName,
    personaDescription,
    personaSpeechExamples,
    userMessage,
    assistantProse: row.content,
  });
  return true;
}
