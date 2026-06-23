import { getDb } from "@/lib/db";
import {
  getAnalysisBatchSize,
  getHighDislikeThreshold,
  getHighLikeThreshold,
  getMinRegeneratesForProblematic,
} from "./config";
import type { AnalysisCandidate } from "./types";

export function computeFeedbackFingerprint(
  vote: number | null,
  reasons: string[],
  feedbackUpdatedAt: string | null
): string {
  if (vote == null) return "none";
  return `${vote}:${JSON.stringify(reasons)}:${feedbackUpdatedAt ?? ""}`;
}

function parseCompletedTurns(contextJson: string): number | null {
  try {
    const ctx = JSON.parse(contextJson) as { completedTurns?: number };
    return typeof ctx.completedTurns === "number" ? ctx.completedTurns : null;
  } catch {
    return null;
  }
}

export function selectAnalysisCandidates(limit = getAnalysisBatchSize()): AnalysisCandidate[] {
  const db = getDb();
  const likeThreshold = getHighLikeThreshold();
  const dislikeThreshold = getHighDislikeThreshold();
  const minRegens = getMinRegeneratesForProblematic();

  const rows = db
    .prepare(
      `SELECT
         m.id AS message_id,
         m.chat_id,
         c.user_id,
         m.content,
         mf.vote,
         mf.reasons,
         mf.updated_at AS feedback_updated_at,
         ms.quality_score,
         m.is_refunded,
         COALESCE(regen.cnt, 0) AS regenerate_count,
         COALESCE(mg.context_json, '{}') AS context_json
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       LEFT JOIN message_feedback mf ON mf.message_id = m.id
       LEFT JOIN message_scores ms ON ms.message_id = m.id
       LEFT JOIN (
         SELECT message_id, COUNT(*) AS cnt
         FROM preference_events
         WHERE event_type = 'regenerate' AND message_id IS NOT NULL
         GROUP BY message_id
       ) regen ON regen.message_id = m.id
       LEFT JOIN message_generations mg ON mg.message_id = m.id
         AND mg.id = (
           SELECT id FROM message_generations
           WHERE message_id = m.id
           ORDER BY created_at DESC LIMIT 1
         )
       WHERE m.role = 'assistant'
         AND (
           (mf.vote = 1 AND (ms.quality_score IS NULL OR ms.quality_score >= ?))
           OR mf.vote = -1
           OR m.is_refunded = 1
           OR (ms.quality_score IS NOT NULL AND ms.quality_score <= ?)
           OR (ms.quality_score IS NOT NULL AND ms.quality_score >= ? AND ms.confidence >= 0.4)
           OR COALESCE(regen.cnt, 0) >= ?
           OR EXISTS (
             SELECT 1 FROM preference_events pe
             WHERE pe.message_id = m.id AND pe.event_type = 'feedback_dislike'
           )
         )
       ORDER BY COALESCE(mf.updated_at, ms.updated_at, m.created_at) DESC
       LIMIT ?`
    )
    .all(
      likeThreshold,
      dislikeThreshold,
      likeThreshold + 0.15,
      minRegens,
      limit * 3
    ) as {
    message_id: number;
    chat_id: number;
    user_id: number;
    content: string;
    vote: number | null;
    reasons: string;
    feedback_updated_at: string | null;
    quality_score: number | null;
    is_refunded: number;
    regenerate_count: number;
    context_json: string;
  }[];

  const candidates: AnalysisCandidate[] = [];
  for (const row of rows) {
    let reasons: string[] = [];
    try {
      reasons = JSON.parse(row.reasons || "[]") as string[];
    } catch {
      reasons = [];
    }
    const fingerprint = computeFeedbackFingerprint(
      row.vote,
      reasons,
      row.feedback_updated_at
    );
    candidates.push({
      messageId: row.message_id,
      chatId: row.chat_id,
      userId: row.user_id,
      content: row.content,
      vote: row.vote,
      reasons,
      feedbackUpdatedAt: row.feedback_updated_at,
      qualityScore: row.quality_score,
      isRefunded: !!row.is_refunded,
      regenerateCount: row.regenerate_count,
      contextJson: row.context_json,
      completedTurns: parseCompletedTurns(row.context_json),
      feedbackFingerprint: fingerprint,
    });
    if (candidates.length >= limit) break;
  }

  return candidates;
}
