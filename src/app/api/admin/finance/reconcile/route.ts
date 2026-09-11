import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { currentKstMonthKey, monthRangeSql } from "@/lib/adminFinance";
import { reconcileCheaperInferenceUsage } from "@/lib/providerCostReconciliation";

export const runtime = "nodejs";

/** Manual CheaperInference usage reconciliation (same owner as the scheduler). */
export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const month = String(body.monthKey || currentKstMonthKey());
  try {
    const range = monthRangeSql(month);
    const reconciliation = await reconcileCheaperInferenceUsage({
      windowStart: range.start,
      windowEnd: range.end,
    });
    return NextResponse.json({ ok: true, reconciliation });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "동기화하지 못했습니다." },
      { status: 400 }
    );
  }
}
