import { getDb } from "./db";
import { creditPointsWithIds, getPointBalance, ATTENDANCE_POINTS_VALID_MONTHS } from "./points";
import {
  ATTENDANCE_CYCLE_DAYS,
  ATTENDANCE_TIMEZONE,
  DAILY_ATTENDANCE_REWARD,
  WEEKLY_ATTENDANCE_BONUS_REWARD,
} from "./attendanceConstants";

export { ATTENDANCE_CYCLE_DAYS, ATTENDANCE_TIMEZONE, DAILY_ATTENDANCE_REWARD, WEEKLY_ATTENDANCE_BONUS_REWARD } from "./attendanceConstants";

/** KST 기준 YYYY-MM-DD (매일 0시 갱신) */
export function getKstDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export type AttendanceStatus = {
  checkedInToday: boolean;
  reward: number;
  bonusReward: number;
  cycleDays: number;
  currentStreak: number;
  nextClaimDay: number;
  todayKst: string;
  lastAttendanceDate: string | null;
};

export function getAttendanceStatus(userId: number): AttendanceStatus {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT attendance_date AS last_attendance_date, streak AS attendance_streak
       FROM attendance_checkins
       WHERE user_id = ?
       ORDER BY attendance_date DESC
       LIMIT 1`
    )
    .get(userId) as { last_attendance_date: string | null; attendance_streak: number | null } | undefined;

  const todayKst = getKstDateString();
  const lastAttendanceDate = row?.last_attendance_date ?? null;
  const checkedInToday = lastAttendanceDate === todayKst;
  const storedStreak = Math.max(0, Math.min(ATTENDANCE_CYCLE_DAYS, Number(row?.attendance_streak ?? 0)));
  const currentStreak = checkedInToday
    ? storedStreak
    : lastAttendanceDate === addDaysToDateString(todayKst, -1) && storedStreak < ATTENDANCE_CYCLE_DAYS
      ? storedStreak
      : 0;
  const nextClaimDay = Math.min(currentStreak + (checkedInToday ? 0 : 1), ATTENDANCE_CYCLE_DAYS);

  return {
    checkedInToday,
    reward: DAILY_ATTENDANCE_REWARD,
    bonusReward: WEEKLY_ATTENDANCE_BONUS_REWARD,
    cycleDays: ATTENDANCE_CYCLE_DAYS,
    currentStreak,
    nextClaimDay,
    todayKst,
    lastAttendanceDate,
  };
}

export type ClaimAttendanceResult =
  | { ok: true; alreadyClaimed: false; reward: number; baseReward: number; bonusReward: number; streak: number; cycleCompleted: boolean; balance: ReturnType<typeof getPointBalance> }
  | { ok: true; alreadyClaimed: true; reward: 0; baseReward: number; bonusReward: number; streak: number; cycleCompleted: false; balance: ReturnType<typeof getPointBalance> };

export function claimDailyAttendance(userId: number): ClaimAttendanceResult {
  const db = getDb();
  const todayKst = getKstDateString();

  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT attendance_date AS last_attendance_date, streak AS attendance_streak
         FROM attendance_checkins
         WHERE user_id = ?
         ORDER BY attendance_date DESC
         LIMIT 1`
      )
      .get(userId) as { last_attendance_date: string | null; attendance_streak: number | null } | undefined;

    const last = row?.last_attendance_date ?? null;
    const storedStreak = Math.max(0, Math.min(ATTENDANCE_CYCLE_DAYS, Number(row?.attendance_streak ?? 0)));
    if (last === todayKst) {
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        baseReward: DAILY_ATTENDANCE_REWARD,
        bonusReward: WEEKLY_ATTENDANCE_BONUS_REWARD,
        streak: storedStreak,
        cycleCompleted: false as const,
        balance: getPointBalance(userId),
      };
    }

    const continued = last === addDaysToDateString(todayKst, -1) && storedStreak < ATTENDANCE_CYCLE_DAYS;
    const nextStreak = continued ? storedStreak + 1 : 1;
    const cycleCompleted = nextStreak >= ATTENDANCE_CYCLE_DAYS;
    const bonus = cycleCompleted ? WEEKLY_ATTENDANCE_BONUS_REWARD : 0;
    const reward = DAILY_ATTENDANCE_REWARD + bonus;
    const inserted = db
      .prepare("INSERT OR IGNORE INTO attendance_checkins (user_id, attendance_date, streak, reward_points) VALUES (?,?,?,?)")
      .run(userId, todayKst, nextStreak, reward);
    if (inserted.changes === 0) {
      const current = getAttendanceStatus(userId);
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        baseReward: DAILY_ATTENDANCE_REWARD,
        bonusReward: WEEKLY_ATTENDANCE_BONUS_REWARD,
        streak: current.currentStreak,
        cycleCompleted: false as const,
        balance: getPointBalance(userId),
      };
    }
    db.prepare("UPDATE users SET last_attendance_date = ?, attendance_streak = ? WHERE id = ?").run(todayKst, nextStreak, userId);
    creditPointsWithIds(
      db,
      userId,
      reward,
      "FREE",
      cycleCompleted
        ? `7일 연속 출석 보상 (+${DAILY_ATTENDANCE_REWARD}P + 보너스 ${WEEKLY_ATTENDANCE_BONUS_REWARD}P)`
        : `일일 출석 보상 (+${DAILY_ATTENDANCE_REWARD}P)`,
      { months: ATTENDANCE_POINTS_VALID_MONTHS }
    );

    return {
      ok: true as const,
      alreadyClaimed: false as const,
      reward,
      baseReward: DAILY_ATTENDANCE_REWARD,
      bonusReward: bonus,
      streak: nextStreak,
      cycleCompleted,
      balance: getPointBalance(userId),
    };
  })();
}
