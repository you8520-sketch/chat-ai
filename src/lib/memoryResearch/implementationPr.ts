/**
 * Creates an implementation Draft PR only from a candidate that already passed
 * the live experiment gate. Edits are supplied by allowlisted fail-closed
 * recipes. No free-form patching, merge, auto-merge, ready-for-review, env
 * mutation, or deploy mutation is allowed here.
 */
import { assertDraftOnlyCommand, type CommandRunner, type FileWriter } from "@/lib/memoryResearch/draftPr";
import {
  applyImplementationEdit,
  findImplementationRecipe,
  type ImplementationRecipe,
} from "@/lib/memoryResearch/implementationRecipes";
import { slugForCandidate } from "@/lib/memoryResearch/prPacket";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

export type FileReader = (path: string) => string;
export type WorkingTreeValidator = () => void;
export type ImplementationPrResult = { candidateKey: string; url: string | null; error: string | null };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function validateImplementationCandidate(candidate: ResearchCandidate, recipe: ImplementationRecipe): void {
  if (candidate.candidateKey !== recipe.candidateKey) throw new Error("candidate/recipe key mismatch");
  if (candidate.state !== "WATCH" || candidate.lastDecision !== "WATCH_IMPLEMENTATION_PR_PENDING") {
    throw new Error(`candidate ${candidate.candidateKey} is not implementation-pending`);
  }
  if (candidate.implementationPrUrl) throw new Error(`candidate ${candidate.candidateKey} already has an implementation PR`);
  const live = candidate.liveExperiment;
  if (!live) throw new Error(`candidate ${candidate.candidateKey} lacks live experiment evidence`);
  if (live.recipeId !== recipe.requiredLiveRecipeId) {
    throw new Error(`live recipe mismatch: expected ${recipe.requiredLiveRecipeId}, got ${live.recipeId}`);
  }
  if (live.gateDecision !== "ACCEPTED_QUALITY_GAIN") {
    throw new Error(`live evidence was not accepted: ${live.gateDecision}`);
  }
}

export function implementationBranch(
  candidate: ResearchCandidate,
  recipe: ImplementationRecipe,
  generationId: string
): string {
  return [
    "memory-research/implement",
    slugForCandidate(candidate.candidateKey),
    slug(candidate.version ?? "unversioned"),
    slug(recipe.recipeVersion),
    slug(generationId),
  ].join("-");
}

function implementationBody(
  candidate: ResearchCandidate,
  recipe: ImplementationRecipe,
  mainSha: string,
  headSha: string
): string {
  const live = candidate.liveExperiment!;
  const runtimeGate = recipe.requiresRuntimeActivationReview
    ? [
        "> [!CAUTION]",
        "> **RUNTIME ACTIVATION REVIEW REQUIRED.** This Draft PR must not be merged until the deployed semantic flag/model values are explicitly verified.",
        "",
      ].join("\n")
    : "";
  return `> Automated Memory Improvement System — implementation Draft PR generated from accepted live evidence. **Never auto-merged.**

${runtimeGate}## Candidate
- key: \`${candidate.candidateKey}\`
- source: ${candidate.sourceUrl}
- source version: \`${candidate.version ?? "unversioned"}\`
- implementation recipe: \`${recipe.id}@${recipe.recipeVersion}\`
- live recipe: \`${live.recipeId}@${live.recipeVersion}\`
- evaluated: ${live.evaluatedAt}

## Live evidence
- reference: \`${live.referenceModel}\`
- candidate: \`${live.candidateModel}\`
- gate: \`${live.gateDecision}\`
- reason: ${live.gateReason}
- reference metrics: \`${live.referenceMetrics}\`
- candidate metrics: \`${live.candidateMetrics}\`
- reference cost / 1k turns: ${live.referenceCostUsdPer1kTurns ?? "not reported"}
- candidate cost / 1k turns: ${live.candidateCostUsdPer1kTurns ?? "not reported"}
- query p95 delta ms: ${live.queryP95DeltaMs ?? "not measured"}

## Canonical owner patch
${recipe.allowedPaths.map((path) => `- \`${path}\``).join("\n")}

Only the allowlisted canonical owner path(s) above may change. No environment value, deploy setting, provider credential, pricing, auth, safety, adult boundary, or automatic merge is part of this PR.

## STOP CONDITIONS
${recipe.stopConditions.map((condition) => `- ${condition}`).join("\n")}

## Validation
The generator fails closed unless every expected source fragment exists exactly once, the resulting diff contains only allowlisted paths, \`git diff --check\` passes, and the configured pre-PR validation command succeeds.

## Exact main / head
- main: \`${mainSha}\`
- head: \`${headSha}\`
`;
}

export function openImplementationDraftPrs(
  candidates: readonly ResearchCandidate[],
  run: CommandRunner,
  readFile: FileReader,
  writeFile: FileWriter,
  validateWorkingTree: WorkingTreeValidator,
  opts: { mainSha: string; generationId: string; tempDir: string; baseBranch?: string }
): ImplementationPrResult[] {
  if (!/^[0-9a-f]{40}$/.test(opts.mainSha)) throw new Error("implementation PR generator requires exact main SHA");
  if (!opts.generationId.trim()) throw new Error("implementation PR generator requires generationId");
  const baseBranch = opts.baseBranch ?? "main";
  const exec = (command: string, args: readonly string[]) => {
    assertDraftOnlyCommand(command, args);
    return run(command, args).trim();
  };
  const results: ImplementationPrResult[] = [];

  for (const candidate of candidates) {
    try {
      const recipe = findImplementationRecipe(candidate.candidateKey);
      if (!recipe) throw new Error(`no implementation recipe for ${candidate.candidateKey}`);
      validateImplementationCandidate(candidate, recipe);
      const branch = implementationBranch(candidate, recipe, opts.generationId);
      const existing = exec("gh", [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url // \"\"",
      ]);
      if (existing) {
        results.push({ candidateKey: candidate.candidateKey, url: existing, error: null });
        continue;
      }

      exec("git", ["checkout", "--detach", opts.mainSha]);
      exec("git", ["checkout", "-B", branch]);

      const edits = recipe.buildEdits(candidate);
      if (edits.length === 0) throw new Error("implementation recipe produced no edits");
      const editPaths = [...new Set(edits.map((edit) => edit.path))].sort();
      const allowed = [...recipe.allowedPaths].sort();
      if (JSON.stringify(editPaths) !== JSON.stringify(allowed)) {
        throw new Error(`recipe edit paths do not exactly match allowlist: edits=${editPaths.join(",")} allowed=${allowed.join(",")}`);
      }

      for (const edit of edits) {
        const current = readFile(edit.path);
        writeFile(edit.path, applyImplementationEdit(current, edit));
      }

      const changed = exec("git", ["diff", "--name-only"])
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean)
        .sort();
      if (JSON.stringify(changed) !== JSON.stringify(allowed)) {
        throw new Error(`working tree escaped implementation allowlist: changed=${changed.join(",")} allowed=${allowed.join(",")}`);
      }
      exec("git", ["diff", "--check"]);
      validateWorkingTree();

      exec("git", ["add", "--", ...allowed]);
      exec("git", ["commit", "-m", `feat(memory): apply accepted research candidate ${candidate.candidateKey}`]);
      const head = exec("git", ["rev-parse", "HEAD"]);
      exec("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);

      const bodyFile = `${opts.tempDir}/${branch.replace(/[^a-z0-9-]+/gi, "_")}.md`;
      writeFile(bodyFile, implementationBody(candidate, recipe, opts.mainSha, head));
      const url = exec("gh", [
        "pr",
        "create",
        "--draft",
        "--base",
        baseBranch,
        "--head",
        branch,
        "--title",
        `[memory-research] implementation: ${candidate.title}`,
        "--body-file",
        bodyFile,
      ]);
      results.push({ candidateKey: candidate.candidateKey, url, error: null });
    } catch (error) {
      results.push({
        candidateKey: candidate.candidateKey,
        url: null,
        error: error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700),
      });
    }
  }
  return results;
}
