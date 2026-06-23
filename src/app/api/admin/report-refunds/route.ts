import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import { listReportRefundsForAdmin } from "@/lib/refund";

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

  const rows = listReportRefundsForAdmin(filter);
  return NextResponse.json({ reports: rows });
}
