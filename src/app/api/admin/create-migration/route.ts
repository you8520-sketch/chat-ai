import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { listApplicationsForAdmin } from "@/lib/createMigrationEvent";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const filter =
    status === "pending" || status === "approved" || status === "rejected" || status === "all"
      ? status
      : "pending";

  const rows = listApplicationsForAdmin(getDb(), filter);
  return NextResponse.json({ applications: rows });
}
