import {
  ATTENDANCE_CYCLE_DAYS,
  attendanceRewardForDay,
} from "@/lib/attendanceConstants";
import { MIN_POINT_GIFT_AMOUNT } from "@/lib/pointGiftsShared";

/** Presentation-only view models for /points. No fetch, storage, or ledger writes. */

export type AttendanceCellState = "done" | "today" | "upcoming";

export type AttendanceCell = {
  day: number;
  reward: number;
  state: AttendanceCellState;
  /** The cell for the claim made (or about to be made) today. */
  isToday: boolean;
};

export type AttendanceWeekView = {
  doneCount: number;
  /** 1..7 — same rule as getAttendanceStatus().nextClaimDay on the server. */
  todayDay: number;
  todayReward: number;
  cells: AttendanceCell[];
};

export function attendanceWeekView(input: {
  streak: number;
  checkedIn: boolean;
  loggedIn: boolean;
}): AttendanceWeekView {
  const doneCount = Math.max(0, Math.min(ATTENDANCE_CYCLE_DAYS, Math.trunc(input.streak)));
  const todayDay = input.checkedIn
    ? Math.max(1, doneCount)
    : Math.min(doneCount + 1, ATTENDANCE_CYCLE_DAYS);
  const cells = Array.from({ length: ATTENDANCE_CYCLE_DAYS }, (_, i): AttendanceCell => {
    const day = i + 1;
    const done = day <= doneCount;
    const isToday = input.loggedIn && day === todayDay;
    return {
      day,
      reward: attendanceRewardForDay(day).total,
      state: done ? "done" : isToday ? "today" : "upcoming",
      isToday,
    };
  });
  return { doneCount, todayDay, todayReward: attendanceRewardForDay(todayDay).total, cells };
}

export type GiftInputProblem =
  | { code: "NICKNAME_REQUIRED"; message: string }
  | { code: "BELOW_MINIMUM"; message: string }
  | { code: "OVER_GIFTABLE"; message: string };

/** Client preflight only; the server remains the authority for every gift. */
export function giftInputProblem(input: {
  nickname: string;
  amount: number;
  giftableTotal: number;
}): GiftInputProblem | null {
  if (!input.nickname.trim()) {
    return { code: "NICKNAME_REQUIRED", message: "받는 사람 닉네임을 입력해 주세요." };
  }
  if (!Number.isFinite(input.amount) || input.amount < MIN_POINT_GIFT_AMOUNT) {
    return { code: "BELOW_MINIMUM", message: `최소 선물 금액은 ${MIN_POINT_GIFT_AMOUNT}P입니다.` };
  }
  if (input.amount > input.giftableTotal) {
    return {
      code: "OVER_GIFTABLE",
      message: "선물 가능한 포인트가 부족합니다. 출석 포인트는 선물할 수 없어요.",
    };
  }
  return null;
}
