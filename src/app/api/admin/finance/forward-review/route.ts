import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { reviewForwardUsageSnapshot } from "@/lib/providerCostReconciliation";

export const runtime = "nodejs";

/** Archive only the displayed snapshot's ops warnings; underlying costs stay unresolved. */
export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (typeof body?.snapshotFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.snapshotFingerprint)) {
    return NextResponse.json({ error: "확인할 감사 자료가 필요합니다." }, { status: 400 });
  }
  try {
    const forwardOps = reviewForwardUsageSnapshot(getDb(), body.snapshotFingerprint, admin.id);
    return NextResponse.json({ forwardOps });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
