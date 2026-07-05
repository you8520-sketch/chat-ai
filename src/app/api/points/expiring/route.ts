import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getExpiringPointsWithinDays } from "@/lib/pointExpiry";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  return NextResponse.json(getExpiringPointsWithinDays(user.id, 3));
}
