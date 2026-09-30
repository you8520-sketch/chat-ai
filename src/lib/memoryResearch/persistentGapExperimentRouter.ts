/**
 * Persistent-gap → existing live-experiment router.
 *
 * Research-only. It never creates an experiment recipe or candidate. It only
 * prioritizes already-reviewed pending live recipes whose canonical owner
 * matches a persistent deterministic gap.
 */
import type { ResearchLedger } from "@/lib/memoryResearch/ledger";
import {
  buildPersistentMemoryGapReport,
  type PersistentGapEvidence,
  type PersistentMemoryGapReport,
} from "@/lib/memoryResearch/persistentGapRadar";
import {
  LIVE_EXPERIMENT_RECIPES,
  type LiveExperimentRecipe,
} from "@/lib/memoryResearch/liveExperimentRecipes";

export type PersistentGapExperimentRouteStatus =
  | "READY_LIVE_PRIORITY"
  | "REGISTERED_ASSET_NOT_PENDING"
  | "REGISTERED_ASSET_CANDIDATE_NOT_DISCOVERED"
  | "NO_REGISTERED_LIVE_RECIPE"
  | "OWNER_ROUTING_REQUIRED";

export type PersistentGapExperimentRoute = {
  caseId: string;
  ownerHints: readonly string[];
  status: PersistentGapExperimentRouteStatus;
  candidateKeys: readonly string[];
  recipeIds: readonly string[];
  reason: string;
};

export type PersistentGapLivePriority = {
  gapReport: PersistentMemoryGapReport;
  routes: PersistentGapExperimentRoute[];
  priorityCandidateKeys: string[];
  gapCaseIdsByCandidateKey: Record<string, string[]>;
};

function reportFromLedger(ledger: ResearchLedger): PersistentMemoryGapReport {
  const currentIndex = [...ledger.cycles]
    .map((cycle, index) => ({ cycle, index }))
    .reverse()
    .find(({ cycle }) => cycle.baseline != null)?.index;

  if (currentIndex == null) {
    return buildPersistentMemoryGapReport(null, []);
  }

  const current = ledger.cycles[currentIndex]!.baseline ?? null;
  const history = ledger.cycles.slice(0, currentIndex);
  return buildPersistentMemoryGapReport(current, history);
}

function matchingRecipes(
  gap: PersistentGapEvidence,
  recipes: readonly LiveExperimentRecipe[]
): LiveExperimentRecipe[] {
  if (gap.ownerHints.length === 0) return [];
  const owners = new Set(gap.ownerHints);
  return recipes.filter((recipe) => owners.has(recipe.targetOwner));
}

export function buildPersistentGapLivePriority(
  ledger: ResearchLedger,
  recipes: readonly LiveExperimentRecipe[] = LIVE_EXPERIMENT_RECIPES
): PersistentGapLivePriority {
  const gapReport = reportFromLedger(ledger);
  const routes: PersistentGapExperimentRoute[] = [];
  const priority: string[] = [];
  const gapCaseIdsByCandidateKey: Record<string, string[]> = {};

  for (const gap of gapReport.persistentGaps) {
    if (gap.ownerHints.length === 0) {
      routes.push({
        caseId: gap.caseId,
        ownerHints: gap.ownerHints,
        status: "OWNER_ROUTING_REQUIRED",
        candidateKeys: [],
        recipeIds: [],
        reason:
          "Persistent gap has no proven owner hint. Do not prioritize or invent an experiment until owner routing is confirmed.",
      });
      continue;
    }

    const matched = matchingRecipes(gap, recipes);
    if (matched.length === 0) {
      routes.push({
        caseId: gap.caseId,
        ownerHints: gap.ownerHints,
        status: "NO_REGISTERED_LIVE_RECIPE",
        candidateKeys: [],
        recipeIds: [],
        reason:
          "No reviewed live recipe targets this gap's current owner hint. Keep the gap visible; do not auto-create a recipe.",
      });
      continue;
    }

    const candidateKeys = matched.map((recipe) => recipe.candidateKey);
    const recipeIds = matched.map((recipe) => recipe.id);
    const discovered = matched.filter((recipe) => ledger.candidates[recipe.candidateKey] != null);
    const pending = discovered.filter((recipe) => {
      const candidate = ledger.candidates[recipe.candidateKey]!;
      return (
        candidate.state === "WATCH" &&
        candidate.lastDecision === "WATCH_LIVE_EXPERIMENT_PENDING"
      );
    });

    if (pending.length > 0) {
      for (const recipe of pending) {
        if (!priority.includes(recipe.candidateKey)) priority.push(recipe.candidateKey);
        const cases = gapCaseIdsByCandidateKey[recipe.candidateKey] ?? [];
        if (!cases.includes(gap.caseId)) cases.push(gap.caseId);
        gapCaseIdsByCandidateKey[recipe.candidateKey] = cases;
      }
      routes.push({
        caseId: gap.caseId,
        ownerHints: gap.ownerHints,
        status: "READY_LIVE_PRIORITY",
        candidateKeys: pending.map((recipe) => recipe.candidateKey),
        recipeIds: pending.map((recipe) => recipe.id),
        reason:
          "A reviewed live recipe already targets the same canonical owner and its candidate is pending. Prioritize it within the existing monthly live budget.",
      });
      continue;
    }

    if (discovered.length > 0) {
      routes.push({
        caseId: gap.caseId,
        ownerHints: gap.ownerHints,
        status: "REGISTERED_ASSET_NOT_PENDING",
        candidateKeys: discovered.map((recipe) => recipe.candidateKey),
        recipeIds: discovered.map((recipe) => recipe.id),
        reason:
          "Matching reviewed recipe exists, but the candidate is not currently live-pending. Do not override its lifecycle state.",
      });
      continue;
    }

    routes.push({
      caseId: gap.caseId,
      ownerHints: gap.ownerHints,
      status: "REGISTERED_ASSET_CANDIDATE_NOT_DISCOVERED",
      candidateKeys,
      recipeIds,
      reason:
        "Matching reviewed recipe exists but its candidate is not in the research ledger. Do not synthesize a candidate from the gap.",
    });
  }

  return {
    gapReport,
    routes,
    priorityCandidateKeys: priority,
    gapCaseIdsByCandidateKey,
  };
}

export function renderPersistentGapExperimentRoutesMarkdown(
  priority: PersistentGapLivePriority
): string {
  const lines = [
    "## Persistent Gap Experiment Router",
    "",
    `- gap radar: ${priority.gapReport.status}`,
    `- prioritized existing live candidates: ${priority.priorityCandidateKeys.join(", ") || "-"}`,
    "",
  ];
  if (priority.routes.length === 0) {
    lines.push("- routes: -", "");
    return lines.join("\n");
  }
  lines.push(
    "| gap | status | owner hint(s) | existing candidate(s) | reason |",
    "|---|---|---|---|---|"
  );
  for (const route of priority.routes) {
    lines.push(
      `| ${route.caseId} | ${route.status} | ${route.ownerHints.join(", ") || "OWNER_ROUTING_REQUIRED"} | ${route.candidateKeys.join(", ") || "-"} | ${route.reason.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
