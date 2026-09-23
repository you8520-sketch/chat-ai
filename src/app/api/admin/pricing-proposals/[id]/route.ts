import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { buildMainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import { reviewMainRpPricingCandidateRecord } from "@/lib/mainRpPricingProposal";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "잘못된 proposal ID입니다." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    note?: unknown;
  };
  const action =
    body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : null;
  if (!action) {
    return NextResponse.json(
      { error: "action(approve|reject)이 필요합니다." },
      { status: 400 }
    );
  }

  const db = getDb();
  const currentProjection = buildMainRpPricingObservabilityProjection({ db });
  const result = reviewMainRpPricingCandidateRecord({
    db,
    id,
    adminUserId: admin.id,
    action,
    note: typeof body.note === "string" ? body.note : "",
    currentProjection,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    reviewState: result.record.reviewState,
    appliesPrice: false,
  });
}
