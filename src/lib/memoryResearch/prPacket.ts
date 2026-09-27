/**
 * Draft PR evidence packet for an ACCEPTED candidate. Raw metrics and evidence
 * only — no composite score; the reviewer decides.
 */
import { formatBenchmarkMetricsLine } from "@/lib/memory/memory-rp-benchmark";
import type { ExperimentAdapter } from "@/lib/memoryResearch/experiments";
import type { GateResult, LabRunSummary } from "@/lib/memoryResearch/gates";
import { MEMORY_OWNER_MAP } from "@/lib/memoryResearch/ownerMap";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

export const PACKET_REQUIRED_SECTIONS = [
  "Source / research links",
  "Candidate identity / version",
  "Why it is relevant",
  "Baseline evidence",
  "Experiment evidence",
  "Quality delta",
  "False-memory / stale-state delta",
  "Token / cost / latency delta",
  "OWNER MAP",
  "SYSTEM DELTA",
  "Regression risks",
  "Cleanup / removal candidates",
  "Exact main / head",
] as const;

export const HEAD_PLACEHOLDER = "{{HEAD_SHA}}";

export type DraftPrPacket = {
  candidateKey: string;
  version: string | null;
  cycleKey: string;
  mainSha: string;
  decision: "ACCEPTED_QUALITY_GAIN";
  branch: string;
  title: string;
  /** Contains HEAD_PLACEHOLDER until the Draft PR commit exists. */
  body: string;
};

function fmt(v: number | null): string {
  if (v === null) return "null";
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

export function slugForCandidate(candidateKey: string): string {
  return candidateKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function list(items: readonly string[]): string {
  return items.length > 0 ? items.map((x) => `- ${x}`).join("\n") : "- (none)";
}

export function buildDraftPrPacket(input: {
  candidate: ResearchCandidate;
  adapter: ExperimentAdapter;
  gate: GateResult;
  baseline: LabRunSummary;
  experiment: LabRunSummary;
  cycleKey: string;
  mainSha: string;
}): DraftPrPacket {
  const { candidate, adapter, gate, baseline, experiment, cycleKey, mainSha } = input;
  if (gate.decision !== "ACCEPTED_QUALITY_GAIN") {
    throw new Error(`Draft PR packets are ACCEPTED-only (got ${gate.decision})`);
  }
  const d = adapter.architectureDelta;
  const e = gate.efficiency;
  const qualityRows = gate.comparisons
    .map((c) => `| ${c.key} | ${fmt(c.baseline)} | ${fmt(c.candidate)} | ${fmt(c.delta)} | ${c.verdict}${c.note ? ` (${c.note})` : ""} |`)
    .join("\n");
  const safetyRows = gate.comparisons
    .filter((c) => ["falseInjectionRate", "falseMemoryRate", "irrelevantInjectionRate", "staleStateRecallRate", "correctionSupersessionAccuracy"].includes(c.key))
    .map((c) => `| ${c.key} | ${fmt(c.baseline)} | ${fmt(c.candidate)} | ${fmt(c.delta)} |`)
    .join("\n");
  const owners = candidate.applicableOwners
    .map((id) => `| ${id} | ${MEMORY_OWNER_MAP[id].responsibility} | ${MEMORY_OWNER_MAP[id].paths.map((p) => `\`${p}\``).join(", ")} |`)
    .join("\n");
  const notComparable = gate.comparisons.filter((c) => !c.comparable).map((c) => c.key);

  const body = `> Automated Memory Improvement System — Draft PR evidence packet. **Not auto-merged.** Implementation of the accepted technique in the canonical owner is pending human/GPT review of this evidence.

## Source / research links
- ${candidate.sourceUrl}
- Discovered: ${candidate.discoveredAt} (source: ${candidate.sourceKind})

## Candidate identity / version
- candidateKey: \`${candidate.candidateKey}\`
- title: ${candidate.title}
- version: \`${candidate.version ?? "unversioned"}\`
- experiment adapter: \`${adapter.candidateKey}@${adapter.adapterVersion}\` → target owner \`${adapter.targetOwner}\`
- category: ${candidate.category}
- cycle: \`${cycleKey}\`

## Why it is relevant
- Claimed advantage: ${candidate.claimedAdvantage || "(none stated)"}
- Adapter: ${adapter.description}
- Gate reason: ${gate.reason}
- Flipped known gaps: ${gate.flippedKnownGaps.length > 0 ? gate.flippedKnownGaps.map((g) => `\`${g}\``).join(", ") : "(none)"}

## Baseline evidence
Current main (\`${baseline.label}\`), deterministic benchmark, network-guarded:
\`\`\`
${formatBenchmarkMetricsLine(baseline.metrics)}
evaluatedTurns=${baseline.evaluatedTurns} promptTokensInjected=${baseline.promptTokensInjected} http=${baseline.httpCallsObserved} invariantViolations=${baseline.invariantViolations.length}
\`\`\`

## Experiment evidence
Candidate arm (\`${experiment.label}\`), same cases, same metric semantics:
\`\`\`
${formatBenchmarkMetricsLine(experiment.metrics)}
evaluatedTurns=${experiment.evaluatedTurns} promptTokensInjected=${experiment.promptTokensInjected} http=${experiment.httpCallsObserved} embedCalls=${JSON.stringify(experiment.embeddingCalls)} invariantViolations=${experiment.invariantViolations.length}
\`\`\`

## Quality delta
| metric | baseline | candidate | delta | verdict |
|---|---|---|---|---|
${qualityRows}

## False-memory / stale-state delta
| metric | baseline | candidate | delta |
|---|---|---|---|
${safetyRows}

## Token / cost / latency delta
| item | value | source |
|---|---|---|
| prompt tokens / turn | ${fmt(e.measured.promptTokenDeltaPerTurn)} | MEASURED (estimateTokens) |
| HTTP calls / turn (lab) | ${fmt(e.measured.httpCallsPerTurnDelta)} | MEASURED (network guard) |
| embedding query calls / turn (lab) | ${fmt(e.measured.embeddingCallsPerTurnDelta)} | MEASURED |
| index embedding calls (lab run) | ${fmt(e.measured.indexEmbeddingCallsDelta)} | MEASURED |
| lab wall-clock ms (run) | ${fmt(e.measured.wallClockMsDelta)} | MEASURED (noisy) |
| provider calls / turn (prod) | ${fmt(e.declared.providerCallsPerTurn)} | DECLARED |
| embedding calls / turn (prod) | ${fmt(e.declared.embeddingCallsPerTurn)} | DECLARED |
| p95 latency ms / turn (prod) | ${fmt(e.declared.p95LatencyMsPerTurn)} | DECLARED |
| cost USD / 1k turns (prod) | ${fmt(e.declared.costUsdPer1kTurns)} | DECLARED |
| storage bytes / fact | ${fmt(e.declared.storageBytesPerFact)} | DECLARED |
| background calls / sealed batch | ${fmt(e.declared.backgroundCallsPerSealedBatch)} | DECLARED |

## OWNER MAP
| owner | responsibility | canonical path(s) |
|---|---|---|
${owners}

## SYSTEM DELTA
- BEFORE: ${d.before}
- PROPOSED: ${d.proposed}
- AFTER: ${d.after}
- REMOVED:
${list(d.removed)}
- NEW: db=${JSON.stringify(d.newDb)} flags=${JSON.stringify(d.newFlags)} providers=${JSON.stringify(d.newProviders)} dependencies=${JSON.stringify(d.newDependencies)} schedulers=${JSON.stringify(d.newSchedulers)}
- COMPLEXITY DELTA: owners ${d.ownerCountDelta >= 0 ? "+" : ""}${d.ownerCountDelta}, runtime paths/turn ${d.runtimePathDelta >= 0 ? "+" : ""}${d.runtimePathDelta}

## Regression risks
- Deterministic fixtures + adapter embedder; production model quality may differ (DECLARED rows are estimates).
- Metrics not comparable this run: ${notComparable.length > 0 ? notComparable.join(", ") : "(none)"}
- Baseline hits lost: ${gate.brokenPositiveCases.length > 0 ? gate.brokenPositiveCases.join(", ") : "(none)"}
- GITHUB_TOKEN-created PRs do not trigger \`pull_request\` workflows: re-run memory CI on this branch before review.

## Cleanup / removal candidates
${list([...d.removed, `lab adapter \`${adapter.candidateKey}\` in src/lib/memoryResearch/experiments.ts once production integration lands (or on rejection)`])}

## Exact main / head
- main: \`${mainSha}\`
- head: \`${HEAD_PLACEHOLDER}\`
`;

  return {
    candidateKey: candidate.candidateKey,
    version: candidate.version,
    cycleKey,
    mainSha,
    decision: "ACCEPTED_QUALITY_GAIN",
    branch: `memory-research/accepted-${slugForCandidate(candidate.candidateKey)}-${slugForCandidate(candidate.version ?? "unversioned").slice(0, 24)}-${slugForCandidate(cycleKey).slice(0, 32)}`,
    title: `[memory-research] ACCEPTED evidence: ${candidate.title} ${candidate.version ?? ""}`.trim(),
    body,
  };
}

/** Returns the list of missing/empty required sections (empty list = complete). */
export function missingPacketSections(body: string): string[] {
  const missing: string[] = [];
  for (const section of PACKET_REQUIRED_SECTIONS) {
    const re = new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
    const m = body.match(re);
    if (!m || m[1]!.trim() === "") missing.push(section);
  }
  return missing;
}
