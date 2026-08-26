import type Database from "better-sqlite3";
import { loadTrpgSnapshot } from "./engineSnapshot";
import type { TrpgCampaignSnapshot } from "./snapshot";
import {
  beginActiveSnapshotRequest,
  collectSnapshotScaleCounts,
  endActiveSnapshotRequest,
  isTrpgSnapshotDiagnosticsEnabled,
  logTrpgSnapshotDiag,
  newTrpgDiagRequestId,
  readProcessMemoryMb,
  roundDiagMs,
  runWithSnapshotProfile,
  TRPG_SNAPSHOT_SLOW_MS,
  type SnapshotProfileTimings,
  type SnapshotScaleCounts,
} from "./snapshotDiagnostics";

export type TrpgSnapshotGetResult = {
  campaign: TrpgCampaignSnapshot | null;
};

export function executeTrpgCampaignSnapshotGet(opts: {
  db: Database.Database;
  userId: number;
  campaignId: number;
  authMs?: number;
}): TrpgSnapshotGetResult {
  if (!isTrpgSnapshotDiagnosticsEnabled()) {
    return { campaign: loadTrpgSnapshot(opts.db, opts.campaignId, opts.userId) };
  }

  const requestId = newTrpgDiagRequestId();
  const profile: SnapshotProfileTimings = {
    requestId,
    campaignId: opts.campaignId,
  };
  let status = 200;
  let snapshotMs = 0;
  let serializeMs = 0;
  let snapshotBytes = 0;
  let scale: SnapshotScaleCounts | null = null;
  const t0 = performance.now();
  const activeAfterStart = beginActiveSnapshotRequest();
  try {
    logTrpgSnapshotDiag({
      event: "trpg_snapshot_start",
      requestId,
      campaignId: opts.campaignId,
      activeSnapshotRequests: activeAfterStart,
      timestamp: new Date().toISOString(),
    });
    const tSnap0 = performance.now();
    const campaign = runWithSnapshotProfile(profile, () =>
      loadTrpgSnapshot(opts.db, opts.campaignId, opts.userId)
    );
    snapshotMs = roundDiagMs(performance.now() - tSnap0);
    profile.totalSnapshotMs = snapshotMs;
    if (!campaign) {
      status = 404;
      return { campaign: null };
    }
    const tSer0 = performance.now();
    snapshotBytes = Buffer.byteLength(JSON.stringify({ campaign }), "utf8");
    serializeMs = roundDiagMs(performance.now() - tSer0);
    scale = collectSnapshotScaleCounts(campaign);
    return { campaign };
  } catch (error) {
    status = 400;
    throw error;
  } finally {
    const remaining = endActiveSnapshotRequest();
    const totalMs = roundDiagMs(performance.now() - t0);
    const endLine: Record<string, unknown> = {
      event: "trpg_snapshot_end",
      requestId,
      campaignId: opts.campaignId,
      status,
      activeSnapshotRequests: remaining,
      authMs: opts.authMs ?? 0,
      snapshotMs,
      serializeMs,
      totalMs,
      roundNumber: scale?.roundNumber ?? null,
      roundCount: scale?.roundCount ?? null,
      participantCount: scale?.participantCount ?? null,
      logActionCount: scale?.logActionCount ?? null,
      logRollCount: scale?.logRollCount ?? null,
      snapshotBytes,
    };
    if (scale) {
      endLine.totalNarrations = scale.totalNarrations;
      endLine.estimatedTextChars = scale.estimatedTextChars;
    }
    if (totalMs >= TRPG_SNAPSHOT_SLOW_MS) {
      Object.assign(endLine, readProcessMemoryMb());
    }
    logTrpgSnapshotDiag(endLine);
    logTrpgSnapshotDiag({
      event: "trpg_snapshot_profile",
      requestId,
      campaignId: opts.campaignId,
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
