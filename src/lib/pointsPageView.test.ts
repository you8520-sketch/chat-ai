import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import {
  claimDailyAttendance,
  getAttendanceStatus,
  getKstDateString,
  getWeekMondayKst,
} from "@/lib/attendance";
import { ATTENDANCE_DAY_REWARDS } from "@/lib/attendanceConstants";
import { MIN_POINT_GIFT_AMOUNT } from "@/lib/pointGiftsShared";
import { attendanceWeekView, giftInputProblem } from "@/lib/pointsPageView";

function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function newUser(label: string): number {
  const db = getDb();
  return Number(
    db
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`${label}@pointsview.test`, label, "x").lastInsertRowid,
  );
}

/** Sunday 12:00 KST of the week 2026-07-06..07-12 — every weekly count 0..7 is reachable. */
const FAKE_SUNDAY_UTC = Date.UTC(2026, 6, 12, 3, 0, 0);

function withFakeNow<T>(fn: () => T): T {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) super(FAKE_SUNDAY_UTC);
      else super(args[0] as string | number | Date);
    }
    static override now() {
      return FAKE_SUNDAY_UTC;
    }
  }
  globalThis.Date = FakeDate as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function seedWeek(userId: number, count: number, includeToday: boolean) {
  const db = getDb();
  const today = getKstDateString(new Date(FAKE_SUNDAY_UTC));
  const monday = getWeekMondayKst(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const others = week.filter((d) => d !== today);
  const dates = includeToday ? [today, ...others.slice(0, Math.max(0, count - 1))] : others.slice(0, count);
  db.prepare("DELETE FROM attendance_checkins WHERE user_id=?").run(userId);
  const insert = db.prepare("INSERT INTO attendance_checkins (user_id, attendance_date, streak, reward_points) VALUES (?,?,?,0)");
  dates.forEach((date, i) => insert.run(userId, date, i + 1));
}

describe("attendanceWeekView (client view model)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  it("matches the server's weekly count, today state and next reward for every pending/done combination", () => {
    const userId = newUser("parity");
    for (let count = 0; count <= 7; count++) {
      for (const checkedToday of [false, true]) {
        if (checkedToday && count === 0) continue;
        if (!checkedToday && count === 7) continue;
        seedWeek(userId, count, checkedToday);
        const server = withFakeNow(() => getAttendanceStatus(userId));
        const view = attendanceWeekView({
          streak: server.currentStreak,
          checkedIn: server.checkedInToday,
          loggedIn: true,
        });
        const label = `count=${count} checkedToday=${checkedToday}`;
        assert.equal(server.checkedInToday, checkedToday, label);
        assert.equal(view.doneCount, count, label);
        assert.equal(view.todayDay, server.nextClaimDay, label);
        assert.equal(view.todayReward, server.reward, label);
      }
    }
  });

  it("marks done cells, the single today cell and upcoming cells with the 250..600 schedule", () => {
    const pending = attendanceWeekView({ streak: 3, checkedIn: false, loggedIn: true });
    assert.deepEqual(
      pending.cells.map((c) => c.state),
      ["done", "done", "done", "today", "upcoming", "upcoming", "upcoming"],
    );
    assert.deepEqual(
      pending.cells.map((c) => c.reward),
      [...ATTENDANCE_DAY_REWARDS],
    );
    assert.equal(pending.cells.filter((c) => c.isToday).length, 1);
    assert.equal(pending.todayReward, 400);

    const done = attendanceWeekView({ streak: 4, checkedIn: true, loggedIn: true });
    assert.deepEqual(
      done.cells.map((c) => c.state),
      ["done", "done", "done", "done", "upcoming", "upcoming", "upcoming"],
    );
    assert.equal(done.cells[3]!.isToday, true);

    const loggedOut = attendanceWeekView({ streak: 0, checkedIn: false, loggedIn: false });
    assert.equal(loggedOut.cells.some((c) => c.isToday), false);
  });

  it("still grants exactly once per KST day and keeps the weekly-count reward", () => {
    const userId = newUser("claim");
    seedWeek(userId, 2, false);
    const first = withFakeNow(() => claimDailyAttendance(userId));
    const second = withFakeNow(() => claimDailyAttendance(userId));
    assert.equal(first.alreadyClaimed, false);
    assert.equal(first.reward, ATTENDANCE_DAY_REWARDS[2]);
    assert.equal(second.alreadyClaimed, true);
    assert.equal(second.reward, 0);
    const logs = getDb()
      .prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=? AND reason LIKE '주간 출석%'")
      .get(userId) as { c: number };
    assert.equal(logs.c, 1);
  });
});

describe("giftInputProblem (client preflight)", () => {
  it("requires a nickname, the minimum amount, and stays within giftable points", () => {
    assert.equal(giftInputProblem({ nickname: "  ", amount: 100, giftableTotal: 500 })?.code, "NICKNAME_REQUIRED");
    assert.equal(
      giftInputProblem({ nickname: "a", amount: MIN_POINT_GIFT_AMOUNT - 1, giftableTotal: 500 })?.code,
      "BELOW_MINIMUM",
    );
    assert.equal(giftInputProblem({ nickname: "a", amount: Number.NaN, giftableTotal: 500 })?.code, "BELOW_MINIMUM");
    assert.equal(giftInputProblem({ nickname: "a", amount: 501, giftableTotal: 500 })?.code, "OVER_GIFTABLE");
    assert.equal(giftInputProblem({ nickname: "a", amount: MIN_POINT_GIFT_AMOUNT, giftableTotal: 500 }), null);
    assert.equal(giftInputProblem({ nickname: "a", amount: 500, giftableTotal: 500 }), null);
  });
});
