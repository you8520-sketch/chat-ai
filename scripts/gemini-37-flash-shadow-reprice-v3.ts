/**
 * Shadow-reprice recorded Gemini 3.7 Flash T1–T30 with V3 prices.
 * No LLM calls. T11 excluded from valid aggregates.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-shadow-reprice-v3.ts
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
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing-v3");
const KRW_PER_POINT = 1;
const EXPECTED_VALID_COST = 965.024;
const EXPECTED_V2_REVENUE = 1841;
const EXPECTED_V3_REVENUE = 2201;
const T21_T30_EXPECTED_V3: Record<string, number> = {
  T21: 86,
  T22: 81,
  T23: 81,
  T24: 102,
  T25: 102,
  T26: 113,
  T27: 113,
  T28: 118,
  T29: 129,
  T30: 134,
};

type RecordedTurn = {
  turn: string;
  apiInputTokens: number;
  billedOutputTokens: number;
  apiRawCostKrw: number;
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
function marginPct(revenueP: number, costKrw: number): number | null {
  if (revenueP <= 0) return null;
  return round1((1 - costKrw / (revenueP * KRW_PER_POINT)) * 100);
}

function judgement(margin: number | null): string {
  if (margin == null) return "n/a";
  if (margin < 50) return "TOO_LOW";
  if (margin < 52) return "TOO_LOW";
  if (margin < 55) return "ACCEPTABLE_LOW";
  if (margin <= 60) return "PASS";
  if (margin <= 63) return "ACCEPTABLE_HIGH";
  return "TOO_HIGH";
}

function loadTurns(): RecordedTurn[] {
  const t20 = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "RUNTIME_T20.json"), "utf8")
  ) as { t1t20: RecordedTurn[] };
  const t30 = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "RUNTIME_T30.json"), "utf8")
  ) as { t21t30: RecordedTurn[] };
  if (!Array.isArray(t20.t1t20) || t20.t1t20.length !== 20) {
    throw new Error("Expected 20 recorded turns in RUNTIME_T20.json");
  }
  if (!Array.isArray(t30.t21t30) || t30.t21t30.length !== 10) {
    throw new Error("Expected 10 recorded turns in RUNTIME_T30.json");
  }
  return [...t20.t1t20, ...t30.t21t30];
}

function v2Points(input: number, billedOut: number): number {
  const breakdown = computeGemini37FlashUserChargeBreakdown({
    inputTokens: input,
    billedOutputTokens: billedOut,
  });
  return (
    breakdown.basePoints +
    breakdown.inputSurchargePoints +
    breakdown.outputSurchargePoints
  );
}

function main() {
  const all = loadTurns();
  const rows = all.map((r) => {
    const v3 = computeGemini37FlashUserChargeBreakdown({
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
    const incomplete = Boolean(r.streamIncomplete) || r.turn === "T11";
    const v2P = incomplete ? owner.finalUserPoints : v2Points(r.apiInputTokens, r.billedOutputTokens);
    const v3P = incomplete ? owner.finalUserPoints : v3.totalPoints;
    const expectedV3 = T21_T30_EXPECTED_V3[r.turn];
    return {
      turn: r.turn,
      input: r.apiInputTokens,
      billedOut: r.billedOutputTokens,
      v2P,
      v3P,
      v3ComputedP: v3.totalPoints,
      longContextSurcharge: v3.longContextSurchargePoints,
      actualApiKrw: r.apiRawCostKrw,
      v2Margin: marginPct(v2P, r.apiRawCostKrw),
      v3Margin: marginPct(v3P, r.apiRawCostKrw),
      streamIncomplete: incomplete,
      waived: owner.waiverReason != null,
      waiverReason: owner.waiverReason,
      expectedV3: expectedV3 ?? null,
      expectedV3Match: expectedV3 == null ? null : expectedV3 === v3P,
    };
  });

  const turnNumber = (turn: string): number => Number(turn.replace(/^T/i, "")) || 0;
  const valid = rows.filter((r) => !r.streamIncomplete);
  const t21t30 = valid.filter((r) => turnNumber(r.turn) >= 21);
  const v2Revenue = valid.reduce((s, r) => s + r.v2P, 0);
  const v3Revenue = valid.reduce((s, r) => s + r.v3P, 0);
  const apiRawCost = round3(valid.reduce((s, r) => s + r.actualApiKrw, 0));
  const v2Margin = marginPct(v2Revenue, apiRawCost);
  const v3Margin = marginPct(v3Revenue, apiRawCost);
  const t11 = rows.find((r) => r.turn === "T11");
  const mismatches = t21t30.filter((r) => r.expectedV3Match === false);

  const aggregate = {
    validTurns: valid.length,
    excluded: rows.filter((r) => r.streamIncomplete).map((r) => r.turn),
    apiRawCost,
    expectedValidCost: EXPECTED_VALID_COST,
    costDeltaVsExpected: round3(apiRawCost - EXPECTED_VALID_COST),
    v2Revenue,
    expectedV2Revenue: EXPECTED_V2_REVENUE,
    v2RevenueDelta: v2Revenue - EXPECTED_V2_REVENUE,
    v2RealizedMarginPct: v2Margin,
    v3Revenue,
    expectedV3Revenue: EXPECTED_V3_REVENUE,
    v3RevenueDelta: v3Revenue - EXPECTED_V3_REVENUE,
    v3RealizedMarginPct: v3Margin,
    judgement: judgement(v3Margin),
    t21t30ExpectedMatches: mismatches.length === 0,
    t21t30Mismatches: mismatches.map((r) => ({
      turn: r.turn,
      expected: r.expectedV3,
      actual: r.v3P,
    })),
    t11FinalUserPoints: t11?.v3P ?? null,
    t11ComputedPoints: t11?.v3ComputedP ?? null,
    t11Waived: t11?.waived ?? false,
  };

  const md = `# Gemini 3.7 Flash V3 shadow reprice

No LLM calls. Valid T1–T30 exclude T11. V2 table unchanged; V3 adds long-context surcharge after 75K input.

## A. V2 → V3 29-turn shadow

| Turn | input | billedOut | V2 P | long | V3 P | actual API KRW | V2 margin | V3 margin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${rows
  .map((r) => {
    const note = r.streamIncomplete ? " (excl, incomplete)" : "";
    return `| ${r.turn}${note} | ${r.input} | ${r.billedOut} | ${r.v2P} | ${r.longContextSurcharge} | ${r.v3P} | ${r.actualApiKrw} | ${r.v2Margin ?? "n/a"} | ${r.v3Margin ?? "n/a"} |`;
  })
  .join("\n")}

## B. V3 rolling margin

| metric | value |
|---|---:|
| valid turns | ${aggregate.validTurns} |
| API raw cost | ${aggregate.apiRawCost} KRW |
| expected cost | ${aggregate.expectedValidCost} KRW |
| cost delta | ${aggregate.costDeltaVsExpected} |
| V2 revenue | ${aggregate.v2Revenue}P |
| V2 margin | ${aggregate.v2RealizedMarginPct}% |
| V3 revenue | ${aggregate.v3Revenue}P |
| expected V3 revenue | ${aggregate.expectedV3Revenue}P |
| V3 revenue delta | ${aggregate.v3RevenueDelta} |
| V3 rolling margin | ${aggregate.v3RealizedMarginPct}% |
| judgement | ${aggregate.judgement} |

## C. T21–T30 V3 prices

| Turn | input | billedOut | expected | V3 P | match | V3 margin |
|---|---:|---:|---:|---:|---|---:|
${t21t30
  .map(
    (r) =>
      `| ${r.turn} | ${r.input} | ${r.billedOut} | ${r.expectedV3} | ${r.v3P} | ${r.expectedV3Match} | ${r.v3Margin} |`
  )
  .join("\n")}

## D–F notes

- 75K boundary and V3 fixtures are unit-tested.
- competitor 22947/3897 remains 60P.
- T11 computed=${t11?.v3ComputedP}P, final owner=${t11?.v3P}P, waived=${t11?.waived}.

price auto-change = forbidden
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "SHADOW_V3.md"), md);
  fs.writeFileSync(
    path.join(OUT_DIR, "SHADOW_V3.json"),
    `${JSON.stringify({ aggregate, rows }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(ARTIFACT_DIR, "SHADOW_V3.md"), md);
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "SHADOW_V3.json"),
    `${JSON.stringify({ aggregate, rows }, null, 2)}\n`
  );
  console.log(JSON.stringify(aggregate, null, 2));
}

main();
