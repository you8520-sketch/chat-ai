import { NextResponse } from "next/server";
import { deleteTrpgCampaign, loadTrpgSnapshot, renameTrpgCampaign, saveTrpgBillingMode, saveTrpgRelationshipBrief } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { parseTrpgBillingMode } from "@/lib/trpg/types";
import { executeTrpgCampaignSnapshotGet } from "@/lib/trpg/snapshotGetTrace";
import { isTrpgSnapshotDiagnosticsEnabled } from "@/lib/trpg/snapshotDiagnostics";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const diagOn = isTrpgSnapshotDiagnosticsEnabled();
  const tAuth0 = diagOn ? performance.now() : 0;
  const gate = await requireTrpgApi();
  const authMs = diagOn ? Math.round((performance.now() - tAuth0) * 10) / 10 : 0;
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const { campaign } = executeTrpgCampaignSnapshotGet({
      db: gate.db,
      userId: gate.user.id,
      campaignId: id,
      authMs,
    });
    if (!campaign) return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (e) {
    return trpgFail(e);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as {
      title?: unknown;
      relationshipBrief?: unknown;
      billingMode?: unknown;
    };
    const billingMode = parseTrpgBillingMode(body.billingMode);
    if (billingMode) {
      saveTrpgBillingMode(gate.db, {
        campaignId: id,
        userId: gate.user.id,
        billingMode,
      });
    }
    if (typeof body.relationshipBrief === "string") {
      saveTrpgRelationshipBrief(gate.db, {
        campaignId: id,
        userId: gate.user.id,
        brief: body.relationshipBrief,
      });
    }
    if (body.title != null) {
      renameTrpgCampaign(gate.db, {
        campaignId: id,
        userId: gate.user.id,
        title: String(body.title ?? ""),
      });
    }
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    deleteTrpgCampaign(gate.db, { campaignId: id, userId: gate.user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return trpgFail(e);
  }
}
