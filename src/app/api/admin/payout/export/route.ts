import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/adminAuth";
import {
  buildPayoutCsv,
  exportFilename,
  listApprovedWithdrawalsForMonth,
  parseYearMonth,
  toExportRow,
} from "@/lib/payoutExport";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  let year: number;
  let month: number;
  let monthPadded: string;

  try {
    ({ year, month, monthPadded } = parseYearMonth(
      searchParams.get("year"),
      searchParams.get("month")
    ));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const records = listApprovedWithdrawalsForMonth(year, monthPadded);
  const rows = records.map(toExportRow);
  const csv = buildPayoutCsv(rows);
  const filename = exportFilename(year, month);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Export-Count": String(rows.length),
    },
  });
}
