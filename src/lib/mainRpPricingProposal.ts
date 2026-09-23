/**
 * Phase B2D — Main RP candidate history + reviewable price-change proposals.
 *
 * Canonical responsibilities:
 * - persist semantic B2C candidate state changes
 * - keep at most one OPEN proposal per model
 * - review lifecycle: OPEN -> APPROVED | REJECTED | SUPERSEDED
 *
 * APPROVED is review evidence only. This module never mutates published pricing,
 * billing contracts, promotions, routing, points, or pricing feature flags.
 */

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  MainRpPricingObservabilityProjection,
  MainRpPricingObservabilityRow,
} from "@/lib/mainRpPricingObservability";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

export type MainRpPricingCandidateReviewState =
  | "NOT_REVIEWABLE"
  | "OPEN"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED";

export type MainRpPricingCandidateRecord = {
  id: number;
  modelId: string;
  candidateFingerprint: string;
  candidateStatus: MainRpPricingObservabilityRow["candidate"]["status"];
  candidateDirection: MainRpPricingObservabilityRow["candidate"]["candidateDirection"];
  reviewState: MainRpPricingCandidateReviewState;
  basePricingVersion: number;
  baseTargetMargin: number;
  proposedTargetMargin: number | null;
  minimumSafeTargetMargin: number | null;
  maximumCompetitiveTargetMargin: number | null;
  liveApplicability: MainRpPricingObservabilityRow["candidate"]["liveApplicability"];
  productionBillingContract: MainRpPricingObservabilityRow["candidate"]["productionBillingContract"];
  procurementFreshness: MainRpPricingObservabilityRow["candidate"]["procurementFreshness"];
  actualSignal: MainRpPricingObservabilityRow["candidate"]["actual"]["signal"];
  actualMonthKey: string | null;
  actualMarginRate: number | null;
  actualExact: boolean;
  hardBenchmarkCount: number;
  evidence: Record<string, unknown>;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  reviewedAt: string | null;
  reviewedByUserId: number | null;
  reviewNote: string;
  supersededReason: string | null;
};

type CandidateRecordDbRow = {
  id: number;
  model_id: string;
  candidate_fingerprint: string;
  candidate_status: MainRpPricingCandidateRecord["candidateStatus"];
  candidate_direction: MainRpPricingCandidateRecord["candidateDirection"];
  review_state: MainRpPricingCandidateReviewState;
  base_pricing_version: number;
  base_target_margin: number;
  proposed_target_margin: number | null;
  minimum_safe_target_margin: number | null;
  maximum_competitive_target_margin: number | null;
  live_applicability: MainRpPricingCandidateRecord["liveApplicability"];
  production_billing_contract: MainRpPricingCandidateRecord["productionBillingContract"];
  procurement_freshness: MainRpPricingCandidateRecord["procurementFreshness"];
  actual_signal: MainRpPricingCandidateRecord["actualSignal"];
  actual_month_key: string | null;
  actual_margin_rate: number | null;
  actual_exact: number;
  hard_benchmark_count: number;
  evidence_json: string;
  first_observed_at: string;
  last_observed_at: string;
  observation_count: number;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  review_note: string;
  superseded_reason: string | null;
};

function stableCandidatePayload(row: MainRpPricingObservabilityRow): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelId: row.modelId,
    basePricingVersion: row.product.pricingVersion,
    currentTargetMargin: row.candidate.currentTargetMargin,
    candidateStatus: row.candidate.status,
    candidateDirection: row.candidate.candidateDirection,
    proposedTargetMargin: row.candidate.candidateTargetMargin,
    minimumSafeTargetMargin: row.candidate.minimumSafeTargetMargin,
    maximumCompetitiveTargetMargin: row.candidate.maximumCompetitiveTargetMargin,
    liveApplicability: row.candidate.liveApplicability,
    productionBillingContract: row.candidate.productionBillingContract,
    procurementFreshness: row.candidate.procurementFreshness,
    actualSignal: row.candidate.actual.signal,
    actualExact: row.candidate.actual.exact,
    hardBenchmarks: row.candidate.market.cases.map((marketCase) => ({
      benchmarkId: marketCase.benchmarkId,
      competitorPoints: marketCase.competitorPoints,
      candidatePoints: marketCase.candidatePoints,
    })),
  };
}

export function buildMainRpPricingCandidateFingerprint(
  row: MainRpPricingObservabilityRow
): string {
  return createHash("sha256")
    .update(JSON.stringify(stableCandidatePayload(row)))
    .digest("hex");
}

export function isReviewableMainRpPricingCandidate(
  row: MainRpPricingObservabilityRow
): boolean {
  return (
    row.candidate.status === "READY" &&
    (row.candidate.candidateDirection === "RAISE_TO_FLOOR" ||
      row.candidate.candidateDirection === "LOWER_TO_MARKET") &&
    row.candidate.candidateTargetMargin != null
  );
}

function evidenceForRow(
  row: MainRpPricingObservabilityRow,
  observedAt: string
): Record<string, unknown> {
  return {
    observedAt,
    product: {
      pricingVersion: row.product.pricingVersion,
      publishedAt: row.product.publishedAt,
      currentTargetMargin: row.candidate.currentTargetMargin,
    },
    candidate: row.candidate,
    representative: {
      workload: row.representative.representativeWorkloadLabel,
      targetMargin: row.representative.targetMargin,
      minimumMarginFloor: row.representative.minimumMarginFloor,
      estimate: row.representative.representativeMarginEstimate,
      trackerAlignedMarginEstimate: row.representative.trackerAlignedMarginEstimate,
      status: row.representative.status,
    },
    procurement: {
      inputUsdPerMillion: row.procurement.ciInputUsdPerMillion,
      outputUsdPerMillion: row.procurement.ciOutputUsdPerMillion,
      cacheReadUsdPerMillion: row.procurement.ciCacheReadUsdPerMillion,
      observedAt: row.procurement.ciObservedAt,
      freshness: row.procurement.ciFreshnessState,
      source: row.procurement.ciEvidenceSource,
      provenance: row.procurement.provenance,
    },
  };
}

function parseRecord(row: CandidateRecordDbRow): MainRpPricingCandidateRecord {
  let evidence: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.evidence_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      evidence = parsed as Record<string, unknown>;
    }
  } catch {
    evidence = {};
  }
  return {
    id: row.id,
    modelId: row.model_id,
    candidateFingerprint: row.candidate_fingerprint,
    candidateStatus: row.candidate_status,
    candidateDirection: row.candidate_direction,
    reviewState: row.review_state,
    basePricingVersion: row.base_pricing_version,
    baseTargetMargin: row.base_target_margin,
    proposedTargetMargin: row.proposed_target_margin,
    minimumSafeTargetMargin: row.minimum_safe_target_margin,
    maximumCompetitiveTargetMargin: row.maximum_competitive_target_margin,
    liveApplicability: row.live_applicability,
    productionBillingContract: row.production_billing_contract,
    procurementFreshness: row.procurement_freshness,
    actualSignal: row.actual_signal,
    actualMonthKey: row.actual_month_key,
    actualMarginRate: row.actual_margin_rate,
    actualExact: row.actual_exact === 1,
    hardBenchmarkCount: row.hard_benchmark_count,
    evidence,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    observationCount: row.observation_count,
    reviewedAt: row.reviewed_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewNote: row.review_note,
    supersededReason: row.superseded_reason,
  };
}

const SELECT_COLUMNS = `
  id, model_id, candidate_fingerprint, candidate_status, candidate_direction,
  review_state, base_pricing_version, base_target_margin, proposed_target_margin,
  minimum_safe_target_margin, maximum_competitive_target_margin,
  live_applicability, production_billing_contract, procurement_freshness,
  actual_signal, actual_month_key, actual_margin_rate, actual_exact,
  hard_benchmark_count, evidence_json, first_observed_at, last_observed_at,
  observation_count, reviewed_at, reviewed_by_user_id, review_note,
  superseded_reason
`;

function readLatestForModel(
  db: Database.Database,
  modelId: string
): MainRpPricingCandidateRecord | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM model_pricing_candidate_records
       WHERE model_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(modelId) as CandidateRecordDbRow | undefined;
  return row ? parseRecord(row) : null;
}

function readById(
  db: Database.Database,
  id: number
): MainRpPricingCandidateRecord | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM model_pricing_candidate_records
       WHERE id = ?`
    )
    .get(id) as CandidateRecordDbRow | undefined;
  return row ? parseRecord(row) : null;
}

export function listMainRpPricingCandidateRecords(
  db: Database.Database,
  limit = 50
): MainRpPricingCandidateRecord[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM model_pricing_candidate_records
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(boundedLimit) as CandidateRecordDbRow[];
  return rows.map(parseRecord);
}

export type MainRpPricingCandidateSyncResult = {
  inserted: number;
  refreshed: number;
  superseded: number;
  open: number;
};

export function syncMainRpPricingCandidateRecords(
  db: Database.Database,
  rows: readonly MainRpPricingObservabilityRow[],
  observedAt: string
): MainRpPricingCandidateSyncResult {
  let inserted = 0;
  let refreshed = 0;
  let superseded = 0;

  for (const row of rows) {
    const fingerprint = buildMainRpPricingCandidateFingerprint(row);
    const latest = readLatestForModel(db, row.modelId);
    const evidenceJson = JSON.stringify(evidenceForRow(row, observedAt));

    if (latest?.candidateFingerprint === fingerprint) {
      db.prepare(
        `UPDATE model_pricing_candidate_records
         SET last_observed_at = ?,
             observation_count = observation_count + 1,
             evidence_json = ?,
             actual_month_key = ?,
             actual_margin_rate = ?,
             actual_exact = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        observedAt,
        evidenceJson,
        row.candidate.actual.monthKey,
        row.candidate.actual.marginRate,
        row.candidate.actual.exact ? 1 : 0,
        latest.id
      );
      refreshed += 1;
      continue;
    }

    if (latest?.reviewState === "OPEN") {
      db.prepare(
        `UPDATE model_pricing_candidate_records
         SET review_state = 'SUPERSEDED',
             superseded_reason = 'candidate_state_changed',
             updated_at = datetime('now')
         WHERE id = ? AND review_state = 'OPEN'`
      ).run(latest.id);
      superseded += 1;
    }

    const reviewState: MainRpPricingCandidateReviewState =
      isReviewableMainRpPricingCandidate(row) ? "OPEN" : "NOT_REVIEWABLE";

    db.prepare(
      `INSERT INTO model_pricing_candidate_records (
        model_id, candidate_fingerprint, candidate_status, candidate_direction,
        review_state, base_pricing_version, base_target_margin, proposed_target_margin,
        minimum_safe_target_margin, maximum_competitive_target_margin,
        live_applicability, production_billing_contract, procurement_freshness,
        actual_signal, actual_month_key, actual_margin_rate, actual_exact,
        hard_benchmark_count, evidence_json, first_observed_at, last_observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.modelId,
      fingerprint,
      row.candidate.status,
      row.candidate.candidateDirection,
      reviewState,
      row.product.pricingVersion,
      row.candidate.currentTargetMargin,
      row.candidate.candidateTargetMargin,
      row.candidate.minimumSafeTargetMargin,
      row.candidate.maximumCompetitiveTargetMargin,
      row.candidate.liveApplicability,
      row.candidate.productionBillingContract,
      row.candidate.procurementFreshness,
      row.candidate.actual.signal,
      row.candidate.actual.monthKey,
      row.candidate.actual.marginRate,
      row.candidate.actual.exact ? 1 : 0,
      row.candidate.market.hardBenchmarkCount,
      evidenceJson,
      observedAt,
      observedAt
    );
    inserted += 1;
  }

  const openRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM model_pricing_candidate_records
       WHERE review_state = 'OPEN'`
    )
    .get() as { c: number };

  return { inserted, refreshed, superseded, open: Number(openRow.c) };
}

export type MainRpPricingCandidateReviewResult =
  | { ok: true; record: MainRpPricingCandidateRecord; appliesPrice: false }
  | {
      ok: false;
      status: 404 | 409;
      code: "NOT_FOUND" | "NOT_OPEN" | "STALE_BASE" | "STALE_CANDIDATE";
      error: string;
    };

function supersedeOpen(
  db: Database.Database,
  id: number,
  reason: string
): void {
  db.prepare(
    `UPDATE model_pricing_candidate_records
     SET review_state = 'SUPERSEDED',
         superseded_reason = ?,
         updated_at = datetime('now')
     WHERE id = ? AND review_state = 'OPEN'`
  ).run(reason, id);
}

export function reviewMainRpPricingCandidateRecord(params: {
  db: Database.Database;
  id: number;
  adminUserId: number;
  action: "approve" | "reject";
  note?: string;
  currentProjection: MainRpPricingObservabilityProjection;
  reviewedAt?: string;
}): MainRpPricingCandidateReviewResult {
  const record = readById(params.db, params.id);
  if (!record) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "제안 기록을 찾을 수 없습니다." };
  }
  if (record.reviewState !== "OPEN") {
    return { ok: false, status: 409, code: "NOT_OPEN", error: "이미 처리되었거나 대체된 제안입니다." };
  }

  const published = getPublishedPricing(record.modelId);
  if (
    published.pricingVersion !== record.basePricingVersion ||
    published.targetMargin !== record.baseTargetMargin
  ) {
    supersedeOpen(params.db, record.id, "published_base_changed");
    return { ok: false, status: 409, code: "STALE_BASE", error: "Published 기준이 변경되어 제안이 만료되었습니다." };
  }

  const currentRow = params.currentProjection.models.find(
    (row) => row.modelId === record.modelId
  );
  if (
    !currentRow ||
    !isReviewableMainRpPricingCandidate(currentRow) ||
    buildMainRpPricingCandidateFingerprint(currentRow) !== record.candidateFingerprint
  ) {
    supersedeOpen(params.db, record.id, "candidate_no_longer_current");
    return { ok: false, status: 409, code: "STALE_CANDIDATE", error: "현재 candidate와 일치하지 않아 제안이 만료되었습니다." };
  }

  const reviewedAt = params.reviewedAt ?? new Date().toISOString();
  const nextState: MainRpPricingCandidateReviewState =
    params.action === "approve" ? "APPROVED" : "REJECTED";
  const update = params.db.prepare(
    `UPDATE model_pricing_candidate_records
     SET review_state = ?,
         reviewed_at = ?,
         reviewed_by_user_id = ?,
         review_note = ?,
         updated_at = datetime('now')
     WHERE id = ? AND review_state = 'OPEN'`
  ).run(
    nextState,
    reviewedAt,
    params.adminUserId,
    (params.note ?? "").trim().slice(0, 1000),
    record.id
  );
  if (Number(update.changes) !== 1) {
    return { ok: false, status: 409, code: "NOT_OPEN", error: "다른 요청에서 이미 처리된 제안입니다." };
  }

  return {
    ok: true,
    record: readById(params.db, record.id)!,
    appliesPrice: false,
  };
}
