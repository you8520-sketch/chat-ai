import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { buildEffectiveRuntimeSettingsProjection } from "@/lib/adminEffectiveRuntimeSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  return NextResponse.json(buildEffectiveRuntimeSettingsProjection(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
