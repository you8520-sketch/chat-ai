/**
 * Peak input pressure + paid-memory turn price audit — zero provider generation calls.
 * Usage: npx tsx scripts/audit-paid-memory-prompt-cost.ts
 */
import Module from "module";
import fs from "node:fs";
import path from "node:path";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

const PRODUCTION_SHA = "d593069fdaf476bfb6d547d675034925e8175e96";
const ORIGIN_MAIN_SHA = "73d563496eb6183cbc8bfdf514882cdcacee8d9c";

async function main() {
  const { loadEnvLocal } = await import("./load-env-local");
  loadEnvLocal();
  const env = process.env as Record<string, string | undefined>;
  if (!env.NODE_ENV) env.NODE_ENV = "development";

  const { formatPaidMemoryAuditMarkdown, generatePaidMemoryAuditReport } = await import(
    "../src/lib/memory/paid-memory-prompt-cost-audit"
  );

  const report = generatePaidMemoryAuditReport(PRODUCTION_SHA, {
    originMainSha: ORIGIN_MAIN_SHA,
  });
  const markdown = formatPaidMemoryAuditMarkdown(report);
  const outDir = path.join(process.cwd(), "docs", "audit");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "peak-input-turn-price-report.json");
  const mdPath = path.join(outDir, "PEAK_INPUT_TURN_PRICE_AUDIT.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, markdown, "utf8");
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`PROVIDER_GENERATION_CALLS=${report.providerGenerationCalls}`);
  console.log(`MATRIX_ROWS=${report.matrix.length}`);
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    console.log(
      `${modelId}: MAX_PAID=${s.maxPaidCurrentInput} MAX_G15=${s.maxPaidGlobal15Input} TURN_AMP=${s.paidCurrentTurnPriceAmplification.toFixed(3)}x G15_AMP=${s.global15TurnPriceAmplification.toFixed(3)}x`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
