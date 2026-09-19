import { getDb } from "@/lib/db";
import {
  generationJobKey,
  isCurrentAssistantGeneration,
  resolveActiveAssistantGenerationScope,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { extractSuggestedRepliesFromTurn } from "./extract";
import {
  parseSuggestedRepliesRecord,
  serializeSuggestedRepliesRecord,
  suggestedRepliesHaveContent,
} from "./parse";
import type {
  SuggestedRepliesRecord,
  SuggestedRepliesRecordSource,
  SuggestedReplyItem,
} from "./types";
const running = new Set<string>();
const EXTRACT_MAX_ATTEMPTS = 1;

function isJobRunning(scope: AssistantGenerationScope): boolean {
  return running.has(generationJobKey(scope));
}

export function resolveSuggestedRepliesExtractMaxAttempts(
  postTurnPhysicalAttemptConsumed?: boolean
): number {
  // The shared attempt consumes this generation's complete post-turn provider
  // budget, even when its suggestions section or transport failed. The next
  // assistant generation gets its own initial attempt; this generation never
  // repairs or retries.
  return postTurnPhysicalAttemptConsumed ? 0 : EXTRACT_MAX_ATTEMPTS;
}

export function loadMessageSuggestedReplies(messageId: number): SuggestedRepliesRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT suggested_replies_json FROM messages WHERE id=?")
    .get(messageId) as { suggested_replies_json: string | null } | undefined;
  return parseSuggestedRepliesRecord(row?.suggested_replies_json ?? null);
}

function writePending(
  messageId: number,
  scope: AssistantGenerationScope,
  source: SuggestedRepliesRecordSource = "post-turn-shared"
): void {
  const db = getDb();
  const pending: SuggestedRepliesRecord = {
    replies: [],
    extractedAt: new Date().toISOString(),
    source,
    pending: true,
    failed: false,
    generationSequence: scope.generationSequence,
    generationRequestId: scope.generationRequestId,
  };
  if (!isCurrentAssistantGeneration(scope, db)) {
    console.info("STALE_GENERATION_RESULT_REJECTED", {
      family: "suggested_replies_repair",
      messageId,
      generationSequence: scope.generationSequence,
      phase: "pending_write",
    });
    return;
  }
  db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
    serializeSuggestedRepliesRecord(pending),
    messageId
  );
}

function writeReplies(
  messageId: number,
  scope: AssistantGenerationScope,
  replies: SuggestedReplyItem[],
  failed = false,
  noRetry = false,
  terminalReason?: SuggestedRepliesRecord["terminalReason"],
  source: SuggestedRepliesRecordSource = "post-turn-shared"
): void {
  const db = getDb();
  if (!isCurrentAssistantGeneration(scope, db)) {
    console.info("STALE_GENERATION_RESULT_REJECTED", {
      family: "suggested_replies_repair",
      messageId,
      generationSequence: scope.generationSequence,
      phase: "result_write",
    });
    return;
  }
  const record: SuggestedRepliesRecord = {
    replies,
    extractedAt: new Date().toISOString(),
    source,
    pending: false,
    failed,
    ...(noRetry ? { noRetry: true } : {}),
    ...(terminalReason ? { terminalReason } : {}),
    generationSequence: scope.generationSequence,
    generationRequestId: scope.generationRequestId,
  };
  db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
    serializeSuggestedRepliesRecord(record),
    messageId
  );
}

/** 재생성 시작 — 이전 추천을 즉시 pending으로 교체 */
export function markMessageSuggestedRepliesPending(
  messageId: number,
  generationScope?: AssistantGenerationScope
): void {
  const scope =
    generationScope ??
    resolveActiveAssistantGenerationScope(messageId) ??
    ({
      assistantMessageId: messageId,
      generationSequence: 0,
      generationRequestId: null,
    } satisfies AssistantGenerationScope);
  writePending(messageId, scope);
}

/** Persist original-turn ineligibility so a later GET cannot create provider work. */
export function markMessageSuggestedRepliesIneligible(
  messageId: number,
  generationScope: AssistantGenerationScope
): void {
  writeReplies(messageId, generationScope, [], true, true, "original_turn_ineligible");
}

export function isSuggestedRepliesJobRunning(scope: AssistantGenerationScope): boolean {
  return isJobRunning(scope);
}

async function runSuggestedRepliesExtraction(opts: {
  messageId: number;
  chatId: number;
  generationScope: AssistantGenerationScope;
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  prefetchedReplies?: SuggestedReplyItem[] | null;
  sharedInitialAttemptConsumed?: boolean;
  __testExtract?: (attempt: number) => Promise<SuggestedReplyItem[]>;
}): Promise<SuggestedReplyItem[]> {
  if (suggestedRepliesHaveContent(opts.prefetchedReplies)) {
    return opts.prefetchedReplies!;
  }

  const maxAttempts = resolveSuggestedRepliesExtractMaxAttempts(opts.sharedInitialAttemptConsumed);
  if (maxAttempts <= 0) {
    return opts.prefetchedReplies ?? [];
  }

  let last: SuggestedReplyItem[] = opts.prefetchedReplies ?? [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const replies = opts.__testExtract
        ? await opts.__testExtract(attempt)
        : await extractSuggestedRepliesFromTurn({
            charName: opts.charName,
            personaName: opts.personaName,
            personaDescription: opts.personaDescription,
            personaSpeechExamples: opts.personaSpeechExamples,
            userPersona: opts.userPersona,
            userMessage: opts.userMessage,
            assistantProse: opts.assistantProse,
            chatId: opts.chatId,
            messageId: opts.messageId,
            generationSequence: opts.generationScope.generationSequence,
            generationRequestId: opts.generationScope.generationRequestId,
            jobAttemptOrdinal: attempt,
          });
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
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  return last;
}

/** Fire-and-forget — Flash sub-model, never blocks main RP generation */
export function scheduleSuggestedRepliesExtraction(opts: {
  messageId: number;
  chatId: number;
  generationScope: AssistantGenerationScope;
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  prefetchedReplies?: SuggestedReplyItem[] | null;
  sharedInitialAttemptConsumed?: boolean;
  __testExtract?: (attempt: number) => Promise<SuggestedReplyItem[]>;
}): void {
  const physicalAttemptConsumed = opts.sharedInitialAttemptConsumed ?? false;
  const recordSource: SuggestedRepliesRecordSource = physicalAttemptConsumed
    ? "post-turn-shared"
    : "standalone-extract";
  if (physicalAttemptConsumed) {
    const replies = suggestedRepliesHaveContent(opts.prefetchedReplies)
      ? opts.prefetchedReplies!
      : [];
    try {
      writeReplies(opts.messageId, opts.generationScope, replies, replies.length === 0, true, undefined, recordSource);
    } catch (error) {
      console.error(
        "[SUGGESTED-REPLIES-ERROR] terminal shared write failed",
        (error as Error).message
      );
    }
    return;
  }
  const jobKey = generationJobKey(opts.generationScope);
  if (running.has(jobKey)) return;
  running.add(jobKey);

  try {
    writePending(opts.messageId, opts.generationScope, recordSource);
  } catch (e) {
    console.error("[SUGGESTED-REPLIES-ERROR] pending write failed", (e as Error).message);
  }

  void (async () => {
    try {
      const replies = await runSuggestedRepliesExtraction(opts);
      const ok = suggestedRepliesHaveContent(replies);
      writeReplies(
        opts.messageId,
        opts.generationScope,
        replies,
        !ok,
        opts.sharedInitialAttemptConsumed === true,
        undefined,
        recordSource
      );
      if (!ok) {
        console.error("[SUGGESTED-REPLIES-ERROR] extraction finished without 3 replies", {
          messageId: opts.messageId,
          chatId: opts.chatId,
        });
      }
    } catch (e) {
      console.error("[SUGGESTED-REPLIES-ERROR] extraction job failed", (e as Error).message);
      try {
        writeReplies(
          opts.messageId,
          opts.generationScope,
          [],
          true,
          opts.sharedInitialAttemptConsumed === true,
          undefined,
          recordSource
        );
      } catch (writeErr) {
        console.error(
          "[SUGGESTED-REPLIES-ERROR] failed to write failed replies after job error",
          (writeErr as Error).message
        );
      }
    } finally {
      running.delete(jobKey);
    }
  })();
}

/** Greeting bootstrap — standalone extract (no shared post-turn owner on chat create). */
export function scheduleGreetingSuggestedRepliesExtraction(messageId: number, chatId: number): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.content, c.selected_persona_id, ch.name AS char_name
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN characters ch ON ch.id = c.character_id
       WHERE m.id=? AND m.chat_id=? AND m.role='assistant'`
    )
    .get(messageId, chatId) as
    | {
        content: string;
        selected_persona_id: number | null;
        char_name: string;
      }
    | undefined;
  if (!row?.content?.trim()) return;

  const generationScope =
    resolveActiveAssistantGenerationScope(messageId) ??
    ({
      assistantMessageId: messageId,
      generationSequence: 0,
      generationRequestId: null,
    } satisfies AssistantGenerationScope);

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

  scheduleSuggestedRepliesExtraction({
    messageId,
    chatId,
    generationScope,
    charName: row.char_name,
    personaName,
    personaDescription,
    personaSpeechExamples,
    userMessage: "",
    assistantProse: row.content,
  });
}
