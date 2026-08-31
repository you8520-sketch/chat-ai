import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import {
  AdminBlueprintWarmupInputError,
  parseAdminBlueprintWarmupWorldId,
  warmWorldBlueprintForAdmin,
} from "@/lib/trpg/blueprintWarmupForAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  try {
    const worldId = parseAdminBlueprintWarmupWorldId(body);
    const result = await warmWorldBlueprintForAdmin(getDb(), worldId);
    const status = result.ok ? 200 : 502;
    return NextResponse.json(result, {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AdminBlueprintWarmupInputError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    throw error;
  }
}
