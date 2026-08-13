import { NextResponse } from "next/server";
import { startTrpgCampaign } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { parseTrpgDcMode } from "@/lib/trpg/types";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    let dcMode: ReturnType<typeof parseTrpgDcMode> | undefined;
    try {
      const body = (await req.json()) as { dcMode?: unknown };
      if (body && typeof body === "object" && body.dcMode != null) {
        dcMode = parseTrpgDcMode(body.dcMode);
      }
    } catch {
      /* start still works with an empty body */
    }
    const campaign = await startTrpgCampaign(gate.db, { campaignId: id, userId: gate.user.id, dcMode });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
