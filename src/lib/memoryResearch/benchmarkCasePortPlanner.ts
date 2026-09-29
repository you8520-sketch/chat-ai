/**
 * Benchmark Case Port Planner.
 *
 * Converts benchmark-adoption findings into local, bounded implementation
 * plans. It never copies external datasets, runs external judges, changes
 * production memory, or edits the benchmark automatically.
 */
import type {
  BenchmarkAdoptionProposal,
  ExternalBenchmarkAbility,
} from "@/lib/memoryResearch/benchmarkAdoptionBridge";

export type CasePortReadiness =
  | "READY_DETERMINISTIC_FIXTURE"
  | "READY_MUTATION_LIFECYCLE_FIXTURE"
  | "HARNESS_EXTENSION_REQUIRED"
  | "NO_PORT_REQUIRED";

export type BenchmarkCasePortPlan = {
  candidateKey: string;
  sourceVersion: string | null;
  ability: ExternalBenchmarkAbility;
  readiness: CasePortReadiness;
  canonicalOwner: string;
  targetPaths: readonly string[];
  proposedCaseIds: readonly string[];
  reuseMetrics: readonly string[];
  requirements: readonly string[];
  forbidden: readonly string[];
  rationale: string;
};

function noPort(
  proposal: BenchmarkAdoptionProposal,
  rationale: string
): BenchmarkCasePortPlan {
  return {
    candidateKey: proposal.candidateKey,
    sourceVersion: proposal.sourceVersion,
    ability: proposal.ability,
    readiness: "NO_PORT_REQUIRED",
    canonicalOwner: "existing capability group",
    targetPaths: [],
    proposedCaseIds: [],
    reuseMetrics: [],
    requirements: [],
    forbidden: ["duplicate benchmark owner", "external judge import", "external leaderboard score"],
    rationale,
  };
}

export function buildBenchmarkCasePortPlan(
  proposal: BenchmarkAdoptionProposal
): BenchmarkCasePortPlan {
  if (proposal.status === "ALREADY_COVERED") {
    return noPort(
      proposal,
      "The canonical RP-memory benchmark already has deterministic cases for this capability."
    );
  }

  if (proposal.status === "INSUFFICIENT_EVIDENCE" || proposal.ability === "unclassified") {
    return noPort(
      proposal,
      "The external benchmark description is not specific enough to justify a local fixture."
    );
  }

  switch (proposal.ability) {
    case "trajectory_recall":
      return {
        candidateKey: proposal.candidateKey,
        sourceVersion: proposal.sourceVersion,
        ability: proposal.ability,
        readiness: "READY_DETERMINISTIC_FIXTURE",
        canonicalOwner:
          "src/lib/memory/memory-rp-benchmark-suite.ts + src/lib/memory/memory-rp-benchmark.ts",
        targetPaths: [
          "src/lib/memory/memory-rp-benchmark-suite.ts",
          "src/lib/memory/memory-rp-benchmark.ts",
          "src/lib/memory/memory-rp-benchmark.test.ts",
        ],
        proposedCaseIds: [
          "active-expired-commitment-01",
          "persona-update-current-01",
        ],
        reuseMetrics: [
          "candidateRecallAtK",
          "finalRecallAt8",
          "staleStateRecallRate",
          "falseMemoryRate",
          "correctionSupersessionAccuracy",
        ],
        requirements: [
          "Use locally-authored synthetic facts only.",
          "Active-vs-expired commitment must place both plausible states in history and require only the current state.",
          "Persona update must distinguish a legitimate current update from the original mutable state without changing immutable role identity.",
          "Add case IDs to existing raw capability groups; do not create a composite score.",
        ],
        forbidden: [
          "external benchmark conversations",
          "external answer keys",
          "LLM-as-judge",
          "provider calls",
          "new memory owner",
        ],
        rationale:
          "The missing trajectory subcases can be expressed as canonical state/supersession retrieval with existing deterministic metrics.",
      };

    case "forgetting_fidelity":
      return {
        candidateKey: proposal.candidateKey,
        sourceVersion: proposal.sourceVersion,
        ability: proposal.ability,
        readiness: "READY_MUTATION_LIFECYCLE_FIXTURE",
        canonicalOwner:
          "source-mutation invalidation + summary integrity regressions",
        targetPaths: [
          "src/lib/memory/memory-premerge-blockers.test.ts",
          "src/lib/memory/memory-summary-integrity.test.ts",
          "src/lib/memory/memory-source-boundary.test.ts",
        ],
        proposedCaseIds: ["derived-memory-deletion-residue-01"],
        reuseMetrics: [
          "staleStateRecallRate",
          "falseMemoryRate",
        ],
        requirements: [
          "Create source text, derived summary/current-memory evidence, then delete or rewind the source.",
          "Prove stale source-derived content is absent or invalidated across derived memory tiers, not only the raw message row.",
          "Keep the fixture in mutation-lifecycle tests unless it can be represented without faking production deletion semantics.",
        ],
        forbidden: [
          "new forgetting score",
          "copying Memora FAMA",
          "external judge",
          "production cleanup migration",
        ],
        rationale:
          "The gap is lifecycle invalidation across derived tiers, not ordinary retrieval ranking, so the mutation-test owner is the correct harness.",
      };

    case "persona_continuity":
      return {
        candidateKey: proposal.candidateKey,
        sourceVersion: proposal.sourceVersion,
        ability: proposal.ability,
        readiness: "HARNESS_EXTENSION_REQUIRED",
        canonicalOwner: "no deterministic response-behavior owner yet",
        targetPaths: [
          "src/lib/memory/memory-rp-benchmark.ts",
          "src/lib/memory/memory-rp-benchmark-suite.ts",
        ],
        proposedCaseIds: [
          "persona-boundary-retention-01",
          "persona-values-retention-01",
          "persona-style-retention-01",
        ],
        reuseMetrics: ["relationshipRoleConsistency"],
        requirements: [
          "First define a deterministic response-behavior assertion that does not require an LLM judge.",
          "Separate immutable role/boundary/value/style from mutable relationship state.",
          "Prove a local proxy actually measures behavior rather than merely whether a persona fact was retrieved.",
        ],
        forbidden: [
          "claiming fact retrieval equals persona behavior",
          "LLM-as-judge in weekly automation",
          "questionnaire score import",
          "production prompt changes",
        ],
        rationale:
          "The current benchmark measures memory retrieval/state consistency, not generated RP behavior, so direct case porting would overclaim coverage.",
      };

    case "persona_conditioned_insight":
      return {
        candidateKey: proposal.candidateKey,
        sourceVersion: proposal.sourceVersion,
        ability: proposal.ability,
        readiness: "HARNESS_EXTENSION_REQUIRED",
        canonicalOwner: "no deterministic persona-conditioned interpretation scorer",
        targetPaths: [
          "src/lib/memory/memory-rp-benchmark.ts",
          "src/lib/memory/memory-rp-benchmark-suite.ts",
        ],
        proposedCaseIds: [
          "persona-grounded-insight-01",
          "unsupported-persona-inference-negative-01",
        ],
        reuseMetrics: ["falseMemoryRate", "relationshipRoleConsistency"],
        requirements: [
          "Define objective persona premises and objective source facts.",
          "A positive insight must be mechanically grounded by both inputs.",
          "A negative case must reject an attractive but unsupported psychological interpretation.",
          "Do not persist inferred insight as canonical fact until an explicit owner/data model is separately reviewed.",
        ],
        forbidden: [
          "free-form psychological inference as ground truth",
          "new insight memory store",
          "LLM judge as canonical scorer",
          "provider calls in scheduled research",
        ],
        rationale:
          "RoleMemo-style insight quality is response reasoning, not simply retrieval; the current harness needs an objective deterministic scorer before a case can be trusted.",
      };

    default:
      return noPort(
        proposal,
        "No new local fixture is required for this already-represented or unsupported benchmark ability."
      );
  }
}

export function buildBenchmarkCasePortPlans(
  proposals: readonly BenchmarkAdoptionProposal[]
): BenchmarkCasePortPlan[] {
  return proposals.map(buildBenchmarkCasePortPlan);
}

export function renderBenchmarkCasePortPlansMarkdown(
  plans: readonly BenchmarkCasePortPlan[]
): string {
  const lines = [
    "## Benchmark Case Port Planner",
    "",
    "Plans are implementation guidance only. No external dataset or judge is copied, no production path changes, and no benchmark file is edited automatically.",
    "",
  ];
  if (plans.length === 0) {
    lines.push("- (no case-port plan this cycle)", "");
    return lines.join("\n");
  }

  lines.push(
    "| benchmark | ability | readiness | canonical owner | proposed local case(s) |",
    "|---|---|---|---|---|"
  );
  for (const plan of plans) {
    lines.push(
      `| ${plan.candidateKey} | ${plan.ability} | ${plan.readiness} | ${plan.canonicalOwner.replace(/\|/g, "/")} | ${plan.proposedCaseIds.join(", ") || "-"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
