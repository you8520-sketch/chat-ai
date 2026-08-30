/** Production memory policy id — compact telemetry only, never user prose. */
export const MEMORY_POLICY_ID = "summary5_raw4" as const;

/** Complete playable RP turns per automatic rolling-summary seal. */
export const ROLLING_SUMMARY_INTERVAL = 5;

/** Latest complete playable exchanges kept as provider RAW (opening/bridge excluded). */
export const RAW_HISTORY_COMPLETE_EXCHANGES = 4;

export const ROLLING_SUMMARY_TARGET_CHARS = 450;
export const ROLLING_SUMMARY_MAX_CHARS = 600;
/** 유효 기록·절단 시 하한(짧은 요약 허용, 패딩 강제 없음) */
export const ROLLING_SUMMARY_MIN_CHARS = 80;

/** User-edited / manual memory record clamp cap. */
export const MEMORY_RECORD_MAX_CHARS = 800;

/** 로어북 전체 압축 시 설정 상한 대비 목표 하한 비율 (과도한 축소 방지) */
export const LOREBOOK_COMPACT_FILL_RATIO = 0.9;

/** 아카이브 키워드 매칭 — 이 점수 이상이면 주입 */
export const ARCHIVE_RELEVANCE_THRESHOLD = 2;

export function newAutomaticBatchEnd(turnStart: number): number {
  return turnStart + ROLLING_SUMMARY_INTERVAL - 1;
}

export function targetSummarizedThrough(completedPlayableTurns: number): number {
  const n = Math.max(0, Math.floor(completedPlayableTurns));
  return Math.floor(n / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
}

export function resolveSummaryLogLabel(): string {
  return `${ROLLING_SUMMARY_INTERVAL}턴 기억 기록`;
}
