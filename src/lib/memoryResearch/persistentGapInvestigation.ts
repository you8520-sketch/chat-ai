/**
 * Persistent Gap Investigation Packets.
 *
 * Research-only evidence that turns a repeated deterministic miss with no
 * reviewed live recipe into a bounded BUGFIX investigation ticket. It never
 * creates a recipe, candidate, implementation branch, or production patch.
 */
import type {
  PersistentGapEvidence,
  PersistentMemoryGapReport,
} from "@/lib/memoryResearch/persistentGapRadar";
import {
  LIVE_EXPERIMENT_RECIPES,
  type LiveExperimentRecipe,
} from "@/lib/memoryResearch/liveExperimentRecipes";

export type PersistentGapInvestigationStatus =
  | "BUGFIX_INVESTIGATION_READY"
  | "OWNER_ROUTING_REQUIRED";

export type PersistentGapInvestigationPacket = {
  caseId: string;
  status: PersistentGapInvestigationStatus;
  consecutiveComparableFailures: number;
  capabilityGroups: readonly string[];
  documentedKnownGap: boolean;
  ownerHints: readonly string[];
  deterministicReproduction: string;
  investigationSteps: readonly string[];
  regressionGate: readonly string[];
  stopConditions: readonly string[];
  nextAction: string;
};

function matchingRecipeExists(
  gap: PersistentGapEvidence,
  recipes: readonly LiveExperimentRecipe[]
): boolean {
  if (gap.ownerHints.length === 0) return false;
  const owners = new Set(gap.ownerHints);
  return recipes.some((recipe) => owners.has(recipe.targetOwner));
}

function ownerRoutingPacket(
  gap: PersistentGapEvidence
): PersistentGapInvestigationPacket {
  return {
    caseId: gap.caseId,
    status: "OWNER_ROUTING_REQUIRED",
    consecutiveComparableFailures: gap.consecutiveComparableFailures,
    capabilityGroups: gap.capabilityGroups,
    documentedKnownGap: gap.documentedKnownGap,
    ownerHints: [],
    deterministicReproduction:
      `Run the canonical deterministic RP-memory benchmark and reproduce exact case '${gap.caseId}' on current main using the same benchmark fingerprint. Do not patch before the failing execution stage is traced.`,
    investigationSteps: [
      "Trace candidate discovery → relevance/scoring → dedupe → budget/packing → final injection for this exact case.",
      "Build an OWNER MAP from the actual current-main execution path; do not infer an owner from the external benchmark category.",
      "Identify whether the miss is retrieval, durable-state ownership, lifecycle invalidation, prompt packing, or benchmark-fixture semantics.",
    ],
    regressionGate: [
      "The exact case must fail before any patch and pass after a future patch.",
      "Existing positive baseline hits and false/stale-memory negatives must remain unchanged.",
      "Provider calls remain 0 for deterministic reproduction.",
    ],
    stopConditions: [
      "No canonical owner can be proven from current code.",
      "Fix requires a new writable memory owner/store.",
      "Fix requires a paid provider/LLM judge in the deterministic benchmark.",
      "Fix requires unrelated memory architecture refactor.",
    ],
    nextAction:
      "Open an owner-routing BUGFIX investigation only. Report evidence and STOP before implementation until one canonical owner is proven.",
  };
}

function ownedGapPacket(
  gap: PersistentGapEvidence
): PersistentGapInvestigationPacket {
  return {
    caseId: gap.caseId,
    status: "BUGFIX_INVESTIGATION_READY",
    consecutiveComparableFailures: gap.consecutiveComparableFailures,
    capabilityGroups: gap.capabilityGroups,
    documentedKnownGap: gap.documentedKnownGap,
    ownerHints: gap.ownerHints,
    deterministicReproduction:
      `Run the canonical deterministic RP-memory benchmark on current main and reproduce exact case '${gap.caseId}' with the same benchmark fingerprint. Persistence evidence: ${gap.consecutiveComparableFailures} consecutive comparable failures.`,
    investigationSteps: [
      `Audit only the hinted canonical owner(s): ${gap.ownerHints.join(", ")}. Confirm the current-main execution path before changing code.`,
      "Separate candidate discovery success from final injection/consumption failure.",
      "Audit existing defenses/workarounds on normal, regen/delete/fork/reset, fallback, and long-horizon paths before proposing a patch.",
      "Prefer fixing the failing owner or consolidating an obsolete workaround over adding another prompt/exception/fallback.",
    ],
    regressionGate: [
      `Exact deterministic case '${gap.caseId}' is RED on pre-fix current main and GREEN after a future fix.`,
      "Candidate/final recall, precision, false memory, stale-state, correction/supersession and prompt-token evidence are compared where applicable.",
      "Adjacent existing benchmark positives remain hits; known negative cases do not regress.",
      "lint, typecheck and the full Validate memory episodic workflow pass.",
    ],
    stopConditions: [
      "Observed failing stage does not match the hinted owner.",
      "A different canonical owner is discovered.",
      "A destructive migration or new DB/vector/graph store is required.",
      "A paid provider call becomes necessary in the deterministic path.",
      "Auth/safety/adult/billing boundaries would change.",
      "Fix requires unrelated large-scale memory refactor.",
    ],
    nextAction:
      "Create evidence for a BUGFIX investigation; do not auto-create a recipe or implementation PR. A future reviewed patch must follow reproduce → root cause → canonical owner → regression.",
  };
}

export function buildPersistentGapInvestigationPackets(
  report: PersistentMemoryGapReport,
  recipes: readonly LiveExperimentRecipe[] = LIVE_EXPERIMENT_RECIPES
): PersistentGapInvestigationPacket[] {
  if (report.status !== "PERSISTENT_GAPS") return [];

  const packets: PersistentGapInvestigationPacket[] = [];
  for (const gap of report.persistentGaps) {
    // Existing reviewed recipes are owned by the live-experiment router. Do
    // not create a parallel investigation packet for the same gap.
    if (matchingRecipeExists(gap, recipes)) continue;
    packets.push(
      gap.ownerHints.length === 0
        ? ownerRoutingPacket(gap)
        : ownedGapPacket(gap)
    );
  }
  return packets;
}

export function renderPersistentGapInvestigationPacketsMarkdown(
  packets: readonly PersistentGapInvestigationPacket[]
): string {
  const lines = [
    "## Persistent Gap Investigation Packets",
    "",
    "Evidence packets only. They never create a candidate, live recipe, implementation branch, or production patch.",
    "",
  ];
  if (packets.length === 0) {
    lines.push("- packets: -", "");
    return lines.join("\n");
  }

  for (const packet of packets) {
    lines.push(
      `### ${packet.caseId}`,
      "",
      `- status: **${packet.status}**`,
      `- consecutive comparable failures: ${packet.consecutiveComparableFailures}`,
      `- owner hint(s): ${packet.ownerHints.join(", ") || "OWNER_ROUTING_REQUIRED"}`,
      `- capability group(s): ${packet.capabilityGroups.join(", ") || "-"}`,
      `- documented known gap: ${packet.documentedKnownGap ? "YES" : "NO"}`,
      `- reproduction: ${packet.deterministicReproduction}`,
      "",
      "Investigation:",
      ...packet.investigationSteps.map((step) => `- ${step}`),
      "",
      "Regression gate:",
      ...packet.regressionGate.map((gate) => `- ${gate}`),
      "",
      "STOP:",
      ...packet.stopConditions.map((condition) => `- ${condition}`),
      "",
      `Next: ${packet.nextAction}`,
      ""
    );
  }
  return lines.join("\n");
}
