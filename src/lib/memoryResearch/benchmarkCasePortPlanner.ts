/**
 * Benchmark Case Port Planner.
 *
 * Converts benchmark-adoption findings into local, bounded implementation
 * plans. It never copies external datasets, runs external judges, changes
 * production memory, or edits benchmark/runtime files automatically.
 */
import type {
  BenchmarkAdoptionProposal,
  ExternalBenchmarkAbility,
} from "@/lib/memoryResearch/benchmarkAdoptionBridge";

export type CasePortReadiness =
  | "READY_DETERMINISTIC_FIXTURE"
  | "READY_RELATIONSHIP_LIFECYCLE_FIXTURE"
  | "READY_MUTATION_LIFECYCLE_FIXTURE"
  | "HARNESS_EXTENSION_REQUIRED"
  | "NO_PORT_REQUIRED";

export type BenchmarkCasePortPlan = {
  planId: string;
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

function planBase(
  proposal: BenchmarkAdoptionProposal,
  suffix: string
): Pick<
  BenchmarkCasePortPlan,
  "planId" | "candidateKey" | "sourceVersion" | "ability"
> {
  return {
    planId: `${proposal.candidateKey}:${proposal.ability}:${suffix}`,
    candidateKey: proposal.candidateKey,
    sourceVersion: proposal.sourceVersion,
    ability: proposal.ability,
  };
}

function noPort(
  proposal: BenchmarkAdoptionProposal,
  rationale: string
): BenchmarkCasePortPlan {
  return {
    ...planBase(proposal, "no-port"),
    readiness: "NO_PORT_REQUIRED",
    canonicalOwner: "existing capability group",
    targetPaths: [],
    proposedCaseIds: [],
    reuseMetrics: [],
    requirements: [],
    forbidden: [
      "duplicate benchmark owner",
      "external judge import",
      "external leaderboard score",
    ],
    rationale,
  };
}

function trajectoryRecallPlans(
  proposal: BenchmarkAdoptionProposal
): BenchmarkCasePortPlan[] {
  return [
    {
      ...planBase(proposal, "active-expired-commitment"),
      readiness: "READY_RELATIONSHIP_LIFECYCLE_FIXTURE",
      canonicalOwner:
        "src/lib/chatMemory.ts mergeMemoryMeta/formatMemoryMetaForPrompt (Relationship Durable promises)",
      targetPaths: [
        "src/lib/chatMemory.test.ts",
        "src/lib/relationshipMemoryTail.test.ts",
      ],
      proposedCaseIds: ["active-expired-commitment-01"],
      reuseMetrics: [],
      requirements: [
        "Use the canonical promisesAdd/promisesRemove delta instead of episodic facts.",
        "Prove an active promise enters durable relationship prompt text.",
        "Prove fulfillment/expiry removal deletes that promise from durable prompt text.",
        "Keep formal promise lifecycle out of episodic retrieval; memory-rp-benchmark promise-01 remains only the documented non-ledger commitment case.",
      ],
      forbidden: [
        "episodic fact as formal-promise owner",
        "new promise store",
        "LLM-as-judge",
        "provider calls",
      ],
      rationale:
        "Formal promises are explicitly Relationship Durable owned. Active/expired commitment is a ledger lifecycle problem, not an episodic retrieval-ranking problem.",
    },
    {
      ...planBase(proposal, "legitimate-persona-update"),
      readiness: "HARNESS_EXTENSION_REQUIRED",
      canonicalOwner: "unresolved mutable-persona-state owner",
      targetPaths: [],
      proposedCaseIds: ["persona-update-current-01"],
      reuseMetrics: [],
      requirements: [
        "First identify the current canonical owner for legitimate mutable persona updates, if one exists.",
        "Separate mutable in-story persona state from immutable creator-authored character identity.",
        "Define deterministic current-vs-original state evidence before adding a case.",
      ],
      forbidden: [
        "using episodic facts as a fallback persona owner",
        "rewriting creator-authored persona from conversation history",
        "LLM-as-judge",
        "production prompt change",
      ],
      rationale:
        "ANCHOR-style legitimate persona updates are not equivalent to ordinary episodic state replacement. No current deterministic owner/harness was proven for mutable persona identity updates.",
    },
  ];
}

function singlePlanForProposal(
  proposal: BenchmarkAdoptionProposal
): BenchmarkCasePortPlan[] {
  if (proposal.status === "ALREADY_COVERED") {
    return [
      noPort(
        proposal,
        "The canonical RP-memory benchmark already has deterministic cases for this capability."
      ),
    ];
  }

  if (
    proposal.status === "INSUFFICIENT_EVIDENCE" ||
    proposal.ability === "unclassified"
  ) {
    return [
      noPort(
        proposal,
        "The external benchmark description is not specific enough to justify a local fixture."
      ),
    ];
  }

  switch (proposal.ability) {
    case "trajectory_recall":
      return trajectoryRecallPlans(proposal);

    case "forgetting_fidelity":
      return [
        {
          ...planBase(proposal, "derived-memory-deletion-residue"),
          readiness: "READY_MUTATION_LIFECYCLE_FIXTURE",
          canonicalOwner:
            "source-mutation invalidation + summary integrity regressions",
          targetPaths: [
            "src/lib/memory/memory-premerge-blockers.test.ts",
            "src/lib/memory/memory-summary-integrity.test.ts",
            "src/lib/memory/memory-source-boundary.test.ts",
          ],
          proposedCaseIds: ["derived-memory-deletion-residue-01"],
          reuseMetrics: ["staleStateRecallRate", "falseMemoryRate"],
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
        },
      ];

    case "persona_continuity":
      return [
        {
          ...planBase(proposal, "persona-behavior-harness"),
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
        },
      ];

    case "persona_conditioned_insight":
      return [
        {
          ...planBase(proposal, "persona-insight-harness"),
          readiness: "HARNESS_EXTENSION_REQUIRED",
          canonicalOwner:
            "no deterministic persona-conditioned interpretation scorer",
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
        },
      ];

    default:
      return [
        noPort(
          proposal,
          "No new local fixture is required for this already-represented or unsupported benchmark ability."
        ),
      ];
  }
}

export function buildBenchmarkCasePortPlans(
  proposals: readonly BenchmarkAdoptionProposal[]
): BenchmarkCasePortPlan[] {
  return proposals.flatMap(singlePlanForProposal);
}

export function renderBenchmarkCasePortPlansMarkdown(
  plans: readonly BenchmarkCasePortPlan[]
): string {
  const lines = [
    "## Benchmark Case Port Planner",
    "",
    "Plans are implementation guidance only. No external dataset or judge is copied, no production path changes, and no benchmark/runtime file is edited automatically.",
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
