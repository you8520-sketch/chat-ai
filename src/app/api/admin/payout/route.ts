import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import {
  countAdminPayoutApplications,
  getPayoutAutomationStatus,
  listAdminPayoutApplications,
  parseAdminPayoutStatusFilter,
  previewApprovedPayoutTaxes,
} from "@/lib/adminPayout";
import { getDb } from "@/lib/db";
import { parseYearMonth } from "@/lib/payoutExport";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = parseAdminPayoutStatusFilter(url.searchParams.get("status"));
  const db = getDb();

  let taxPreview = null;
  const yearParam = url.searchParams.get("year");
  const monthParam = url.searchParams.get("month");
  if (yearParam || monthParam) {
    try {
      const { year, month } = parseYearMonth(yearParam, monthParam);
      taxPreview = previewApprovedPayoutTaxes(db, year, month);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  return NextResponse.json({
    applications: listAdminPayoutApplications(db, status),
    counts: countAdminPayoutApplications(db),
    automation: getPayoutAutomationStatus(),
    taxPreview,
  });
}
