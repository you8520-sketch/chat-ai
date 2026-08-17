import { NextResponse } from "next/server";
import { requestTrpgReplySuggestions } from "@/lib/trpg/replySuggestions";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const result = await requestTrpgReplySuggestions(gate.db, {
      campaignId: id,
      userId: gate.user.id,
    });
    return NextResponse.json({ ok: true, suggestions: result.suggestions });
  } catch (e) {
    return trpgFail(e);
  }
}
