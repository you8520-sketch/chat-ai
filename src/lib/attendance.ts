import { getDb } from "./db";
import { creditPoints, getPointBalance } from "./points";
import { ATTENDANCE_TIMEZONE, DAILY_ATTENDANCE_REWARD } from "./attendanceConstants";

export { ATTENDANCE_TIMEZONE, DAILY_ATTENDANCE_REWARD } from "./attendanceConstants";

/** KST 기준 YYYY-MM-DD (매일 0시 갱신) */
export function getKstDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export type AttendanceStatus = {
  checkedInToday: boolean;
  reward: number;
  todayKst: string;
  lastAttendanceDate: string | null;
};

export function getAttendanceStatus(userId: number): AttendanceStatus {
  const db = getDb();
  const row = db
    .prepare("SELECT last_attendance_date FROM users WHERE id = ?")
    .get(userId) as { last_attendance_date: string | null } | undefined;

  const todayKst = getKstDateString();
  const lastAttendanceDate = row?.last_attendance_date ?? null;

  return {
    checkedInToday: lastAttendanceDate === todayKst,
    reward: DAILY_ATTENDANCE_REWARD,
    todayKst,
    lastAttendanceDate,
  };
}

export type ClaimAttendanceResult =
  | { ok: true; alreadyClaimed: false; reward: number; balance: ReturnType<typeof getPointBalance> }
  | { ok: true; alreadyClaimed: true; reward: 0; balance: ReturnType<typeof getPointBalance> };

export function claimDailyAttendance(userId: number): ClaimAttendanceResult {
  const db = getDb();
  const todayKst = getKstDateString();

  return db.transaction(() => {
    const row = db
      .prepare("SELECT last_attendance_date FROM users WHERE id = ?")
      .get(userId) as { last_attendance_date: string | null } | undefined;

    const last = row?.last_attendance_date ?? null;
    if (last === todayKst) {
      return {
        ok: true as const,
        alreadyClaimed: true as const,
        reward: 0 as const,
        balance: getPointBalance(userId),
      };
    }

    db.prepare("UPDATE users SET last_attendance_date = ? WHERE id = ?").run(todayKst, userId);
    creditPoints(userId, DAILY_ATTENDANCE_REWARD, "FREE", `일일 출석 보상 (+${DAILY_ATTENDANCE_REWARD}P)`);

    return {
      ok: true as const,
      alreadyClaimed: false as const,
      reward: DAILY_ATTENDANCE_REWARD as number,
      balance: getPointBalance(userId),
    };
  })();
}
