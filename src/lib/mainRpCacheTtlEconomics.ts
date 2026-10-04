import type Database from "better-sqlite3";

import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
import {
  resolveCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { refreshCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing.server";
import { OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION } from "@/lib/opus55ProcurementPricing";

export const MAIN_RP_CACHE_TTL_AUDIT_VERSION = 1;
export const MAIN_RP_CACHE_TTL_MIN_TRANSITIONS = 20;

export type MainRpCacheTtlRecommendation =
  | "KEEP_5M"
  | "ONE_HOUR_WOULD_BE_CHEAPER_IF_SUPPORTED"
  | "INSUFFICIENT_SAMPLE";

export type MainRpCacheTtlSupportStatus = "UNVERIFIED";

export type MainRpCacheTtlTurnStart = {
  chatId: number;
  startedAt: string;
};

export type MainRpCacheTtlRateSnapshot = {
  standardInputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  fiveMinuteWriteUsdPerMillion: number;
  oneHourWriteUsdPerMillionHypothetical: number;
  source: "provider_catalog" | "fallback";
};

export type MainRpCacheTtlMonthlyReport = {
  version: number;
  yearMonth: string;
  modelId: string;
  generatedAt: string;
  sampleChatCount: number;
  sampleTurnCount: number;
  transitionCount: number;
  gapBuckets: {
    within5Minutes: number;
    over5Within60Minutes: number;
    over60Minutes: number;
  };
  medianGapMinutes: number | null;
  p90GapMinutes: number | null;
  rates: MainRpCacheTtlRateSnapshot;
  normalizedCostUsdPerMillionPrefix: {
    fiveMinuteTtl: number;
    oneHourTtlHypothetical: number;
    oneHourDeltaPercentVsFiveMinute: number | null;
  };
  recommendation: MainRpCacheTtlRecommendation;
  providerOneHourSupport: MainRpCacheTtlSupportStatus;
  evidenceScope:
    "normal_user_turn_start_intervals_only_regeneration_reuse_is_conservatively_excluded";
};

export type KstMonthWindow = {
  yearMonth: string;
  startSqlUtc: string;
  endSqlUtc: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatSqlUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

export function previousCompletedKstMonthWindow(now: Date = new Date()): KstMonthWindow {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + kstOffsetMs);
  const currentYear = shifted.getUTCFullYear();
  const currentMonthIndex = shifted.getUTCMonth();
  const startKstAsUtcMs = Date.UTC(currentYear, currentMonthIndex - 1, 1, 0, 0, 0);
  const endKstAsUtcMs = Date.UTC(currentYear, currentMonthIndex, 1, 0, 0, 0);
  const startActualUtcMs = startKstAsUtcMs - kstOffsetMs;
  const endActualUtcMs = endKstAsUtcMs - kstOffsetMs;
  const start = new Date(startKstAsUtcMs);
  return {
    yearMonth: `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`,
    startSqlUtc: formatSqlUtc(startActualUtcMs),
    endSqlUtc: formatSqlUtc(endActualUtcMs),
  };
}

function parseSqlUtcMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T")
    ? trimmed.endsWith("Z")
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1)
  );
  return sorted[index] ?? null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid] ?? null
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function resolveMainRpCacheTtlRates(): MainRpCacheTtlRateSnapshot {
  const catalog = resolveCheaperInferenceCatalogPricing(
    CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL
  );
  if (catalog) {
    return {
      standardInputUsdPerMillion: catalog.inputUsdPerMillion,
      cacheReadUsdPerMillion: catalog.cacheReadUsdPerMillion,
      fiveMinuteWriteUsdPerMillion: catalog.cacheWriteUsdPerMillion,
      oneHourWriteUsdPerMillionHypothetical: catalog.inputUsdPerMillion * 2,
      source: "provider_catalog",
    };
  }

  const standard = OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION;
  return {
    standardInputUsdPerMillion: standard,
    cacheReadUsdPerMillion: standard * 0.1,
    fiveMinuteWriteUsdPerMillion: standard * 1.25,
    oneHourWriteUsdPerMillionHypothetical: standard * 2,
    source: "fallback",
  };
}

export function computeMainRpCacheTtlEconomics(input: {
  yearMonth: string;
  starts: readonly MainRpCacheTtlTurnStart[];
  rates: MainRpCacheTtlRateSnapshot;
  generatedAt?: string;
}): MainRpCacheTtlMonthlyReport {
  const byChat = new Map<number, number[]>();
  for (const row of input.starts) {
    const ms = parseSqlUtcMs(row.startedAt);
    if (ms == null) continue;
    const list = byChat.get(row.chatId) ?? [];
    list.push(ms);
    byChat.set(row.chatId, list);
  }

  let sampleTurnCount = 0;
  const gapsMinutes: number[] = [];
  let within5Minutes = 0;
  let over5Within60Minutes = 0;
  let over60Minutes = 0;

  for (const list of byChat.values()) {
    list.sort((a, b) => a - b);
    sampleTurnCount += list.length;
    for (let i = 1; i < list.length; i += 1) {
      const gapMinutes = Math.max(0, (list[i]! - list[i - 1]!) / 60_000);
      gapsMinutes.push(gapMinutes);
      if (gapMinutes <= 5) within5Minutes += 1;
      else if (gapMinutes <= 60) over5Within60Minutes += 1;
      else over60Minutes += 1;
    }
  }

  const chatCount = byChat.size;
  const transitionCount = gapsMinutes.length;
  const fiveMinuteWrites = chatCount + over5Within60Minutes + over60Minutes;
  const fiveMinuteReads = within5Minutes;
  const oneHourWrites = chatCount + over60Minutes;
  const oneHourReads = within5Minutes + over5Within60Minutes;

  const fiveMinuteCost =
    fiveMinuteWrites * input.rates.fiveMinuteWriteUsdPerMillion +
    fiveMinuteReads * input.rates.cacheReadUsdPerMillion;
  const oneHourCost =
    oneHourWrites * input.rates.oneHourWriteUsdPerMillionHypothetical +
    oneHourReads * input.rates.cacheReadUsdPerMillion;
  const deltaPercent =
    fiveMinuteCost > 0 ? ((oneHourCost - fiveMinuteCost) / fiveMinuteCost) * 100 : null;

  let recommendation: MainRpCacheTtlRecommendation = "INSUFFICIENT_SAMPLE";
  if (transitionCount >= MAIN_RP_CACHE_TTL_MIN_TRANSITIONS) {
    recommendation =
      oneHourCost < fiveMinuteCost * 0.98
        ? "ONE_HOUR_WOULD_BE_CHEAPER_IF_SUPPORTED"
        : "KEEP_5M";
  }

  return {
    version: MAIN_RP_CACHE_TTL_AUDIT_VERSION,
    yearMonth: input.yearMonth,
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sampleChatCount: chatCount,
    sampleTurnCount,
    transitionCount,
    gapBuckets: {
      within5Minutes,
      over5Within60Minutes,
      over60Minutes,
    },
    medianGapMinutes: median(gapsMinutes),
    p90GapMinutes: percentile(gapsMinutes, 0.9),
    rates: input.rates,
    normalizedCostUsdPerMillionPrefix: {
      fiveMinuteTtl: fiveMinuteCost,
      oneHourTtlHypothetical: oneHourCost,
      oneHourDeltaPercentVsFiveMinute: deltaPercent,
    },
    recommendation,
    providerOneHourSupport: "UNVERIFIED",
    evidenceScope:
      "normal_user_turn_start_intervals_only_regeneration_reuse_is_conservatively_excluded",
  };
}

export function ensureMainRpCacheTtlReportSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS main_rp_cache_ttl_reports (
      year_month TEXT NOT NULL,
      model_id TEXT NOT NULL,
      report_json TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (year_month, model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_main_rp_cache_ttl_reports_generated
      ON main_rp_cache_ttl_reports(generated_at DESC);
  `);
}

export function collectMainRpOpus55NormalTurnStarts(
  db: Database.Database,
  window: KstMonthWindow
): MainRpCacheTtlTurnStart[] {
  const rows = db
    .prepare(
      `SELECT mg.chat_id AS chat_id, u.id AS user_message_id, u.created_at AS started_at
       FROM message_generations mg
       JOIN messages u ON u.id = mg.user_message_id
       WHERE lower(mg.model) = ?
         AND u.role = 'user'
         AND datetime(u.created_at) >= datetime(?)
         AND datetime(u.created_at) < datetime(?)
       GROUP BY mg.chat_id, u.id, u.created_at
       ORDER BY mg.chat_id ASC, datetime(u.created_at) ASC, u.id ASC`
    )
    .all(
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL.toLowerCase(),
      window.startSqlUtc,
      window.endSqlUtc
    ) as Array<{ chat_id: number; user_message_id: number; started_at: string }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    startedAt: row.started_at,
  }));
}

export function saveMainRpCacheTtlReport(
  db: Database.Database,
  report: MainRpCacheTtlMonthlyReport
): void {
  ensureMainRpCacheTtlReportSchema(db);
  db.prepare(
    `INSERT INTO main_rp_cache_ttl_reports
       (year_month, model_id, report_json, generated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(year_month, model_id) DO UPDATE SET
       report_json=excluded.report_json,
       generated_at=datetime('now')`
  ).run(report.yearMonth, report.modelId, JSON.stringify(report));
}

export function listMainRpCacheTtlReports(
  db: Database.Database,
  limit = 12
): MainRpCacheTtlMonthlyReport[] {
  ensureMainRpCacheTtlReportSchema(db);
  const rows = db
    .prepare(
      `SELECT report_json
       FROM main_rp_cache_ttl_reports
       ORDER BY year_month DESC
       LIMIT ?`
    )
    .all(Math.min(Math.max(1, Math.floor(limit)), 36)) as Array<{ report_json: string }>;

  const reports: MainRpCacheTtlMonthlyReport[] = [];
  for (const row of rows) {
    try {
      reports.push(JSON.parse(row.report_json) as MainRpCacheTtlMonthlyReport);
    } catch {
      // Corrupt historical report rows are skipped; the scheduler can replace the month deterministically.
    }
  }
  return reports;
}

export async function runMainRpCacheTtlMonthlyAudit(
  db: Database.Database,
  now: Date = new Date()
): Promise<MainRpCacheTtlMonthlyReport> {
  const window = previousCompletedKstMonthWindow(now);
  await refreshCheaperInferenceCatalogPricing({ force: true });
  const report = computeMainRpCacheTtlEconomics({
    yearMonth: window.yearMonth,
    starts: collectMainRpOpus55NormalTurnStarts(db, window),
    rates: resolveMainRpCacheTtlRates(),
  });
  saveMainRpCacheTtlReport(db, report);
  return report;
}
