import { NextResponse } from "next/server";
import { loadTrpgSnapshot } from "@/lib/trpg/engine";
import { postTrpgPartyChat } from "@/lib/trpg/partyChat";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { body?: unknown };
    postTrpgPartyChat(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      body: String(body.body ?? ""),
    });
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
