import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { listCharactersForModeration } from "@/lib/characterModerationAdmin";
import type { ModerationStatus } from "@/lib/characterVisibility";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get("status") ?? "pending";
  const filter: ModerationStatus | "all" =
    raw === "pending" || raw === "approved" || raw === "rejected" || raw === "all" ? raw : "pending";

  return NextResponse.json({ characters: listCharactersForModeration(getDb(), filter) });
}
