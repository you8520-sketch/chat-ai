export function isTrainingPipelineEnabled(): boolean {
  return process.env.ENABLE_TRAINING_PIPELINE === "1";
}

export function getAnalysisBatchSize(): number {
  const n = parseInt(process.env.TRAINING_ANALYSIS_BATCH_SIZE || "200", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 200;
}

export function getHighLikeThreshold(): number {
  const n = parseFloat(process.env.TRAINING_HIGH_LIKE_THRESHOLD || "0.4");
  return Number.isFinite(n) ? n : 0.4;
}

export function getHighDislikeThreshold(): number {
  const n = parseFloat(process.env.TRAINING_HIGH_DISLIKE_THRESHOLD || "-0.35");
  return Number.isFinite(n) ? n : -0.35;
}

export function getMinRegeneratesForProblematic(): number {
  const n = parseInt(process.env.TRAINING_MIN_REGENERATES || "2", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

export function isAiTagAnalysisEnabled(): boolean {
  return process.env.TRAINING_USE_AI_ANALYSIS === "1";
}

export function getTrainingExportDir(): string {
  return process.env.TRAINING_EXPORT_DIR || "data/training-exports";
}

export function getGoodExampleMinScore(): number {
  const n = parseFloat(process.env.TRAINING_GOOD_MIN_SCORE || "0.5");
  return Number.isFinite(n) ? n : 0.5;
}

export function getBadExampleMaxScore(): number {
  const n = parseFloat(process.env.TRAINING_BAD_MAX_SCORE || "-0.3");
  return Number.isFinite(n) ? n : -0.3;
}
