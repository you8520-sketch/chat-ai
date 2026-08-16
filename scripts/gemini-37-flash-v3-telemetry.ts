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
  AUTO_PRICE_CHANGE,
  PRICE_RETUNE,
  V3_PRODUCTION_CANDIDATE,
  aggregateGemini37FlashTelemetry,
  isGemini37ProductionValidated,
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

  const productionValidated = isGemini37ProductionValidated(
    productionAgg.overall.validSampleCount
  );
  const displayBlock = (
    agg: ReturnType<typeof aggregateGemini37FlashTelemetry>
  ) => {
    const last20 = agg.rolling.find((r) => r.window === "last20");
    const last50 = agg.rolling.find((r) => r.window === "last50");
    const last100 = agg.rolling.find((r) => r.window === "last100");
    return [
      `- last20: n=${last20?.validSampleCount ?? 0}, margin ${last20?.realizedGrossMarginPct ?? "n/a"}%`,
      `- last50: n=${last50?.validSampleCount ?? 0}, margin ${last50?.realizedGrossMarginPct ?? "n/a"}%`,
      `- last100: n=${last100?.validSampleCount ?? 0}, margin ${last100?.realizedGrossMarginPct ?? "n/a"}%`,
      `- <=75K margin: ${agg.shortContext.realizedGrossMarginPct ?? "n/a"}%`,
      `- >75K margin: ${agg.longContext.realizedGrossMarginPct ?? "n/a"}%`,
      `- >75K turn share: ${agg.longContext.turnSharePct ?? "n/a"}%`,
      `- >75K revenue share: ${agg.longContext.revenueSharePct ?? "n/a"}%`,
      `- overall rolling margin: ${agg.overall.realizedGrossMarginPct ?? "n/a"}%`,
    ].join("\n");
  };

  return `# Gemini 3.7 Flash V3 telemetry

Telemetry-only. V3 numbers frozen. No LLM. No auto price change.

\`krwPerUsd = ${krwPerUsd}\`
cheap/expensive = actual API KRW >= 70% of catalog list on apiInput+billedOutput.

## Freeze

- V3_PRODUCTION_CANDIDATE=${V3_PRODUCTION_CANDIDATE}
- PRICE_RETUNE=${PRICE_RETUNE}
- AUTO_PRICE_CHANGE=${AUTO_PRICE_CHANGE}
- PRODUCTION_VALIDATED=${productionValidated}
- PRODUCTION_VERDICT=${productionAgg.verdict}

n=0 production receipts is not a price failure. The model has not received paid traffic yet.

## Production paid receipts

SELECT-only from production \`messages.usage\`.

- total messages: ${production.totalMessages}
- usage messages: ${production.usageMessages}
- gemini-3.7-flash messages: ${production.gemini37Messages}
- paid gemini-3.7-flash receipts: ${production.paidGemini37Messages}

${bandTable(productionAgg)}

${rollingTable(productionAgg)}

${displayBlock(productionAgg)}

production verdict: **${productionAgg.verdict}**
PRODUCTION_VALIDATED=${productionValidated}

## Live shadow corpus (T1–T30 valid, T11 excluded)

This is the only Gemini 3.7 corpus with actual API cost. It is not a production user receipt set.

${bandTable(liveAgg)}

${rollingTable(liveAgg)}

${displayBlock(liveAgg)}

<=75K: n=${liveAgg.shortContext.turnCount}, margin ${liveAgg.shortContext.realizedGrossMarginPct}%
>75K: n=${liveAgg.longContext.turnCount}, turn share ${liveAgg.longContext.turnSharePct}%, revenue ${liveAgg.longContext.revenueP}P (${liveAgg.longContext.revenueSharePct}%), cost ${liveAgg.longContext.rawApiCostKrw} KRW, margin ${liveAgg.longContext.realizedGrossMarginPct}%

live-corpus verdict: **${liveAgg.verdict}**

Owner is overall rolling margin only. last20 / last50 / last100 and band margins are display-only.
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
  const productionValidated = isGemini37ProductionValidated(
    productionAgg.overall.validSampleCount
  );
  const payload = {
    krwPerUsd: LIVE_CORPUS_KRW_PER_USD,
    freeze: {
      V3_PRODUCTION_CANDIDATE,
      PRICE_RETUNE,
      AUTO_PRICE_CHANGE,
      PRODUCTION_VALIDATED: productionValidated,
      PRODUCTION_VERDICT: productionAgg.verdict,
    },
    production,
    productionTelemetry: {
      verdict: productionAgg.verdict,
      bands: productionAgg.bands,
      rolling: productionAgg.rolling,
      shortContext: productionAgg.shortContext,
      longContext: productionAgg.longContext,
      overall: productionAgg.overall,
    },
    liveShadowTelemetry: {
      verdict: liveAgg.verdict,
      bands: liveAgg.bands,
      rolling: liveAgg.rolling,
      shortContext: liveAgg.shortContext,
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
        V3_PRODUCTION_CANDIDATE,
        PRICE_RETUNE,
        AUTO_PRICE_CHANGE,
        PRODUCTION_VALIDATED: productionValidated,
        PRODUCTION_VERDICT: productionAgg.verdict,
        productionPaid: production.paidGemini37Messages,
        liveN: liveAgg.overall.validSampleCount,
        liveOverallMargin: liveAgg.overall.realizedGrossMarginPct,
        liveShortContext: liveAgg.shortContext,
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
