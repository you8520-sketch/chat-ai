import { getDb } from "./db";
import { creditPointsWithIds, getPointBalance, ATTENDANCE_POINTS_VALID_MONTHS } from "./points";
import {
  ATTENDANCE_CYCLE_DAYS,
  ATTENDANCE_DAY7_BONUS,
  ATTENDANCE_DAY_REWARDS,
  ATTENDANCE_TIMEZONE,
  attendanceRewardForDay,
  DAILY_ATTENDANCE_REWARD,
  WEEKLY_ATTENDANCE_BONUS_REWARD,
} from "./attendanceConstants";

export {
  ATTENDANCE_CYCLE_DAYS,
  ATTENDANCE_DAY7_BONUS,
  ATTENDANCE_DAY_REWARDS,
  ATTENDANCE_TIMEZONE,
  attendanceRewardForDay,
  DAILY_ATTENDANCE_REWARD,
  WEEKLY_ATTENDANCE_BONUS_REWARD,
} from "./attendanceConstants";

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

/** KST 날짜의 요일 (0=일 … 6=토) — UTC 자정 날짜 문자열 기준 */
function weekdayOfDateString(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** 해당 날짜가 속한 주(월~일)의 월요일 YYYY-MM-DD */
export function getWeekMondayKst(dateString: string): string {
  const dow = weekdayOfDateString(dateString); // 0 Sun … 6 Sat
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  return addDaysToDateString(dateString, -daysFromMonday);
}

export function getWeekSundayKst(dateString: string): string {
  return addDaysToDateString(getWeekMondayKst(dateString), 6);
}

/** 이번 주(월~일) 출석 횟수 — 연속 여부와 무관 */
export function countCheckinsInWeek(userId: number, todayKst: string): number {
  const db = getDb();
  const monday = getWeekMondayKst(todayKst);
  const sunday = getWeekSundayKst(todayKst);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM attendance_checkins
       WHERE user_id = ?
         AND attendance_date >= ?
         AND attendance_date <= ?`
    )
    .get(userId, monday, sunday) as { cnt: number };
  return Math.max(0, Number(row?.cnt ?? 0));
}

export type AttendanceStatus = {
  checkedInToday: boolean;
  /** 오늘 받을(또는 받은) 총 보상 */
  reward: number;
  bonusReward: number;
  cycleDays: number;
  /** 이번 주 출석 횟수 (오늘 포함 시) */
  currentStreak: number;
  /** 다음에 받을 일차 (1~7) */
  nextClaimDay: number;
  todayKst: string;
  weekMondayKst: string;
  lastAttendanceDate: string | null;
  dayRewards: readonly number[];
  day7Bonus: number;
};

export function getAttendanceStatus(userId: number): AttendanceStatus {
  const db = getDb();
  const todayKst = getKstDateString();
  const weekMondayKst = getWeekMondayKst(todayKst);

  const lastRow = db
    .prepare(
      `SELECT attendance_date AS last_attendance_date
       FROM attendance_checkins
       WHERE user_id = ?
       ORDER BY attendance_date DESC
       LIMIT 1`
    )
    .get(userId) as { last_attendance_date: string | null } | undefined;

  const lastAttendanceDate = lastRow?.last_attendance_date ?? null;
  const checkedInToday = lastAttendanceDate === todayKst;
  const weekCount = countCheckinsInWeek(userId, todayKst);
  const currentStreak = Math.min(ATTENDANCE_CYCLE_DAYS, weekCount);
  const nextClaimDay = checkedInToday
    ? Math.max(1, currentStreak)
    : Math.min(currentStreak + 1, ATTENDANCE_CYCLE_DAYS);
  const { base, bonus, total } = attendanceRewardForDay(nextClaimDay);

  return {
    checkedInToday,
    reward: total,
    bonusReward: bonus,
    cycleDays: ATTENDANCE_CYCLE_DAYS,
    currentStreak,
    nextClaimDay,
    todayKst,
    weekMondayKst,
    lastAttendanceDate,
    dayRewards: ATTENDANCE_DAY_REWARDS,
    day7Bonus: ATTENDANCE_DAY7_BONUS,
  };
}

export type ClaimAttendanceResult =
  | {
      ok: true;
      alreadyClaimed: false;
      reward: number;
      baseReward: number;
      bonusReward: number;
      streak: number;
      cycleCompleted: boolean;
      balance: ReturnType<typeof getPointBalance>;
    }
  | {
      ok: true;
      alreadyClaimed: true;
      reward: 0;
      baseReward: number;
      bonusReward: number;
      streak: number;
      cycleCompleted: false;
      balance: ReturnType<typeof getPointBalance>;
    };

export function claimDailyAttendance(userId: number): ClaimAttendanceResult {
  const db = getDb();
  const todayKst = getKstDateString();

  return db.transaction(() => {
    const lastRow = db
      .prepare(
        `SELECT attendance_date AS last_attendance_date
         FROM attendance_checkins
         WHERE user_id = ?
         ORDER BY attendance_date DESC
         LIMIT 1`
      )
      .get(userId) as { last_attendance_date: string | null } | undefined;

    const last = lastRow?.last_attendance_date ?? null;
    const weekCountBefore = countCheckinsInWeek(userId, todayKst);

    if (last === todayKst) {
      const day = Math.max(1, Math.min(ATTENDANCE_CYCLE_DAYS, weekCountBefore));
      const { base, bonus } = attendanceRewardForDay(day);
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        baseReward: base,
        bonusReward: bonus,
        streak: weekCountBefore,
        cycleCompleted: false as const,
        balance: getPointBalance(userId),
      };
    }

    if (weekCountBefore >= ATTENDANCE_CYCLE_DAYS) {
      // 이번 주 7회 이미 수령 — 이론상 날짜당 1회라 도달하기 어렵지만 방어
      const { base, bonus } = attendanceRewardForDay(ATTENDANCE_CYCLE_DAYS);
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        baseReward: base,
        bonusReward: bonus,
        streak: weekCountBefore,
        cycleCompleted: false as const,
        balance: getPointBalance(userId),
      };
    }

    const claimDay = weekCountBefore + 1;
    const { base, bonus, total: reward } = attendanceRewardForDay(claimDay);
    const cycleCompleted = claimDay >= ATTENDANCE_CYCLE_DAYS;

    const inserted = db
      .prepare(
        "INSERT OR IGNORE INTO attendance_checkins (user_id, attendance_date, streak, reward_points) VALUES (?,?,?,?)"
      )
      .run(userId, todayKst, claimDay, reward);
    if (inserted.changes === 0) {
      const current = getAttendanceStatus(userId);
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        baseReward: current.reward - current.bonusReward,
        bonusReward: current.bonusReward,
        streak: current.currentStreak,
        cycleCompleted: false as const,
        balance: getPointBalance(userId),
      };
    }

    db.prepare("UPDATE users SET last_attendance_date = ?, attendance_streak = ? WHERE id = ?").run(
      todayKst,
      claimDay,
      userId
    );

    const reason = cycleCompleted
      ? `주간 출석 7일차 보상 (+${base}P + 보너스 ${bonus}P)`
      : `주간 출석 ${claimDay}일차 보상 (+${base}P)`;

    creditPointsWithIds(db, userId, reward, "FREE", reason, {
      months: ATTENDANCE_POINTS_VALID_MONTHS,
    });

    return {
      ok: true as const,
      alreadyClaimed: false as const,
      reward,
      baseReward: base,
      bonusReward: bonus,
      streak: claimDay,
      cycleCompleted,
      balance: getPointBalance(userId),
    };
  })();
}
