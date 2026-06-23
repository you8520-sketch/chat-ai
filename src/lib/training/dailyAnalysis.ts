import { selectAnalysisCandidates } from "./candidateSelection";
import { getAnalysisBatchSize } from "./config";
import { analyzeMessageTags } from "./tagAnalysis";
import {
  finishAnalysisRun,
  hasCurrentAnalysis,
  insertMessageTags,
  startAnalysisRun,
} from "./training-db";
import { recomputeTrainingScoresBatch } from "./trainingScoring";
import type { TrainingAnalysisRunResult } from "./types";

export async function runDailyTrainingAnalysis(
  batchSize = getAnalysisBatchSize()
): Promise<TrainingAnalysisRunResult> {
  const runId = startAnalysisRun("daily_tag");
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const candidates = selectAnalysisCandidates(batchSize);
    const messageIds: number[] = [];

    for (const candidate of candidates) {
      if (hasCurrentAnalysis(candidate.messageId, candidate.feedbackFingerprint)) {
        skipped++;
        continue;
      }

      try {
        const tags = await analyzeMessageTags(candidate);
        insertMessageTags(
          candidate.messageId,
          runId,
          tags,
          candidate.feedbackFingerprint
        );
        messageIds.push(candidate.messageId);
        processed++;
      } catch (e) {
        failed++;
        console.warn(`[training] tag analysis failed for message ${candidate.messageId}:`, e);
      }
    }

    if (messageIds.length > 0) {
      recomputeTrainingScoresBatch(messageIds);
    }

    finishAnalysisRun(runId, "completed", processed, skipped);
    return { runId, processed, skipped, failed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finishAnalysisRun(runId, "failed", processed, skipped, msg);
    throw e;
  }
}
