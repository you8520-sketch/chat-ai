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
  it("uses 200 200 250 250 300 300 400+400 schedule", () => {
    assert.deepEqual([...ATTENDANCE_DAY_REWARDS], [200, 200, 250, 250, 300, 300, 400]);
    assert.equal(ATTENDANCE_DAY7_BONUS, 400);
    assert.deepEqual(attendanceRewardForDay(1), { base: 200, bonus: 0, total: 200 });
    assert.deepEqual(attendanceRewardForDay(3), { base: 250, bonus: 0, total: 250 });
    assert.deepEqual(attendanceRewardForDay(7), { base: 400, bonus: 400, total: 800 });
    assert.equal(formatAttendanceDayRewardLabel(7), "+400P + 400P");
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
