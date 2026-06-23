import { getDb } from "@/lib/db";
import type {
  GenerationSnapshotInput,
  MessageScore,
  PreferenceEventInput,
} from "./types";

export function recordGenerationSnapshot(input: GenerationSnapshotInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO message_generations
      (message_id, chat_id, user_id, character_id, variant_index, user_message_id,
       model, provider, route, writing_style, nsfw, input_tokens, output_tokens,
       prompt_hash, context_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    input.messageId,
    input.chatId,
    input.userId,
    input.characterId,
    input.variantIndex,
    input.userMessageId,
    input.model,
    input.provider,
    input.route,
    input.writingStyle,
    input.nsfw,
    input.inputTokens,
    input.outputTokens,
    input.promptHash,
    input.contextJson
  );
}

export function recordPreferenceEvent(input: PreferenceEventInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO preference_events (user_id, chat_id, message_id, event_type, payload_json)
     VALUES (?,?,?,?,?)`
  ).run(
    input.userId,
    input.chatId,
    input.messageId,
    input.eventType,
    JSON.stringify(input.payload ?? {})
  );
}

export function upsertMessageScore(
  messageId: number,
  score: number,
  confidence: number,
  signalCount: number,
  continuationRate = 0,
  engagementScore = 0
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO message_scores (message_id, quality_score, confidence, signal_count, continuation_rate, engagement_score, updated_at)
     VALUES (?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(message_id) DO UPDATE SET
       quality_score=excluded.quality_score,
       confidence=excluded.confidence,
       signal_count=excluded.signal_count,
       continuation_rate=excluded.continuation_rate,
       engagement_score=excluded.engagement_score,
       updated_at=datetime('now')`
  ).run(messageId, score, confidence, signalCount, continuationRate, engagementScore);
}

export function getMessageScores(messageIds: number[]): Map<number, MessageScore> {
  const map = new Map<number, MessageScore>();
  if (messageIds.length === 0) return map;
  const db = getDb();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT message_id, quality_score, confidence, signal_count, continuation_rate, engagement_score, updated_at
       FROM message_scores WHERE message_id IN (${placeholders})`
    )
    .all(...messageIds) as {
    message_id: number;
    quality_score: number;
    confidence: number;
    signal_count: number;
    continuation_rate: number;
    engagement_score: number;
    updated_at: string;
  }[];

  for (const row of rows) {
    map.set(row.message_id, {
      messageId: row.message_id,
      qualityScore: row.quality_score,
      confidence: row.confidence,
      signalCount: row.signal_count,
      continuationRate: row.continuation_rate ?? 0,
      engagementScore: row.engagement_score ?? 0,
      updatedAt: row.updated_at,
    });
  }
  return map;
}
