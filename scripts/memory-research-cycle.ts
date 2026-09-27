/**
 * Memory research cycle CLI (GitHub Actions entry point; never run by the
 * production server).
 *
 *   run                 --mode weekly|monthly_deep --ledger <file> --out <dir> --main-sha <sha> [--force]
 *   draft-prs           --packets <out/packets.json> --results <file>
 *   apply-draft-results --ledger <file> --results <file>
 *
 * `run` makes 0 paid provider calls: sources are free metadata APIs under a
 * per-cycle HTTP budget, and the benchmark lab is network-guarded.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatBenchmarkMetricsLine } from "@/lib/memory/memory-rp-benchmark";
import { DEFAULT_HTTP_BUDGET, runResearchCycle, type CycleMode } from "@/lib/memoryResearch/cycle";
import { openDraftPrs } from "@/lib/memoryResearch/draftPr";
import { EXPERIMENT_ADAPTERS } from "@/lib/memoryResearch/experiments";
import { applyDraftPrResults, parseLedger, serializeLedger, type DraftPrResult } from "@/lib/memoryResearch/ledger";
import { computeArchitectureFingerprint } from "@/lib/memoryResearch/ownerMap";
import type { DraftPrPacket } from "@/lib/memoryResearch/prPacket";
import { renderCycleReportMarkdown } from "@/lib/memoryResearch/report";
import { defaultSources, type SourceFetch } from "@/lib/memoryResearch/sources";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function required(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

function writeOutput(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function writeFileEnsuringDir(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

async function run(): Promise<void> {
  const mode = required("mode") as CycleMode;
  if (mode !== "weekly" && mode !== "monthly_deep") throw new Error(`unknown mode ${mode}`);
  const ledgerPath = required("ledger");
  const outDir = required("out");
  const mainSha = required("main-sha");
  const ledger = parseLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null);
  const networkFetch = globalThis.fetch.bind(globalThis);
  const sourceFetch: SourceFetch = (url, init) => networkFetch(url, { headers: init.headers, signal: AbortSignal.timeout(20_000) });

  const { ledger: next, report } = await runResearchCycle(ledger, {
    mode,
    now: new Date(),
    mainSha,
    architectureFingerprint: computeArchitectureFingerprint((p) => readFileSync(p, "utf8")),
    sources: defaultSources(),
    sourceContext: {
      fetch: sourceFetch,
      budget: { limit: Number(process.env.MEMORY_RESEARCH_HTTP_BUDGET ?? DEFAULT_HTTP_BUDGET), used: 0 },
      now: new Date(),
      githubToken: process.env.GITHUB_TOKEN?.trim() || null,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    adapters: EXPERIMENT_ADAPTERS,
    force: process.argv.includes("--force"),
    formatMetricsLine: (s) => formatBenchmarkMetricsLine(s.metrics),
  });

  mkdirSync(join(outDir, "cycles"), { recursive: true });
  writeFileSync(join(outDir, "ledger.json"), serializeLedger(next));
  writeFileSync(join(outDir, "cycles", `${report.cycleKey}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), renderCycleReportMarkdown(report));
  writeFileSync(join(outDir, "packets.json"), `${JSON.stringify(report.draftPrPackets, null, 2)}\n`);
  console.log(renderCycleReportMarkdown(report));
  writeOutput("cycle_key", report.cycleKey);
  writeOutput("cycle_status", report.status);
  writeOutput("accepted_count", String(report.draftPrPackets.length));
}

function draftPrs(): void {
  const packets = JSON.parse(readFileSync(required("packets"), "utf8")) as DraftPrPacket[];
  const results = openDraftPrs(
    packets,
    (command, args) => execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
    writeFileEnsuringDir,
    { tempDir: tmpdir() }
  );
  writeFileSync(required("results"), `${JSON.stringify(results, null, 2)}\n`);
  for (const r of results) console.log(`${r.candidateKey}: ${r.url ?? `FAILED ${r.error}`}`);
}

function applyResults(): void {
  const ledgerPath = required("ledger");
  const resultsPath = required("results");
  const results = existsSync(resultsPath) ? (JSON.parse(readFileSync(resultsPath, "utf8")) as DraftPrResult[]) : [];
  const ledger = applyDraftPrResults(parseLedger(readFileSync(ledgerPath, "utf8")), results);
  writeFileSync(ledgerPath, serializeLedger(ledger));
}

const command = process.argv[2];
if (command === "run") {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (command === "draft-prs") {
  draftPrs();
} else if (command === "apply-draft-results") {
  applyResults();
} else {
  console.error("usage: memory-research-cycle.ts run|draft-prs|apply-draft-results ...");
  process.exit(2);
}
