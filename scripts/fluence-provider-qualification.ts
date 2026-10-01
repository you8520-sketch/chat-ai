import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildFluencePreparation, runFluenceComparison, type FluenceOffer, type ProbeOperation } from "./lib/fluenceProviderQualification";

async function main() {
  const outputDir = process.env.FLUENCE_QUALIFICATION_OUTPUT_DIR?.trim() || "output/fluence-provider-qualification";
  const offerFile = process.env.FLUENCE_QUALIFICATION_OFFER_FILE?.trim();
  // Offline preparation is the default. No auto-run based on credential presence.
  const report = offerFile
    ? await runFluenceComparison({
        offer: JSON.parse(readFileSync(offerFile, "utf8")) as FluenceOffer,
        operation: (process.env.FLUENCE_QUALIFICATION_OPERATION || "generation") as ProbeOperation,
      })
    : buildFluencePreparation();
  let json = JSON.stringify({
    ...report,
    executedSourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    auditMainSha: execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim(),
    sourceTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  }, null, 2);
  for (const name of ["FLUENCE_BENCHMARK_API_KEY", "OPENROUTER_SUPPLY_BENCHMARK_API_KEY", "CHEAPER_INFERENCE_BENCHMARK_API_KEY"]) {
    const value = process.env[name];
    if (value) json = json.replaceAll(value, "[REDACTED]");
  }
  json = json.replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "report.json"), json + "\n", "utf8");
  writeFileSync(join(outputDir, "README.md"), `# Fluence provider qualification\n\nStatus: **${report.status}**\n\nProvider calls: ${report.providerCalls}. Production route changes: 0.\n\nRaw outputs and evidence are in report.json. No RP quality score, production activation, or pricing/ledger writes. Four successful transport calls do not establish human RP approval, adult permission, or 7/30-day price stability.\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, providerCalls: report.providerCalls, outputDir }));
  if (report.status === "QUALIFICATION_FAILED") process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Provider/config exceptions must not echo secrets or private prompt payloads.
  const reason = error instanceof Error && /^[a-z_]+(?::[a-z_,]+)?$/.test(error.message)
    ? error.message : "contract_or_transport_error";
  console.error(JSON.stringify({ status: "ROOT_CAUSE_UNCONFIRMED", providerCalls: null, reason }));
  process.exitCode = 1;
});
