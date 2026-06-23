import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { claimDailyAttendance, DAILY_ATTENDANCE_REWARD, getAttendanceStatus } from "@/lib/attendance";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const status = getAttendanceStatus(user.id);
  return NextResponse.json({
    checkedInToday: status.checkedInToday,
    reward: DAILY_ATTENDANCE_REWARD,
    todayKst: status.todayKst,
  });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const result = claimDailyAttendance(user.id);
  return NextResponse.json({
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    reward: result.reward,
    points: result.balance.total,
    paidPoints: result.balance.paid,
    freePoints: result.balance.free,
  });
}
