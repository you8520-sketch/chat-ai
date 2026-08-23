import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import {
  listAdminCommentReports,
  type AdminCommentReportStatus,
} from "@/lib/adminCommentReports";

function parseStatus(value: string | null): AdminCommentReportStatus {
  return value === "resolved" || value === "all" ? value : "pending";
}

export async function GET(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const status = parseStatus(new URL(req.url).searchParams.get("status"));
  return NextResponse.json({ comments: listAdminCommentReports(getDb(), status) });
}
