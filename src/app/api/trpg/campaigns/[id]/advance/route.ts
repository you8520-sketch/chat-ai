import { NextResponse } from "next/server";
import { advanceTrpgCampaign } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import {
  createAdvanceDiagState,
  isTrpgSnapshotDiagnosticsEnabled,
  logTrpgSnapshotDiag,
  newTrpgDiagRequestId,
  roundDiagMs,
  runWithAdvanceDiag,
} from "@/lib/trpg/snapshotDiagnostics";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const diagOn = isTrpgSnapshotDiagnosticsEnabled();
  const requestId = diagOn ? newTrpgDiagRequestId() : "";
  const t0 = diagOn ? performance.now() : 0;
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  const advanceMeta = diagOn ? createAdvanceDiagState() : null;
  let campaignId = 0;
  let after: {
    workTypeAfter?: string;
    phaseAfter?: string;
    botGenerationInFlight?: boolean;
    gmGenerationInFlight?: boolean;
  } = {};
  try {
    campaignId = campaignIdFromParams((await ctx.params).id);
    if (diagOn) {
      logTrpgSnapshotDiag({
        event: "trpg_advance_start",
        requestId,
        campaignId,
        timestamp: new Date().toISOString(),
      });
    }
    const campaign = await runWithAdvanceDiag(advanceMeta, () =>
      advanceTrpgCampaign(gate.db, { campaignId, userId: gate.user.id })
    );
    after = {
      workTypeAfter: campaign.workType,
      phaseAfter: campaign.round.phase,
      botGenerationInFlight: campaign.botGenerationInFlight,
      gmGenerationInFlight: campaign.gmGenerationInFlight,
    };
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  } finally {
    if (diagOn) {
      logTrpgSnapshotDiag({
        event: "trpg_advance_end",
        requestId,
        campaignId,
        totalMs: roundDiagMs(performance.now() - t0),
        workTypeBefore: advanceMeta?.workTypeBefore ?? null,
        workTypeAfter: after.workTypeAfter ?? null,
        phaseBefore: advanceMeta?.phaseBefore ?? null,
        phaseAfter: after.phaseAfter ?? null,
        botGenerationInFlight: after.botGenerationInFlight ?? advanceMeta?.botGenerationInFlight ?? null,
        gmGenerationInFlight: after.gmGenerationInFlight ?? advanceMeta?.gmGenerationInFlight ?? null,
      });
    }
  }
}
