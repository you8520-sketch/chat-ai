/**
 * Gemini 3.7 Flash V3 telemetry-only.
 * Does not change V3 numbers. No LLM calls.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-v3-telemetry.ts
 */
import Module from "module";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import {
  aggregateGemini37FlashTelemetry,
  type Gemini37FlashTelemetryReceipt,
} from "../src/lib/gemini37FlashPricingTelemetry";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";

const LIVE_CORPUS_KRW_PER_USD = 1443.158;

const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-pricing");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing-v3");

type ShadowRow = {
  turn: string;
  input: number;
  billedOut: number;
  actualApiKrw: number;
  streamIncomplete?: boolean;
};

function loadLiveShadowCorpus(): Gemini37FlashTelemetryReceipt[] {
  const shadow = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "SHADOW_V3.json"), "utf8")
  ) as { rows: ShadowRow[] };
  return shadow.rows.map((row) => ({
    id: row.turn,
    apiInputTokens: row.input,
    billedOutputTokens: row.billedOut,
    actualApiCostKrw: row.actualApiKrw,
    finishReason: row.streamIncomplete ? null : "stop",
    streamIncomplete: Boolean(row.streamIncomplete),
    waived: Boolean(row.streamIncomplete),
  }));
}

function loadProductionExtract(): {
  extractedAt: string;
  totalMessages: number;
  usageMessages: number;
  gemini37Messages: number;
  paidGemini37Messages: number;
  receipts: Gemini37FlashTelemetryReceipt[];
} {
  const file = path.join(OUT_DIR, "PRODUCTION_G37_RECEIPTS.json");
  if (!fs.existsSync(file)) {
    return {
      extractedAt: new Date().toISOString(),
      totalMessages: 0,
      usageMessages: 0,
      gemini37Messages: 0,
      paidGemini37Messages: 0,
      receipts: [],
    };
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as {
    extractedAt: string;
    totalMessages: number;
    usageMessages: number;
    gemini37Messages: number;
    paidGemini37Messages: number;
    receipts: Gemini37FlashTelemetryReceipt[];
  };
}

function renderReport(opts: {
  production: ReturnType<typeof loadProductionExtract>;
  productionAgg: ReturnType<typeof aggregateGemini37FlashTelemetry>;
  liveAgg: ReturnType<typeof aggregateGemini37FlashTelemetry>;
  krwPerUsd: number;
}): string {
  const { production, productionAgg, liveAgg, krwPerUsd } = opts;
  const bandTable = (agg: ReturnType<typeof aggregateGemini37FlashTelemetry>) =>
    [
      "| band | n | revenueP | rawKRW | margin% | avgP | avgIn | avgOut | cheap | expensive |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...agg.bands.map(
        (b) =>
          `| ${b.band} | ${b.validSampleCount} | ${b.revenueP} | ${b.rawApiCostKrw} | ${b.realizedGrossMarginPct ?? "n/a"} | ${b.avgUserP ?? "n/a"} | ${b.avgApiInputTokens ?? "n/a"} | ${b.avgBilledOutputTokens ?? "n/a"} | ${b.cheapUpstreamCount} | ${b.expensiveUpstreamCount} |`
      ),
    ].join("\n");
  const rollingTable = (agg: ReturnType<typeof aggregateGemini37FlashTelemetry>) =>
    [
      "| window | n | revenueP | rawKRW | margin% |",
      "|---|---:|---:|---:|---:|",
      ...agg.rolling.map(
        (r) =>
          `| ${r.window} | ${r.validSampleCount} | ${r.revenueP} | ${r.rawApiCostKrw} | ${r.realizedGrossMarginPct ?? "n/a"} |`
      ),
    ].join("\n");

  return `# Gemini 3.7 Flash V3 telemetry

Telemetry-only. V3 numbers unchanged. No LLM. No auto price change.

\`krwPerUsd = ${krwPerUsd}\`
cheap/expensive = actual API KRW >= 70% of catalog list on apiInput+billedOutput.

## Production paid receipts

SELECT-only from production \`messages.usage\`.

- total messages: ${production.totalMessages}
- usage messages: ${production.usageMessages}
- gemini-3.7-flash messages: ${production.gemini37Messages}
- paid gemini-3.7-flash receipts: ${production.paidGemini37Messages}

${bandTable(productionAgg)}

${rollingTable(productionAgg)}

>75K turn share: ${productionAgg.longContext.turnSharePct ?? "n/a"}%
>75K revenue share: ${productionAgg.longContext.revenueSharePct ?? "n/a"}%
production verdict: **${productionAgg.verdict}**

## Live shadow corpus (T1–T30 valid, T11 excluded)

This is the only Gemini 3.7 corpus with actual API cost. It is not a production user receipt set.

${bandTable(liveAgg)}

${rollingTable(liveAgg)}

>75K: n=${liveAgg.longContext.turnCount}, turn share ${liveAgg.longContext.turnSharePct}%, revenue ${liveAgg.longContext.revenueP}P (${liveAgg.longContext.revenueSharePct}%), cost ${liveAgg.longContext.rawApiCostKrw} KRW, margin ${liveAgg.longContext.realizedGrossMarginPct}%

live-corpus verdict: **${liveAgg.verdict}**

Owner is aggregate rolling margin, not per-turn or per-band 55–60%.
price auto-change = forbidden
`;
}

function main() {
  const production = loadProductionExtract();
  const productionAgg = aggregateGemini37FlashTelemetry(production.receipts, {
    krwPerUsd: getEffectiveKrwPerUsd(),
  });
  const liveAgg = aggregateGemini37FlashTelemetry(loadLiveShadowCorpus(), {
    krwPerUsd: LIVE_CORPUS_KRW_PER_USD,
  });
  const report = renderReport({
    production,
    productionAgg,
    liveAgg,
    krwPerUsd: LIVE_CORPUS_KRW_PER_USD,
  });
  const payload = {
    krwPerUsd: LIVE_CORPUS_KRW_PER_USD,
    production,
    productionTelemetry: {
      verdict: productionAgg.verdict,
      bands: productionAgg.bands,
      rolling: productionAgg.rolling,
      longContext: productionAgg.longContext,
      overall: productionAgg.overall,
    },
    liveShadowTelemetry: {
      verdict: liveAgg.verdict,
      bands: liveAgg.bands,
      rolling: liveAgg.rolling,
      longContext: liveAgg.longContext,
      overall: liveAgg.overall,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "TELEMETRY_V3.md"), report);
  fs.writeFileSync(path.join(OUT_DIR, "TELEMETRY_V3.json"), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "TELEMETRY_V3.md"), report);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "TELEMETRY_V3.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        productionPaid: production.paidGemini37Messages,
        productionVerdict: productionAgg.verdict,
        liveN: liveAgg.overall.validSampleCount,
        liveOverallMargin: liveAgg.overall.realizedGrossMarginPct,
        liveLongContext: liveAgg.longContext,
        liveRolling: liveAgg.rolling,
        liveVerdict: liveAgg.verdict,
      },
      null,
      2
    )
  );
}

main();
