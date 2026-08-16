/**
 * Shadow-reprice recorded Gemini 3.7 Flash T1–T20 with V2 prices.
 * No LLM calls. T11 excluded from valid aggregates.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-shadow-reprice-v2.ts
 */
import Module from "module";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { computeGemini37FlashUserChargeBreakdown } from "../src/lib/gemini37FlashPricing";
import { resolveGemini37FlashFinalUserCharge } from "../src/lib/points";

const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-pricing");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing-v2");
const KRW_PER_POINT = 1;
const EXPECTED_VALID_COST = 433.654;

type RecordedTurn = {
  turn: string;
  apiInputTokens: number;
  billedOutputTokens: number;
  apiRawCostKrw: number;
  mainUserCharge: number;
  finalUserCharge: number;
  finishReason: string | null;
  streamIncomplete?: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}
function marginPct(revenueP: number, costKrw: number): number | null {
  if (revenueP <= 0) return null;
  return round1((1 - costKrw / (revenueP * KRW_PER_POINT)) * 100);
}

function main() {
  const runtime = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "RUNTIME_T20.json"), "utf8")
  ) as { t1t20: RecordedTurn[] };
  const all = runtime.t1t20;
  if (!Array.isArray(all) || all.length !== 20) {
    throw new Error("Expected 20 recorded turns in RUNTIME_T20.json");
  }

  const rows = all.map((r) => {
    const v2 = computeGemini37FlashUserChargeBreakdown({
      inputTokens: r.apiInputTokens,
      billedOutputTokens: r.billedOutputTokens,
    });
    const owner = resolveGemini37FlashFinalUserCharge({
      inputTokens: r.apiInputTokens,
      billedOutputTokens: r.billedOutputTokens,
      finishReason: r.finishReason,
      promptTokens: r.apiInputTokens,
      completionTokens: r.billedOutputTokens,
      savedText: "라이크는 복도에서 걸음을 늦추며 렌을 돌아보았다. ".repeat(20),
    });
    const oldP = r.finalUserCharge;
    const v2P = r.streamIncomplete ? owner.finalUserPoints : v2.totalPoints;
    const cost = r.apiRawCostKrw;
    return {
      turn: r.turn,
      input: r.apiInputTokens,
      billedOut: r.billedOutputTokens,
      oldP,
      v2P,
      v2ComputedP: v2.totalPoints,
      actualApiKrw: cost,
      oldMargin: marginPct(oldP, cost),
      v2Margin: marginPct(v2P, cost),
      streamIncomplete: Boolean(r.streamIncomplete),
      waived: owner.waiverReason != null,
      waiverReason: owner.waiverReason,
    };
  });

  const valid = rows.filter((r) => !r.streamIncomplete);
  const oldPs = valid.map((r) => r.oldP).sort((a, b) => a - b);
  const v2Ps = valid.map((r) => r.v2P).sort((a, b) => a - b);
  const oldRevenue = valid.reduce((s, r) => s + r.oldP, 0);
  const v2Revenue = valid.reduce((s, r) => s + r.v2P, 0);
  const apiRawCost = round3(valid.reduce((s, r) => s + r.actualApiKrw, 0));
  const t11 = rows.find((r) => r.turn === "T11");

  const aggregate = {
    validTurns: valid.length,
    excluded: rows.filter((r) => r.streamIncomplete).map((r) => r.turn),
    oldRevenue,
    v2Revenue,
    apiRawCost,
    expectedValidCost: EXPECTED_VALID_COST,
    costDeltaVsExpected: round3(apiRawCost - EXPECTED_VALID_COST),
    oldRealizedMarginPct: marginPct(oldRevenue, apiRawCost),
    v2RealizedMarginPct: marginPct(v2Revenue, apiRawCost),
    avgOldP: round1(oldRevenue / valid.length),
    avgV2P: round1(v2Revenue / valid.length),
    p10Old: round1(percentile(oldPs, 0.1)),
    p50Old: round1(percentile(oldPs, 0.5)),
    p90Old: round1(percentile(oldPs, 0.9)),
    maxOld: oldPs[oldPs.length - 1],
    p10V2: round1(percentile(v2Ps, 0.1)),
    p50V2: round1(percentile(v2Ps, 0.5)),
    p90V2: round1(percentile(v2Ps, 0.9)),
    maxV2: v2Ps[v2Ps.length - 1],
    expectedV2RevenueNear: 1142,
    expectedV2MarginNear: 62,
  };

  const md = `# Gemini 3.7 Flash V2 shadow reprice

No LLM calls. Valid T1–T20 exclude T11. Prices from \`computeGemini37FlashUserChargeBreakdown\`.

## A. V1 → V2 shadow table

| Turn | input | billedOut | old P | V2 P | actual API KRW | old margin | V2 margin |
|---|---:|---:|---:|---:|---:|---:|---:|
${rows
  .map((r) => {
    const note = r.streamIncomplete ? " (excl, incomplete)" : "";
    return `| ${r.turn}${note} | ${r.input} | ${r.billedOut} | ${r.oldP} | ${r.v2P} | ${r.actualApiKrw} | ${r.oldMargin ?? "n/a"} | ${r.v2Margin ?? "n/a"} |`;
  })
  .join("\n")}

T11 computed price function = ${t11?.v2ComputedP ?? "n/a"}P, final owner charge = ${t11?.v2P ?? "n/a"}P, waived = ${t11?.waived ?? false}.

## B. Aggregate (valid 19 turns)

| metric | value |
|---|---:|
| old revenue | ${aggregate.oldRevenue}P |
| V2 revenue | ${aggregate.v2Revenue}P |
| API raw cost | ${aggregate.apiRawCost} KRW |
| expected valid cost | ${aggregate.expectedValidCost} KRW |
| cost delta vs expected | ${aggregate.costDeltaVsExpected} |
| old realized margin | ${aggregate.oldRealizedMarginPct}% |
| V2 realized margin | ${aggregate.v2RealizedMarginPct}% |
| average old P | ${aggregate.avgOldP} |
| average V2 P | ${aggregate.avgV2P} |
| p10 / p50 / p90 old | ${aggregate.p10Old} / ${aggregate.p50Old} / ${aggregate.p90Old} |
| p10 / p50 / p90 V2 | ${aggregate.p10V2} / ${aggregate.p50V2} / ${aggregate.p90V2} |
| max old / V2 | ${aggregate.maxOld} / ${aggregate.maxV2} |

Expected check: V2 revenue ~1142P, V2 margin ~62%. Actual ${aggregate.v2Revenue}P / ${aggregate.v2RealizedMarginPct}%.
price auto-change = forbidden
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "SHADOW_V2.md"), md);
  fs.writeFileSync(path.join(OUT_DIR, "SHADOW_V2.json"), `${JSON.stringify({ aggregate, rows }, null, 2)}\n`);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "SHADOW_V2.md"), md);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "SHADOW_V2.json"), `${JSON.stringify({ aggregate, rows }, null, 2)}\n`);
  console.log(JSON.stringify(aggregate, null, 2));
}

main();
