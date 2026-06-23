import { exportTrainingDataset } from "./datasetExport";
import { finishAnalysisRun, startAnalysisRun } from "./training-db";
import type { DatasetExportResult } from "./types";

export function runWeeklyTrainingExport(): DatasetExportResult {
  const runId = startAnalysisRun("weekly_export");
  try {
    const result = exportTrainingDataset(runId);
    finishAnalysisRun(runId, "completed", result.goodCount + result.badCount + result.pairCount, 0);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finishAnalysisRun(runId, "failed", 0, 0, msg);
    throw e;
  }
}
