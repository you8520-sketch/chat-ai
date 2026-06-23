import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  getLatestApplicationForUser,
  submitBetaFreePointApplication,
} from "@/lib/betaFreePointApplication";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const application = getLatestApplicationForUser(db, user.id);

  return NextResponse.json({ application });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const result = submitBetaFreePointApplication(getDb(), user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true, applicationId: result.applicationId });
}
