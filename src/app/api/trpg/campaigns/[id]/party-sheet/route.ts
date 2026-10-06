import { NextResponse } from "next/server";
import { loadTrpgPartySheetComponent } from "@/lib/trpg/partySheetComponent";
import { parseOptionalId } from "@/lib/trpg/requestIds";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

/** Read-only creator sheet presentation for one AI participant. Loaded once per participant, never polled. */
export async function GET(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const participantId = parseOptionalId(new URL(req.url).searchParams.get("participantId"));
    if (!participantId) return NextResponse.json({ error: "잘못된 참가자입니다." }, { status: 400 });
    const component = loadTrpgPartySheetComponent(gate.db, id, gate.user.id, participantId);
    return NextResponse.json({ component }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return trpgFail(e);
  }
}
