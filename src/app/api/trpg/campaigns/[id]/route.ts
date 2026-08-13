import { NextResponse } from "next/server";
import { deleteTrpgCampaign, loadTrpgSnapshot, renameTrpgCampaign } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
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
    const body = (await req.json().catch(() => ({}))) as { title?: unknown };
    renameTrpgCampaign(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      title: String(body.title ?? ""),
    });
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
