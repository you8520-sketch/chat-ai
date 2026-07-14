import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { getHomePopupNotice, saveHomePopupNotice } from "@/lib/homePopupNotice";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  return NextResponse.json({ notice: getHomePopupNotice(getDb()) });
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    title?: string;
    content?: string;
    backgroundColor?: string;
    imageUrl?: string;
    startsAt?: string | null;
    endsAt?: string | null;
  };

  const notice = saveHomePopupNotice(getDb(), body, admin.id);
  return NextResponse.json({ ok: true, notice });
}
