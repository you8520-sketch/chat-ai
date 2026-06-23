import { getDb } from "@/lib/db";
import { PREFERENCE_EVENT } from "./events";
import { upsertMessageScore } from "./feedback-db";
import type { QualitySignal } from "./types";

export function computeMessageQualityScore(signals: QualitySignal[]): {
  qualityScore: number;
  confidence: number;
  signalCount: number;
} {
  let score = 0;
  let signalCount = 0;

  for (const s of signals) {
    signalCount++;
    switch (s.type) {
      case "feedback_like":
        score += 0.5;
        if (s.reasons?.length) score += s.reasons.length * 0.05;
        break;
      case "feedback_dislike":
        score -= 0.5;
        if (s.reasons?.length) score -= s.reasons.length * 0.05;
        break;
      case "bookmark":
        score += 0.3;
        break;
      case "regenerate":
        score -= 0.2;
        break;
      case "variant_switch":
        score -= 0.1;
        break;
      case "refund":
        score -= 0.5;
        break;
      case "continuation":
        score += 0.25;
        break;
      case "engagement_positive":
        score += 0.15;
        break;
      case "engagement_negative":
        score -= 0.15;
        break;
    }
  }

  const qualityScore = Math.max(-1, Math.min(1, score));
  const confidence = Math.min(1, signalCount * 0.2);
  return { qualityScore, confidence, signalCount };
}

export function recomputeMessageScore(messageId: number): void {
  const db = getDb();
  const signals: QualitySignal[] = [];

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

  const bookmark = db
    .prepare("SELECT 1 FROM bookmarks WHERE message_id=? LIMIT 1")
    .get(messageId);
  if (bookmark) signals.push({ type: "bookmark" });

  const events = db
    .prepare("SELECT event_type FROM preference_events WHERE message_id=?")
    .all(messageId) as { event_type: string }[];
  for (const ev of events) {
    if (ev.event_type === PREFERENCE_EVENT.REGENERATE) {
      signals.push({ type: "regenerate" });
    } else if (ev.event_type === PREFERENCE_EVENT.VARIANT_SWITCH) {
      signals.push({ type: "variant_switch" });
    }
  }

  const refunded = db
    .prepare("SELECT is_refunded FROM messages WHERE id=?")
    .get(messageId) as { is_refunded: number } | undefined;
  if (refunded?.is_refunded) signals.push({ type: "refund" });

  const { qualityScore, confidence, signalCount } = computeMessageQualityScore(signals);
  upsertMessageScore(messageId, qualityScore, confidence, signalCount);
}
