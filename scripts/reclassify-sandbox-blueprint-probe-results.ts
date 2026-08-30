/**
 * Reclassify frozen sandbox Blueprint probe results without new provider calls.
 * Run: node --conditions=react-server --import tsx scripts/reclassify-sandbox-blueprint-probe-results.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateLegacyProbeResultsWithTimestamp } from "../src/lib/trpg/sandboxBlueprintProbeMetrics";

const probePath = join("docs/audits/trpg-sandbox-blueprint-quality-probe/probe-results.json");
const raw = JSON.parse(readFileSync(probePath, "utf8")) as {
  runs: Array<Record<string, unknown>>;
  generatedAt?: string;
};

const summary = migrateLegacyProbeResultsWithTimestamp(raw);
writeFileSync(probePath, JSON.stringify(summary, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      totalProviderRuns: summary.totalProviderRuns,
      successfulParsedBlueprints: summary.successfulParsedBlueprints,
      transportFailures: summary.transportFailures,
      semanticBlueprintRejects: summary.semanticBlueprintRejects,
      primaryWorldEndToEndPassRate: summary.primaryWorldEndToEndPassRate,
      primaryParsedBlueprintAcceptanceRate: summary.primaryParsedBlueprintAcceptanceRate,
    },
    null,
    2
  )
);
