import { getDb } from "@/lib/db";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { upsertMessageScore } from "@/lib/feedback/feedback-db";
import { computeMessageQualityScore } from "@/lib/feedback/scoring";
import type { QualitySignal } from "@/lib/feedback/types";

const ENGAGEMENT_EVENTS: ReadonlySet<string> = new Set([
  PREFERENCE_EVENT.BOOKMARK_ADD,
  PREFERENCE_EVENT.FEEDBACK_LIKE,
  PREFERENCE_EVENT.VARIANT_SWITCH,
]);

export function hasContinuationAfterMessage(messageId: number, chatId: number): boolean {
  const db = getDb();
  const assistant = db
    .prepare("SELECT id, created_at FROM messages WHERE id=? AND chat_id=? AND role='assistant'")
    .get(messageId, chatId) as { id: number; created_at: string } | undefined;
  if (!assistant) return false;

  const nextUser = db
    .prepare(
      `SELECT 1 FROM messages
       WHERE chat_id=? AND role='user' AND id > ?
       LIMIT 1`
    )
    .get(chatId, assistant.id);
  return !!nextUser;
}

export function computeContinuationRate(messageId: number, chatId: number): number {
  return hasContinuationAfterMessage(messageId, chatId) ? 1 : 0;
}

export function computeEngagementScore(messageId: number): number {
  const db = getDb();
  const events = db
    .prepare("SELECT event_type FROM preference_events WHERE message_id=?")
    .all(messageId) as { event_type: string }[];

  let score = 0;
  for (const ev of events) {
    if (ENGAGEMENT_EVENTS.has(ev.event_type)) {
      score += 0.2;
    }
    if (ev.event_type === PREFERENCE_EVENT.REGENERATE) score -= 0.15;
    if (ev.event_type === PREFERENCE_EVENT.FEEDBACK_DISLIKE) score -= 0.25;
  }

  const bookmark = db.prepare("SELECT 1 FROM bookmarks WHERE message_id=? LIMIT 1").get(messageId);
  if (bookmark) score += 0.25;

  return Math.max(-1, Math.min(1, score));
}

export function gatherExtendedSignals(messageId: number): {
  signals: QualitySignal[];
  continuationRate: number;
  engagementScore: number;
} {
  const db = getDb();
  const signals: QualitySignal[] = [];

  const msg = db
    .prepare("SELECT chat_id, is_refunded FROM messages WHERE id=?")
    .get(messageId) as { chat_id: number; is_refunded: number } | undefined;
  if (!msg) {
    return { signals, continuationRate: 0, engagementScore: 0 };
  }

  const feedback = db
    .prepare("SELECT vote, reasons FROM message_feedback WHERE message_id=? LIMIT 1")
    .get(messageId) as { vote: number; reasons: string } | undefined;
  if (feedback) {
    let reasons: string[] = [];
    try {
      reasons = JSON.parse(feedback.reasons) as string[];
    } catch {
      reasons = [];
    }
    signals.push({
      type: feedback.vote === 1 ? "feedback_like" : "feedback_dislike",
      reasons,
    });
  }

  const bookmark = db.prepare("SELECT 1 FROM bookmarks WHERE message_id=? LIMIT 1").get(messageId);
  if (bookmark) signals.push({ type: "bookmark" });

  const events = db
    .prepare("SELECT event_type FROM preference_events WHERE message_id=?")
    .all(messageId) as { event_type: string }[];
  for (const ev of events) {
    if (ev.event_type === PREFERENCE_EVENT.REGENERATE) signals.push({ type: "regenerate" });
    else if (ev.event_type === PREFERENCE_EVENT.VARIANT_SWITCH) signals.push({ type: "variant_switch" });
  }

  if (msg.is_refunded) signals.push({ type: "refund" });

  const continuationRate = computeContinuationRate(messageId, msg.chat_id);
  if (continuationRate > 0) signals.push({ type: "continuation" });

  const engagementScore = computeEngagementScore(messageId);
  if (engagementScore > 0.2) signals.push({ type: "engagement_positive" });
  else if (engagementScore < -0.2) signals.push({ type: "engagement_negative" });

  return { signals, continuationRate, engagementScore };
}

export function recomputeTrainingMessageScore(messageId: number): void {
  const { signals, continuationRate, engagementScore } = gatherExtendedSignals(messageId);
  const { qualityScore, confidence, signalCount } = computeMessageQualityScore(signals);
  upsertMessageScore(messageId, qualityScore, confidence, signalCount, continuationRate, engagementScore);
}

export function recomputeTrainingScoresBatch(messageIds: number[]): void {
  for (const id of messageIds) {
    recomputeTrainingMessageScore(id);
  }
}
