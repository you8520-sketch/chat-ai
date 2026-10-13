import { NextResponse } from "next/server";
import { answerTrpgGoalClaim, type TrpgGoalClaimDecision } from "@/lib/trpg/goalConfirm";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

function decisionFrom(value: unknown): TrpgGoalClaimDecision | null {
  return value === "confirm" || value === "decline" ? value : null;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { goalId?: unknown; claimedRound?: unknown; decision?: unknown };
    const decision = decisionFrom(body.decision);
    if (!decision) throw new Error("확인 또는 거절만 보낼 수 있습니다.");
    const { outcome, campaign } = answerTrpgGoalClaim(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      goalId: String(body.goalId ?? ""),
      claimedRound: typeof body.claimedRound === "number" ? body.claimedRound : Number.NaN,
      decision,
    });
    return NextResponse.json({ ok: true, outcome, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
