import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  buildAdminFinanceSummary,
  currentKstMonthKey,
  saveDailyFinanceSnapshot,
  saveFinanceAdjustments,
} from "@/lib/adminFinance";
import {
  RECONCILIATION_DIAGNOSE_VALUE,
  assertReconciliationDiagnosisSafePayload,
  diagnoseProviderReconciliationLinkage,
} from "@/lib/adminFinanceReconciliationDiagnose";
import {
  RECONCILIATION_REMOTE_COMPARE_VALUE,
  compareProviderReconciliationRemote,
} from "@/lib/adminFinanceReconciliationRemoteCompare";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || currentKstMonthKey();
  const diagnose = url.searchParams.get("diagnose")?.trim() ?? "";
  try {
    const summary = buildAdminFinanceSummary(getDb(), month);
    if (!diagnose) {
      return NextResponse.json({ summary });
    }
    if (diagnose === RECONCILIATION_REMOTE_COMPARE_VALUE) {
      const reconciliationRemoteCompare = await compareProviderReconciliationRemote(
        getDb(),
        month
      );
      assertReconciliationDiagnosisSafePayload(reconciliationRemoteCompare);
      return NextResponse.json({ summary, reconciliationRemoteCompare });
    }
    if (diagnose !== RECONCILIATION_DIAGNOSE_VALUE) {
      return NextResponse.json({ error: "지원하지 않는 진단입니다." }, { status: 400 });
    }
    const reconciliationDiagnosis = diagnoseProviderReconciliationLinkage(getDb(), month);
    assertReconciliationDiagnosisSafePayload(reconciliationDiagnosis);
    return NextResponse.json({ summary, reconciliationDiagnosis });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "운영비를 불러오지 못했습니다." },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const monthKey = String(body.monthKey || currentKstMonthKey());
  try {
    saveFinanceAdjustments(getDb(), {
      monthKey,
      railwayUsageKrw: Number(body.railwayUsageKrw),
      railwayTaxKrw: Number(body.railwayTaxKrw),
      paymentGatewayFeesKrw: Number(body.paymentGatewayFeesKrw),
      creatorTransferFeesKrw: Number(body.creatorTransferFeesKrw),
      creatorExtraIncentivesKrw: Number(body.creatorExtraIncentivesKrw),
      otherCostsKrw: Number(body.otherCostsKrw),
      providerTaxRate: Number(body.providerTaxRate),
      note: String(body.note ?? ""),
    });
    const summary =
      monthKey === currentKstMonthKey()
        ? saveDailyFinanceSnapshot(getDb())
        : buildAdminFinanceSummary(getDb(), monthKey);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "운영비 설정을 저장하지 못했습니다." },
      { status: 400 }
    );
  }
}
