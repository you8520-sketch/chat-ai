import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
  implementationBranch,
  openImplementationDraftPrs,
  validateImplementationCandidate,
} from "@/lib/memoryResearch/implementationPr";
import { findImplementationRecipe } from "@/lib/memoryResearch/implementationRecipes";
import { applyImplementationPrResults, emptyLedger } from "@/lib/memoryResearch/ledger";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";
const HEAD_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const KEY = "github:qwenlm/qwen3-embedding";
const CONFIG = "src/lib/memory/memory-episodic-semantic-config.ts";
const TEST = "src/lib/memory/memory-episodic-semantic-discovery.test.ts";

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    candidateKey: KEY,
    category: "embedding_model",
    sourceKind: "github_repository",
    sourceUrl: "https://github.com/QwenLM/Qwen3-Embedding",
    title: "QwenLM/Qwen3-Embedding",
    version: "v1.2.3",
    discoveredAt: "2026-09-27T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    summary: "",
    claimedAdvantage: "",
    applicableOwners: ["embedding_index"],
    expectedBenefit: "",
    expectedCost: "",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state: "WATCH",
    lastDecision: "WATCH_IMPLEMENTATION_PR_PENDING",
    lastDecisionReason: "live gate accepted",
    priorRejectionReason: null,
    reevaluationCondition: "implementation Draft PR generation/review",
    cooldownUntil: null,
    evaluations: [],
    draftPrUrl: null,
    implementationPrUrl: null,
    liveExperiment: {
      recipeId: "qwen3-embedding-vs-bge-m3",
      recipeVersion: "1",
      evaluatedAt: "2026-10-01T02:43:00Z",
      referenceModel: "baai/bge-m3",
      candidateModel: "qwen/qwen3-embedding-8b",
      gateDecision: "ACCEPTED_QUALITY_GAIN",
      gateReason: "quality gain without regression",
      referenceMetrics: "finalRecall@8=0.900",
      candidateMetrics: "finalRecall@8=0.950",
      candidateCostUsdPer1kTurns: 0.02,
      referenceCostUsdPer1kTurns: 0.02,
      queryP95DeltaMs: 12,
    },
    ...overrides,
  };
}

function sourceFiles() {
  return {
    [CONFIG]: [
      "before",
      '    configVersion: "qwen3-embedding-8b@4096/provisional-1",',
      '    status: "PROVISIONAL_LIVE_BENCHMARK_PENDING",',
      "after",
    ].join("\n"),
    [TEST]: [
      '  it("runtime gate enables only the approved BGE config", () => {',
      "x",
      '    assert.deepEqual(',
      '      resolveEpisodicSemanticRuntime({',
      '        EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",',
      '        EPISODIC_SEMANTIC_MODEL: "qwen3_embedding_8b",',
      '      } as NodeJS.ProcessEnv),',
      '      { enabled: false, reason: "config_provisional_live_benchmark_pending" }',
      '    );',
      "y",
    ].join("\n"),
  } as Record<string, string>;
}

function harness(files = sourceFiles()) {
  const calls: Array<[string, string[]]> = [];
  const written: Record<string, string> = {};
  let validated = 0;
  const run = (command: string, args: readonly string[]) => {
    calls.push([command, [...args]]);
    if (command === "gh" && args[0] === "pr" && args[1] === "list") return "";
    if (command === "git" && args[0] === "diff" && args[1] === "--name-only") return `${CONFIG}\n${TEST}\n`;
    if (command === "git" && args[0] === "rev-parse") return `${HEAD_SHA}\n`;
    if (command === "gh" && args[0] === "pr" && args[1] === "create") return "https://github.com/o/r/pull/42\n";
    return "";
  };
  return {
    calls,
    written,
    read: (path: string) => {
      if (!(path in files)) throw new Error(`missing fixture ${path}`);
      return files[path]!;
    },
    write: (path: string, value: string) => {
      written[path] = value;
      if (path === CONFIG || path === TEST) files[path] = value;
    },
    validate: () => {
      validated += 1;
    },
    validated: () => validated,
    run,
  };
}

it("accepted live evidence produces only the allowlisted canonical patch and a Draft PR", () => {
  const h = harness();
  const c = candidate();
  const [result] = openImplementationDraftPrs([c], h.run, h.read, h.write, h.validate, {
    mainSha: MAIN_SHA,
    generationId: "run-7-attempt-1",
    tempDir: "/tmp",
  });
  assert.deepEqual(result, { candidateKey: KEY, url: "https://github.com/o/r/pull/42", error: null });
  assert.equal(h.validated(), 1);
  assert.match(h.written[CONFIG]!, /approved-live-1/);
  assert.match(h.written[CONFIG]!, /status: "APPROVED"/);
  assert.match(h.written[TEST]!, /runtime gate enables approved configs/);
  assert.match(h.written[TEST]!, /enabled: true, model: EPISODIC_SEMANTIC_MODEL_CANDIDATES\.qwen3_embedding_8b/);
  const create = h.calls.find(([command, args]) => command === "gh" && args[0] === "pr" && args[1] === "create")!;
  assert.ok(create[1].includes("--draft"));
  for (const [, args] of h.calls) {
    assert.ok(!args.includes("merge") && !args.includes("--auto") && !args.includes("ready") && !args.includes("--force"));
  }
  const bodyPath = create[1][create[1].indexOf("--body-file") + 1]!;
  assert.match(h.written[bodyPath]!, /RUNTIME ACTIVATION REVIEW REQUIRED/);
  assert.match(h.written[bodyPath]!, new RegExp(MAIN_SHA));
  assert.match(h.written[bodyPath]!, new RegExp(HEAD_SHA));
});

it("source drift fails closed instead of broadening the patch", () => {
  const files = sourceFiles();
  files[CONFIG] = files[CONFIG]!.replace("provisional-1", "someone-changed-this");
  const h = harness(files);
  const [result] = openImplementationDraftPrs([candidate()], h.run, h.read, h.write, h.validate, {
    mainSha: MAIN_SHA,
    generationId: "run-8-attempt-1",
    tempDir: "/tmp",
  });
  assert.equal(result.url, null);
  assert.match(result.error!, /expected exactly one source match/);
  assert.equal(h.validated(), 0);
  assert.equal(h.calls.some(([command, args]) => command === "gh" && args[1] === "create"), false);
});

it("candidate gate and evidence must be accepted before any implementation commands run", () => {
  const recipe = findImplementationRecipe(KEY)!;
  assert.throws(
    () => validateImplementationCandidate(candidate({ lastDecision: "WATCH_LIVE_EXPERIMENT_PENDING" }), recipe),
    /not implementation-pending/
  );
  assert.throws(
    () =>
      validateImplementationCandidate(
        candidate({
          liveExperiment: {
            ...candidate().liveExperiment!,
            gateDecision: "REJECTED_FALSE_MEMORY_REGRESSION",
          },
        }),
        recipe
      ),
    /not accepted/
  );
  const h = harness();
  const [result] = openImplementationDraftPrs(
    [candidate({ liveExperiment: { ...candidate().liveExperiment!, gateDecision: "REJECTED_FALSE_MEMORY_REGRESSION" } })],
    h.run,
    h.read,
    h.write,
    h.validate,
    { mainSha: MAIN_SHA, generationId: "run-9-attempt-1", tempDir: "/tmp" }
  );
  assert.equal(result.url, null);
  assert.equal(h.calls.length, 0);
});

it("generation identity changes the branch, avoiding non-fast-forward retry collisions", () => {
  const recipe = findImplementationRecipe(KEY)!;
  const first = implementationBranch(candidate(), recipe, "100-1");
  const retry = implementationBranch(candidate(), recipe, "100-2");
  assert.notEqual(first, retry);
  assert.match(first, /memory-research\/implement/);
});

it("implementation PR result is persisted without changing WATCH decision/state", () => {
  const ledger = emptyLedger();
  ledger.candidates[KEY] = candidate();
  const next = applyImplementationPrResults(ledger, [
    { candidateKey: KEY, url: "https://github.com/o/r/pull/42", error: null },
  ]);
  assert.equal(next.candidates[KEY]!.implementationPrUrl, "https://github.com/o/r/pull/42");
  assert.equal(next.candidates[KEY]!.state, "WATCH");
  assert.equal(next.candidates[KEY]!.lastDecision, "WATCH_IMPLEMENTATION_PR_PENDING");
});

it("workflow implementation job is evidence-gated, Draft-only, and isolated from production credentials", () => {
  const yml = readFileSync(".github/workflows/memory-research-cycle.yml", "utf8");
  const start = yml.indexOf("  implementation_prs:");
  const end = yml.indexOf("  persist:", start);
  assert.ok(start > 0 && end > start);
  const job = yml.slice(start, end);
  assert.match(job, /implementation_pending_count/);
  assert.match(job, /ready_for_implementation/);
  assert.match(job, /pull-requests: write/);
  assert.match(job, /implementation-prs/);
  assert.doesNotMatch(job, /OPENROUTER_API_KEY|CHEAPER_INFERENCE_API_KEY|OPENAI_API_KEY/);
  assert.doesNotMatch(job, /gh pr merge|--auto\b|ready-for-review|pulls\/\d+\/merge/);
});
