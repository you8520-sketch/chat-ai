import { createHash } from "node:crypto";
import type { ForwardModelAudit, ForwardReconAudit, ForwardUnmatchedRequest } from "./forwardReconAudit";
import { identifiedForwardMeasurement } from "./forwardReconEvidence";

export type ForwardReviewRecord = {
  observedSince: string;
  reviewedAt: string;
  reviewedBy: number;
  requestKeys: string[];
};

export type ForwardReviewGroup = {
  count: number;
  microUsd: number;
  firstAt: string | null;
  lastAt: string | null;
  byModel: Record<string, ForwardModelAudit>;
  /** Hash of the rows in this group. Absent on older projections. */
  evidenceFingerprint?: string | null;
};

export type ForwardReviewProjection = {
  available: boolean;
  snapshotFingerprint: string | null;
  reviewedAt: string | null;
  pendingProduction: ForwardReviewGroup;
  pendingUndetermined: ForwardReviewGroup;
  reviewedUnresolved: ForwardReviewGroup;
  identifiedMeasurements: ForwardReviewGroup;
  evidenceSources: string[];
};

export function forwardRequestReviewKey(row: ForwardUnmatchedRequest): string {
  // A new ID, changed bill or changed production classification must reopen.
  return JSON.stringify([row.requestHash, row.billedMicroUsd, row.scope, row.model, row.createdAt]);
}

export function completeForwardRequestWitnesses(audit: ForwardReconAudit): boolean {
  const rows = audit.unmatchedRequests;
  if (audit.fetchStatus !== "ok" || audit.verificationStatus !== "verified" || !audit.productionScope.known || !Array.isArray(rows)) return false;
  const ids = new Set<string>();
  let total = 0, production = 0, productionMicro = 0;
  for (const row of rows) {
    if (!row || typeof row.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(row.requestHash) || ids.has(row.requestHash) ||
      typeof row.model !== "string" || !Number.isSafeInteger(row.billedMicroUsd) || row.billedMicroUsd <= 0 ||
      typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
      (row.scope !== "production" && row.scope !== "undetermined")) return false;
    ids.add(row.requestHash);
    total += row.billedMicroUsd;
    if (row.scope === "production") { production++; productionMicro += row.billedMicroUsd; }
  }
  return rows.length === audit.unmatchedLedgerCount && total === audit.unmatchedSettledMicroUsd &&
    production === audit.productionScope.unmatchedLedgerCount && productionMicro === audit.productionScope.unmatchedSettledMicroUsd;
}

/** Stable witness for one set of review keys. Raw request ids are not inputs. */
export function forwardEvidenceFingerprint(
  observedSince: string | null | undefined,
  rows: readonly ForwardUnmatchedRequest[]
): string | null {
  if (!observedSince || rows.length === 0) return null;
  for (const row of rows) {
    if (
      !row ||
      typeof row.requestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.requestHash) ||
      typeof row.model !== "string" ||
      !Number.isSafeInteger(row.billedMicroUsd) ||
      row.billedMicroUsd <= 0 ||
      typeof row.createdAt !== "string" ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      (row.scope !== "production" && row.scope !== "undetermined")
    ) {
      return null;
    }
  }
  return createHash("sha256")
    .update(JSON.stringify([observedSince, rows.map(forwardRequestReviewKey).sort()]))
    .digest("hex");
}

export function forwardSnapshotFingerprint(audit: ForwardReconAudit): string | null {
  if (!completeForwardRequestWitnesses(audit)) return null;
  return forwardEvidenceFingerprint(audit.observedSince, audit.unmatchedRequests!);
}

export function parseForwardReviewRecord(value: unknown): ForwardReviewRecord | null {
  try {
    const row = typeof value === "string" ? JSON.parse(value) : value;
    if (!row || typeof row.observedSince !== "string" || !Number.isFinite(Date.parse(row.observedSince)) ||
      typeof row.reviewedAt !== "string" || !Number.isFinite(Date.parse(row.reviewedAt)) ||
      !Number.isSafeInteger(row.reviewedBy) || row.reviewedBy <= 0 || !Array.isArray(row.requestKeys) ||
      !row.requestKeys.every((key: unknown) => typeof key === "string" && key.length < 512)) return null;
    return row as ForwardReviewRecord;
  } catch { return null; }
}

function group(): ForwardReviewGroup {
  return { count: 0, microUsd: 0, firstAt: null, lastAt: null, byModel: {}, evidenceFingerprint: null };
}

function add(target: ForwardReviewGroup, row: ForwardUnmatchedRequest) {
  target.count++;
  target.microUsd += row.billedMicroUsd;
  if (!target.firstAt || row.createdAt < target.firstAt) target.firstAt = row.createdAt;
  if (!target.lastAt || row.createdAt > target.lastAt) target.lastAt = row.createdAt;
  const model = Object.hasOwn(target.byModel, row.model) ? target.byModel[row.model] : { settledCount: 0, unmatchedCount: 0, settledMicroUsd: 0, unmatchedMicroUsd: 0 };
  model.settledCount++; model.unmatchedCount++;
  model.settledMicroUsd += row.billedMicroUsd; model.unmatchedMicroUsd += row.billedMicroUsd;
  Object.defineProperty(target.byModel, row.model, { value: model, enumerable: true, configurable: true, writable: true });
}

export function projectForwardReview(audit: ForwardReconAudit, review: ForwardReviewRecord | null): ForwardReviewProjection {
  const fingerprint = forwardSnapshotFingerprint(audit);
  const result: ForwardReviewProjection = {
    available: fingerprint !== null,
    snapshotFingerprint: fingerprint,
    reviewedAt: review?.observedSince === audit.observedSince ? review.reviewedAt : null,
    pendingProduction: group(), pendingUndetermined: group(), reviewedUnresolved: group(), identifiedMeasurements: group(),
    evidenceSources: [],
  };
  if (!result.available) return result;
  const reviewed = new Set(review?.observedSince === audit.observedSince ? review.requestKeys : []);
  const sources = new Set<string>();
  const pendingProduction: ForwardUnmatchedRequest[] = [];
  const pendingUndetermined: ForwardUnmatchedRequest[] = [];
  for (const row of audit.unmatchedRequests!) {
    const source = identifiedForwardMeasurement(row);
    if (source) { add(result.identifiedMeasurements, row); sources.add(source); }
    else if (reviewed.has(forwardRequestReviewKey(row))) add(result.reviewedUnresolved, row);
    else if (row.scope === "production") {
      add(result.pendingProduction, row);
      pendingProduction.push(row);
    } else {
      add(result.pendingUndetermined, row);
      pendingUndetermined.push(row);
    }
  }
  result.pendingProduction.evidenceFingerprint = forwardEvidenceFingerprint(audit.observedSince, pendingProduction);
  result.pendingUndetermined.evidenceFingerprint = forwardEvidenceFingerprint(audit.observedSince, pendingUndetermined);
  result.evidenceSources = [...sources];
  return result;
}
