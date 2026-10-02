import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENDANCE_DAY7_BONUS,
  ATTENDANCE_DAY_REWARDS,
  attendanceRewardForDay,
  formatAttendanceDayRewardLabel,
} from "@/lib/attendanceConstants";
import { getWeekMondayKst, getWeekSundayKst } from "@/lib/attendance";

describe("attendanceRewardForDay", () => {
  it("uses 250 300 350 400 450 500 600 schedule", () => {
    assert.deepEqual([...ATTENDANCE_DAY_REWARDS], [250, 300, 350, 400, 450, 500, 600]);
    assert.equal(ATTENDANCE_DAY7_BONUS, 0);
    for (const [index, expected] of ATTENDANCE_DAY_REWARDS.entries()) {
      assert.deepEqual(attendanceRewardForDay(index + 1), { base: expected, bonus: 0, total: expected });
      assert.equal(formatAttendanceDayRewardLabel(index + 1), `+${expected}P`);
    }
    assert.deepEqual(attendanceRewardForDay(1), { base: 250, bonus: 0, total: 250 });
    assert.deepEqual(attendanceRewardForDay(3), { base: 350, bonus: 0, total: 350 });
    assert.deepEqual(attendanceRewardForDay(7), { base: 600, bonus: 0, total: 600 });
    assert.equal(formatAttendanceDayRewardLabel(7), "+600P");
  });
});

describe("getWeekMondayKst", () => {
  it("starts the week on Monday (KST calendar date)", () => {
    // 2026-07-10 is Friday
    assert.equal(getWeekMondayKst("2026-07-10"), "2026-07-06");
    assert.equal(getWeekSundayKst("2026-07-10"), "2026-07-12");
    // Sunday belongs to the week that started the previous Monday
    assert.equal(getWeekMondayKst("2026-07-12"), "2026-07-06");
    // Next Monday starts a new week
    assert.equal(getWeekMondayKst("2026-07-13"), "2026-07-13");
  });
});
