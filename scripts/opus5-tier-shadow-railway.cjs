#!/usr/bin/env node
/**
 * Claude Opus 5 ONLY — SELECT-only historical shadow.
 * No DB write, no migration, no LLM, no user message text, no price change.
 *
 * Railway production (file does not need to be deployed — paste after ssh):
 *
 *   railway ssh
 *   node /data/opus5-tier-shadow-railway.cjs
 *
 * or, inside the running service, paste this file via stdin:
 *
 *   railway ssh
 *   node <<'ENDSCRIPT'
 *   ...contents of this file...
 *   ENDSCRIPT
 *
 * Default DB: /data/app.db (readonly, fileMustExist).
 */
"use strict";

const Database = require("better-sqlite3");

const OPUS5 = "claude-opus-5";
const DB_PATH = process.env.OPUS5_SHADOW_DB || "/data/app.db";
const COLD_WRITE = 3000;

function outputTierPoints(chars) {
  const n = Math.max(0, chars);
  if (n < 2500) return 380;
  if (n < 3500) return 430;
  if (n < 4500) return 480;
  if (n < 5500) return 530;
  if (n < 6500) return 580;
  return 620;
}

function inputSurcharge(tokens) {
  const n = Math.max(0, tokens);
  if (n <= 40000) return 0;
  if (n <= 60000) return 10;
  if (n <= 80000) return 20;
  if (n <= 100000) return 30;
  return 40;
}

function newCharge(chars, tokens) {
  return Math.min(620, outputTierPoints(chars) + inputSurcharge(tokens));
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isOpus5(id) {
  return String(id || "").trim().toLowerCase() === OPUS5;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((n, v) => n + v, 0) / values.length;
}

function marginPct(revenue, cost) {
  if (!(revenue > 0)) return null;
  return Math.round((1 - cost / revenue) * 1000) / 10;
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

function judge(margin, sample) {
  if (sample < 20 || margin == null) {
    return { verdict: "AVAILABLE_SAMPLE_ONLY", note: "sample < 20 — 가격 확정 금지." };
  }
  if (margin > 48) {
    return {
      verdict: "PASS_MARGIN_HIGH",
      note: ">48% — 현재 tier 유지, 가격 인하 후보만 보고, 자동 변경 금지.",
    };
  }
  if (margin < 42) {
    return {
      verdict: "FAIL_MARGIN_LOW",
      note: "<42% — 부족한 output tier와 +10/+20P 후보만 보고, 자동 변경 금지.",
    };
  }
  return { verdict: "PASS", note: "42~48% — 현재 tier 유지." };
}

function windowStats(turns) {
  const newCharges = turns.map((t) => t.newCharge);
  const sortedNew = [...newCharges].sort((a, b) => a - b);
  const totalApiCostKrw = turns.reduce((n, t) => n + t.apiCostKrw, 0);
  const newRevenueP = turns.reduce((n, t) => n + t.newCharge, 0);
  return {
    turns: turns.length,
    totalApiCostKrw: round1(totalApiCostKrw),
    newRevenueP,
    newRealizedMarginPct: marginPct(newRevenueP, totalApiCostKrw),
    avgOutputChars: turns.length ? Math.round(avg(turns.map((t) => t.outputChars))) : null,
    avgInputTokens: turns.length ? Math.round(avg(turns.map((t) => t.inputTokens))) : null,
    avgNewCharge: turns.length ? Math.round(avg(newCharges)) : null,
    p10NewCharge: percentile(sortedNew, 0.1),
    p50NewCharge: percentile(sortedNew, 0.5),
    p90NewCharge: percentile(sortedNew, 0.9),
    maxNewCharge: newCharges.length ? Math.max(...newCharges) : null,
    coldWriteCount: turns.filter((t) => t.cold).length,
  };
}

function volatility(turns) {
  const oldCharges = turns.map((t) => t.oldCharge).sort((a, b) => a - b);
  const newCharges = turns.map((t) => t.newCharge).sort((a, b) => a - b);
  return {
    oldChargeRange: oldCharges.length ? oldCharges[oldCharges.length - 1] - oldCharges[0] : null,
    newChargeRange: newCharges.length ? newCharges[newCharges.length - 1] - newCharges[0] : null,
    oldP90MinusP10:
      oldCharges.length >= 2
        ? (percentile(oldCharges, 0.9) ?? 0) - (percentile(oldCharges, 0.1) ?? 0)
        : null,
    newP90MinusP10:
      newCharges.length >= 2
        ? (percentile(newCharges, 0.9) ?? 0) - (percentile(newCharges, 0.1) ?? 0)
        : null,
  };
}

function lowMarginTiers(turns) {
  const groups = new Map();
  for (const turn of turns) {
    const tier = outputTierPoints(turn.outputChars);
    const list = groups.get(tier) || [];
    list.push(turn);
    groups.set(tier, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, group]) => {
      const cost = group.reduce((n, t) => n + t.apiCostKrw, 0);
      const revenue = group.reduce((n, t) => n + t.newCharge, 0);
      return {
        outputTierPoints: tier,
        turns: group.length,
        realizedMarginPct: marginPct(revenue, cost),
        plus10Candidate: Math.min(620, tier + 10),
        plus20Candidate: Math.min(620, tier + 20),
      };
    })
    .filter((row) => row.realizedMarginPct == null || row.realizedMarginPct < 42);
}

function decreaseCandidates(turns) {
  const groups = new Map();
  for (const turn of turns) {
    const tier = outputTierPoints(turn.outputChars);
    groups.set(tier, (groups.get(tier) || 0) + 1);
  }
  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((tier) => ({
      outputTierPoints: tier,
      minus10Candidate: Math.max(0, tier - 10),
      minus20Candidate: Math.max(0, tier - 20),
    }));
}

function loadTurns(db) {
  const rows = db
    .prepare(
      `SELECT usage, model FROM messages
       WHERE role = 'assistant'
         AND usage IS NOT NULL AND usage != ''
         AND COALESCE(is_refunded, 0) = 0
       ORDER BY id DESC
       LIMIT 8000`
    )
    .all();
  const turns = [];
  for (const row of rows) {
    let usage;
    try {
      usage = JSON.parse(row.usage);
    } catch {
      continue;
    }
    if (!usage || typeof usage !== "object") continue;
    const delivered = String(usage.model || "").trim() || String(row.model || "").trim();
    if (!isOpus5(delivered)) continue;
    if (usage.billingWaived || !(usage.cost > 0)) continue;
    const outputChars = finite(usage.savedOutputChars);
    const inputTokens = finite(usage.apiInputTokens);
    const mainApiRawCostKrw = finite(usage.mainApiRawCostKrw);
    const widgetApiRawCostKrw = finite(usage.statusWidgetExtract && usage.statusWidgetExtract.apiRawCostKrw);
    const cacheReadTokens = finite(usage.cacheReadTokens);
    const cacheWriteTokens = finite(usage.cacheWriteTokens);
    if (
      outputChars == null ||
      inputTokens == null ||
      mainApiRawCostKrw == null ||
      widgetApiRawCostKrw == null ||
      cacheReadTokens == null ||
      cacheWriteTokens == null
    ) {
      continue;
    }
    turns.push({
      outputChars,
      inputTokens,
      apiCostKrw: Math.max(0, mainApiRawCostKrw) + Math.max(0, widgetApiRawCostKrw),
      oldCharge: usage.cost,
      newCharge: newCharge(outputChars, inputTokens),
      cold: cacheWriteTokens > COLD_WRITE,
    });
  }
  return { scanned: rows.length, turns };
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const { scanned, turns } = loadTurns(db);
    const last20 = turns.slice(0, 20);
    const last50 = turns.slice(0, 50);
    const last100 = turns.slice(0, 100);
    const available = windowStats(turns);
    const verdict = judge(available.newRealizedMarginPct, turns.length);
    const report = {
      dbWrite: false,
      llmCalls: 0,
      priceAutoChanged: false,
      modelFilter: OPUS5,
      dbPath: DB_PATH,
      scannedAssistantRows: scanned,
      availableSample: turns.length,
      last20: windowStats(last20),
      last50: windowStats(last50),
      last100: windowStats(last100),
      volatility: volatility(turns),
      verdict: verdict.verdict,
      note: verdict.note,
    };
    if (verdict.verdict === "FAIL_MARGIN_LOW") {
      report.lowMarginOutputTiers = lowMarginTiers(turns);
    }
    if (verdict.verdict === "PASS_MARGIN_HIGH") {
      report.decreaseCandidatesOnly = decreaseCandidates(turns);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    db.close();
  }
}

main();
