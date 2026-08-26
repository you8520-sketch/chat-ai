import { NextResponse } from "next/server";
import { deleteTrpgCampaign, loadTrpgSnapshot, renameTrpgCampaign, saveTrpgBillingMode, saveTrpgRelationshipBrief } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { parseTrpgBillingMode } from "@/lib/trpg/types";
import { loadTrpgCampaignSnapshotForGet } from "@/lib/trpg/snapshotGetTrace";
import {
  beginActiveCampaignGetRequest,
  collectSnapshotScaleCounts,
  endActiveCampaignGetRequest,
  isTrpgSnapshotDiagnosticsEnabled,
  logTrpgSnapshotDiag,
  newTrpgDiagRequestId,
  readProcessMemoryMb,
  roundDiagMs,
  TRPG_SNAPSHOT_SLOW_MS,
  type SnapshotProfileTimings,
  type SnapshotScaleCounts,
} from "@/lib/trpg/snapshotDiagnostics";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  if (!isTrpgSnapshotDiagnosticsEnabled()) {
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

  const requestId = newTrpgDiagRequestId();
  const requestStartedAt = new Date().toISOString();
  const routeT0 = performance.now();
  let campaignId: number | null = null;
  let status = 500;
  let authMs = 0;
  let snapshotMs = 0;
  let responseBuildMs = 0;
  let scale: SnapshotScaleCounts | null = null;
  let profile: SnapshotProfileTimings | null = null;

  const activeAfterStart = beginActiveCampaignGetRequest();
  logTrpgSnapshotDiag({
    event: "trpg_snapshot_start",
    requestId,
    campaignId,
    activeCampaignGetRequests: activeAfterStart,
    requestStartedAt,
    timestamp: requestStartedAt,
  });

  try {
    const tAuth0 = performance.now();
    const gate = await requireTrpgApi();
    authMs = roundDiagMs(performance.now() - tAuth0);
    if ("error" in gate) {
      const authError = gate.error;
      if (!authError) throw new Error("TRPG auth gate returned error without response");
      status = authError.status;
      return authError;
    }

    campaignId = campaignIdFromParams((await ctx.params).id);
    const tSnap0 = performance.now();
    const loaded = loadTrpgCampaignSnapshotForGet({
      db: gate.db,
      userId: gate.user.id,
      campaignId,
      requestId,
    });
    snapshotMs = roundDiagMs(performance.now() - tSnap0);
    profile = loaded.profile;

    if (!loaded.campaign) {
      status = 404;
      const tResp0 = performance.now();
      const response = NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      responseBuildMs = roundDiagMs(performance.now() - tResp0);
      return response;
    }

    scale = collectSnapshotScaleCounts(loaded.campaign);
    status = 200;
    const tResp0 = performance.now();
    const response = NextResponse.json({ campaign: loaded.campaign });
    responseBuildMs = roundDiagMs(performance.now() - tResp0);
    return response;
  } catch (e) {
    const tResp0 = performance.now();
    const response = trpgFail(e);
    status = response.status;
    responseBuildMs = roundDiagMs(performance.now() - tResp0);
    return response;
  } finally {
    const activeCampaignGetRequestsAfterRelease = endActiveCampaignGetRequest();
    const totalRouteMs = roundDiagMs(performance.now() - routeT0);
    const endLine: Record<string, unknown> = {
      event: "trpg_snapshot_end",
      requestId,
      campaignId,
      status,
      activeCampaignGetRequestsAfterRelease,
      authMs,
      snapshotMs,
      responseBuildMs,
      totalRouteMs,
      roundNumber: scale?.roundNumber ?? null,
      roundCount: scale?.roundCount ?? null,
      participantCount: scale?.participantCount ?? null,
      logActionCount: scale?.logActionCount ?? null,
      logRollCount: scale?.logRollCount ?? null,
      totalNarrations: scale?.totalNarrations ?? null,
      estimatedTextChars: scale?.estimatedTextChars ?? null,
    };
    if (totalRouteMs >= TRPG_SNAPSHOT_SLOW_MS) {
      Object.assign(endLine, readProcessMemoryMb());
    }
    logTrpgSnapshotDiag(endLine);
    if (profile) {
      logTrpgSnapshotDiag({
        event: "trpg_snapshot_profile",
        requestId,
        campaignId,
        roundCount: scale?.roundCount ?? null,
        baseMs: profile.baseMs ?? null,
        participantsMs: profile.participantsMs ?? null,
        sheetsMs: profile.sheetsMs ?? null,
        currentRoundMs: profile.currentRoundMs ?? null,
        logMs: profile.logMs ?? null,
        contextsMs: profile.contextsMs ?? null,
        effectsMs: profile.effectsMs ?? null,
        safeRestMs: profile.safeRestMs ?? null,
        totalSnapshotMs: profile.totalSnapshotMs ?? snapshotMs,
      });
    }
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
