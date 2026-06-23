import { getDb } from "@/lib/db";
import type { TagScore, TrainingAnalysisRunResult } from "./types";

export function startAnalysisRun(runType: "daily_tag" | "weekly_export"): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO training_analysis_runs (run_type, status, started_at)
       VALUES (?, 'running', datetime('now'))`
    )
    .run(runType);
  return Number(result.lastInsertRowid);
}

export function finishAnalysisRun(
  runId: number,
  status: "completed" | "failed",
  processed: number,
  skipped: number,
  errorMessage = ""
): void {
  const db = getDb();
  db.prepare(
    `UPDATE training_analysis_runs
     SET status=?, messages_processed=?, messages_skipped=?, error_message=?, finished_at=datetime('now')
     WHERE id=?`
  ).run(status, processed, skipped, errorMessage, runId);
}

export function getLatestTagFingerprint(messageId: number, tag: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT feedback_fingerprint FROM training_message_tags
       WHERE message_id=? AND tag=?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(messageId, tag) as { feedback_fingerprint: string } | undefined;
  return row?.feedback_fingerprint ?? null;
}

export function hasCurrentAnalysis(
  messageId: number,
  feedbackFingerprint: string
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM training_message_tags
       WHERE message_id=? AND feedback_fingerprint=?
       LIMIT 1`
    )
    .get(messageId, feedbackFingerprint);
  return !!row;
}

export function insertMessageTags(
  messageId: number,
  runId: number,
  tags: TagScore[],
  feedbackFingerprint: string
): void {
  if (tags.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO training_message_tags
      (message_id, analysis_run_id, tag, score, label, source, feedback_fingerprint)
     VALUES (?,?,?,?,?,?,?)`
  );
  const tx = db.transaction(() => {
    for (const t of tags) {
      stmt.run(
        messageId,
        runId,
        t.tag,
        t.score,
        t.label,
        t.source,
        feedbackFingerprint
      );
    }
  });
  tx();
}

export function getTagsForMessage(messageId: number): TagScore[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT tag, score, label, source FROM training_message_tags
       WHERE message_id=?
       ORDER BY created_at DESC`
    )
    .all(messageId) as { tag: string; score: number; label: string; source: string }[];

  const seen = new Set<string>();
  const result: TagScore[] = [];
  for (const row of rows) {
    if (seen.has(row.tag)) continue;
    seen.add(row.tag);
    result.push({
      tag: row.tag as TagScore["tag"],
      score: row.score,
      label: row.label as TagScore["label"],
      source: row.source as TagScore["source"],
    });
  }
  return result;
}
