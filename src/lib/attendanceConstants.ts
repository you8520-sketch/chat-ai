/** 주간(월~일) 출석 일차별 보상 — 연속 여부와 무관, 이번 주 N번째 출석 = N일차 */
export const ATTENDANCE_DAY_REWARDS = [200, 200, 250, 250, 300, 300, 400] as const;
/** 7일차 추가 보너스 (기본 400 + 보너스 400) */
export const ATTENDANCE_DAY7_BONUS = 400;
export const ATTENDANCE_CYCLE_DAYS = 7;
export const ATTENDANCE_TIMEZONE = "Asia/Seoul";
export const ATTENDANCE_POINTS_VALID_MONTHS = 1;

/** @deprecated 일차별 보상 사용 — 하위 호환용 1일차 금액 */
export const DAILY_ATTENDANCE_REWARD = ATTENDANCE_DAY_REWARDS[0];
/** @deprecated 7일차 보너스만 — ATTENDANCE_DAY7_BONUS 사용 */
export const WEEKLY_ATTENDANCE_BONUS_REWARD = ATTENDANCE_DAY7_BONUS;

export function attendanceRewardForDay(day: number): {
  base: number;
  bonus: number;
  total: number;
} {
  const idx = Math.max(1, Math.min(ATTENDANCE_CYCLE_DAYS, day)) - 1;
  const base = ATTENDANCE_DAY_REWARDS[idx]!;
  const bonus = day >= ATTENDANCE_CYCLE_DAYS ? ATTENDANCE_DAY7_BONUS : 0;
  return { base, bonus, total: base + bonus };
}

export function formatAttendanceDayRewardLabel(day: number): string {
  const { base, bonus } = attendanceRewardForDay(day);
  if (bonus > 0) return `+${base.toLocaleString()}P + ${bonus.toLocaleString()}P`;
  return `+${base.toLocaleString()}P`;
}
