import type { MemoryTier } from "./memory-types";

export const COMPRESSION_TRIGGER = 20;
export const COMPRESSION_MAX_OUTPUT_TOKENS = 400;

/** Legacy Phase-1 automatic batch span (6 playable turns). */
export const LEGACY_ROLLING_SUMMARY_INTERVAL = 6;
/** Phase-2 automatic batch span (5 playable turns). */
export const NEW_ROLLING_SUMMARY_INTERVAL = 5;

/** Legacy NULL turn_end rows span six turns: end = start + 5. */
export const LEGACY_NULL_TURN_END_OFFSET = 5;

export const LEGACY_SUMMARY_TARGET_CHARS = 540;
export const LEGACY_SUMMARY_MAX_CHARS = 800;
export const NEW_SUMMARY_TARGET_CHARS = 450;
export const NEW_SUMMARY_MAX_CHARS = 600;

/** User-edited / manual memory record clamp cap (unchanged across Phase1/2). */
export const MEMORY_RECORD_MAX_CHARS = 800;

/** @deprecated use resolveSummaryTargetChars() for automatic rolling summary only */
export const ROLLING_SUMMARY_TARGET_CHARS = NEW_SUMMARY_TARGET_CHARS;
/** 유효 기록·절단 시 하한(짧은 요약 허용, 패딩 강제 없음) */
export const ROLLING_SUMMARY_MIN_CHARS = 80;
/** @deprecated use resolveSummaryMaxChars() for automatic rolling summary only */
export const ROLLING_SUMMARY_MAX_CHARS = NEW_SUMMARY_MAX_CHARS;

/** 로어북 전체 압축 시 설정 상한 대비 목표 하한 비율 (과도한 축소 방지) */
export const LOREBOOK_COMPACT_FILL_RATIO = 0.9;

export const MEMORY_BUDGET: Record<
  MemoryTier,
  { total: number; pinned: number; recent: number; archive: number }
> = {
  free: { total: 2000, pinned: 600, recent: 1000, archive: 400 },
  basic: { total: 5000, pinned: 1500, recent: 3500, archive: 0 },
  pro: { total: 10000, pinned: 2000, recent: 8000, archive: 0 },
};

/** 아카이브 키워드 매칭 — 이 점수 이상이면 주입 */
export const ARCHIVE_RELEVANCE_THRESHOLD = 2;
