import type Database from "better-sqlite3";
import { loadTrpgSnapshot } from "./engineSnapshot";
import type { TrpgCampaignSnapshot } from "./snapshot";
import {
  isTrpgSnapshotDiagnosticsEnabled,
  runWithSnapshotProfile,
  type SnapshotProfileTimings,
} from "./snapshotDiagnostics";

export type TrpgCampaignSnapshotLoadResult = {
  campaign: TrpgCampaignSnapshot | null;
  profile: SnapshotProfileTimings | null;
};

export function loadTrpgCampaignSnapshotForGet(opts: {
  db: Database.Database;
  userId: number;
  campaignId: number;
  requestId: string;
}): TrpgCampaignSnapshotLoadResult {
  if (!isTrpgSnapshotDiagnosticsEnabled()) {
    return { campaign: loadTrpgSnapshot(opts.db, opts.campaignId, opts.userId), profile: null };
  }
  const profile: SnapshotProfileTimings = {
    requestId: opts.requestId,
    campaignId: opts.campaignId,
  };
  const t0 = performance.now();
  const campaign = runWithSnapshotProfile(profile, () =>
    loadTrpgSnapshot(opts.db, opts.campaignId, opts.userId)
  );
  profile.totalSnapshotMs = Math.round((performance.now() - t0) * 10) / 10;
  return { campaign, profile };
}
