import type { Database } from "better-sqlite3";
import type { Usage } from "@/lib/chatUsage";
import {
  OPUS_COLD_CACHE_WRITE_THRESHOLD,
  TARGET_OPUS_GROSS_MARGIN,
  computeOpusRollingWindows,
  isOpusTierPricedModel,
  type OpusPaidTurnTelemetry,
} from "@/lib/opusTierPricing";

function parseUsage(raw: string | null): Usage | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Usage;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveOpusTurnApiCosts(usage: Usage): {
  mainApiRawCostKrw: number;
  widgetApiRawCostKrw: number;
} {
  const widgetApiRawCostKrw = Math.max(0, usage.statusWidgetExtract?.apiRawCostKrw ?? 0);
  if (usage.mainApiRawCostKrw != null) {
    return {
      mainApiRawCostKrw: Math.max(0, usage.mainApiRawCostKrw),
      widgetApiRawCostKrw,
    };
  }
  const combined = Math.max(0, usage.apiRawCostKrw ?? 0);
  return {
    mainApiRawCostKrw: Math.max(0, combined - widgetApiRawCostKrw),
    widgetApiRawCostKrw,
  };
}

export function usageToOpusPaidTurn(usage: Usage): OpusPaidTurnTelemetry | null {
  if (!isOpusTierPricedModel(usage.model) && !isOpusTierPricedModel(usage.selectedAI)) {
    return null;
  }
  if (usage.billingWaived || !(usage.cost > 0)) return null;
  const costs = resolveOpusTurnApiCosts(usage);
  return {
    deductedPoints: usage.cost,
    mainApiRawCostKrw: costs.mainApiRawCostKrw,
    widgetApiRawCostKrw: costs.widgetApiRawCostKrw,
    cacheWriteTokens: usage.cacheWriteTokens,
    visibleOutputChars: usage.savedOutputChars,
    billingWaived: usage.billingWaived,
  };
}

export function loadRecentOpusPaidTurns(
  db: Database,
  limit = 100
): OpusPaidTurnTelemetry[] {
  const scanLimit = Math.max(200, limit * 40);
  const rows = db
    .prepare(
      `SELECT usage, model FROM messages
       WHERE role = 'assistant' AND usage IS NOT NULL AND usage != ''
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(scanLimit) as Array<{ usage: string | null; model: string }>;
  const out: OpusPaidTurnTelemetry[] = [];
  for (const row of rows) {
    const usage = parseUsage(row.usage);
    if (!usage) continue;
    if (!usage.model) usage.model = row.model;
    const turn = usageToOpusPaidTurn(usage);
    if (turn) out.push(turn);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildOpusMarginTelemetry(db: Database) {
  const turns = loadRecentOpusPaidTurns(db, 200);
  return {
    targetGrossMargin: TARGET_OPUS_GROSS_MARGIN,
    windows: computeOpusRollingWindows(turns),
    sampleSize: turns.length,
    coldStartDefinition: {
      cacheWriteTokensGreaterThan: OPUS_COLD_CACHE_WRITE_THRESHOLD,
    },
  };
}
