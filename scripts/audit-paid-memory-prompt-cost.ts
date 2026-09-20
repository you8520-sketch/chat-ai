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

const PRODUCTION_SHA = "bfb097470df6ae0df03611f716330c9413218484";
const ORIGIN_MAIN_SHA = "bfb097470df6ae0df03611f716330c9413218484";

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
    prBehindMain: 0,
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
  console.log(`ROOT_CLASSIFICATION=${report.rootClassification}`);
  console.log(`MATRIX_ROWS=${report.matrix.length}`);
  for (const modelId of report.mainRpModels) {
    const s = report.summaryByModel[modelId];
    if (!s) continue;
    console.log(
      `${modelId}: MEMORY_PEAK_G15=${s.memoryPeakPaidGlobal15MaxInput} ABS_VALID_G15=${s.absoluteValidPaidGlobal15MaxInput} CREATOR100_P=${s.creator100EntryP}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
