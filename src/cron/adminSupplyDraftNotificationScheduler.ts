import type Database from "better-sqlite3";

import {
  fetchGithubSupplyAutoDraftProjection,
  type GithubSupplyAutoDraftProjection,
} from "@/lib/adminAutomationReports";
import { getDb } from "@/lib/db";
import {
  buildSupplierDiscoveryReport,
  supplierDiscoveryNotificationTargets,
} from "@/lib/supplierDiscovery/discoverSuppliers";
import {
  notifyAdminsSupplyCandidateAttention,
  notifyAdminsSupplyDraftReady,
} from "@/lib/userNotifications";

export const ADMIN_SUPPLY_DRAFT_NOTIFICATION_POLL_MS = 5 * 60 * 1000;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let scanRunning = false;

export type AdminSupplyDraftNotificationScan = {
  status: GithubSupplyAutoDraftProjection["status"];
  draftsSeen: number;
  adminNotificationsCreated: number;
  error: string | null;
};

export async function runAdminSupplyDraftNotificationScan(
  db: Database.Database,
  fetchImpl: typeof fetch = fetch
): Promise<AdminSupplyDraftNotificationScan> {
  const projection = await fetchGithubSupplyAutoDraftProjection(fetchImpl);
  if (projection.status !== "OK") {
    return {
      status: projection.status,
      draftsSeen: 0,
      adminNotificationsCreated: 0,
      error: projection.error,
    };
  }

  let created = 0;
  for (const draft of projection.drafts) {
    created += notifyAdminsSupplyDraftReady(db, {
      prNumber: draft.number,
      modelId: draft.modelId,
      candidateProviderSlug: draft.candidateProviderSlug,
    }).length;
  }

  return {
    status: "OK",
    draftsSeen: projection.drafts.length,
    adminNotificationsCreated: created,
    error: null,
  };
}

export function runAdminSupplyCandidateNotificationScan(
  db: Database.Database
): { candidatesSeen: number; adminNotificationsCreated: number } {
  const targets = supplierDiscoveryNotificationTargets(buildSupplierDiscoveryReport());
  let created = 0;
  for (const target of targets) {
    created += notifyAdminsSupplyCandidateAttention(db, target).length;
  }
  return {
    candidatesSeen: targets.length,
    adminNotificationsCreated: created,
  };
}

async function pollOnce(): Promise<void> {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const db = getDb();
    const result = await runAdminSupplyDraftNotificationScan(db);
    if (result.status !== "OK") {
      console.warn("[admin-supply-draft-notify] GitHub projection unavailable", result.error);
    } else if (result.adminNotificationsCreated > 0) {
      console.info("[admin-supply-draft-notify] queued admin notifications", result);
    }
    const candidates = runAdminSupplyCandidateNotificationScan(db);
    if (candidates.adminNotificationsCreated > 0) {
      console.info("[admin-supply-candidate-notify] queued admin notifications", candidates);
    }
  } catch (error) {
    console.warn(
      "[admin-supply-draft-notify] scan failed",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    scanRunning = false;
  }
}

export function startAdminSupplyDraftNotificationScheduler(): ReturnType<typeof setInterval> {
  if (pollInterval) return pollInterval;
  void pollOnce();
  pollInterval = setInterval(() => void pollOnce(), ADMIN_SUPPLY_DRAFT_NOTIFICATION_POLL_MS);
  pollInterval.unref?.();
  return pollInterval;
}

export function stopAdminSupplyDraftNotificationScheduler(): void {
  if (!pollInterval) return;
  clearInterval(pollInterval);
  pollInterval = null;
}
