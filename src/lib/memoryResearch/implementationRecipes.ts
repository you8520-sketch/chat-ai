/**
 * Fail-closed implementation recipes for candidates that already passed a live
 * experiment. These are the only production-file edits the automation may
 * propose. A recipe is evidence-gated and path-allowlisted; it never changes
 * environment variables, deploy settings, or merge state.
 */
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

export type ImplementationFileEdit = {
  path: string;
  before: string;
  after: string;
  description: string;
};

export type ImplementationRecipe = {
  id: string;
  candidateKey: string;
  recipeVersion: string;
  requiredLiveRecipeId: string;
  allowedPaths: readonly string[];
  requiresRuntimeActivationReview: boolean;
  stopConditions: readonly string[];
  buildEdits(candidate: ResearchCandidate): readonly ImplementationFileEdit[];
};

const QWEN_CONFIG_PATH = "src/lib/memory/memory-episodic-semantic-config.ts";
const QWEN_RUNTIME_TEST_PATH = "src/lib/memory/memory-episodic-semantic-discovery.test.ts";

export const IMPLEMENTATION_RECIPES: readonly ImplementationRecipe[] = [
  {
    id: "approve-qwen3-embedding-config",
    candidateKey: "github:qwenlm/qwen3-embedding",
    recipeVersion: "1",
    requiredLiveRecipeId: "qwen3-embedding-vs-bge-m3",
    allowedPaths: [QWEN_CONFIG_PATH, QWEN_RUNTIME_TEST_PATH],
    requiresRuntimeActivationReview: true,
    stopConditions: [
      "Do not merge until the deployed EPISODIC_SEMANTIC_DISCOVERY_ENABLED and EPISODIC_SEMANTIC_MODEL values are explicitly verified.",
      "Do not merge if approving Qwen3 would activate it immediately without a separate rollout decision.",
      "Do not change the feature flag, selected model env, pricing, provider credential, privacy route, or adult/safety boundary in this PR.",
    ],
    buildEdits(candidate) {
      if (candidate.liveExperiment?.candidateModel !== "qwen/qwen3-embedding-8b") {
        throw new Error("Qwen3 implementation recipe requires live evidence for qwen/qwen3-embedding-8b");
      }
      return [
        {
          path: QWEN_CONFIG_PATH,
          before:
            '    configVersion: "qwen3-embedding-8b@4096/provisional-1",\n' +
            '    status: "PROVISIONAL_LIVE_BENCHMARK_PENDING",',
          after:
            '    configVersion: "qwen3-embedding-8b@4096/approved-live-1",\n' +
            '    status: "APPROVED",',
          description:
            "Promote only the existing Qwen3 embedding config from provisional to benchmark-approved; runtime selection/flag remain separate owners.",
        },
        {
          path: QWEN_RUNTIME_TEST_PATH,
          before: '  it("runtime gate enables only the approved BGE config", () => {',
          after: '  it("runtime gate enables approved configs and still rejects unknown models", () => {',
          description: "Update the existing runtime-gate regression title to reflect more than one approved config.",
        },
        {
          path: QWEN_RUNTIME_TEST_PATH,
          before:
            '    assert.deepEqual(\n' +
            '      resolveEpisodicSemanticRuntime({\n' +
            '        EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",\n' +
            '        EPISODIC_SEMANTIC_MODEL: "qwen3_embedding_8b",\n' +
            '      } as NodeJS.ProcessEnv),\n' +
            '      { enabled: false, reason: "config_provisional_live_benchmark_pending" }\n' +
            '    );',
          after:
            '    assert.deepEqual(\n' +
            '      resolveEpisodicSemanticRuntime({\n' +
            '        EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",\n' +
            '        EPISODIC_SEMANTIC_MODEL: "qwen3_embedding_8b",\n' +
            '      } as NodeJS.ProcessEnv),\n' +
            '      { enabled: true, model: EPISODIC_SEMANTIC_MODEL_CANDIDATES.qwen3_embedding_8b }\n' +
            '    );',
          description: "Keep the existing activation-gate regression aligned with the approved config while preserving flag and model-key gating.",
        },
      ];
    },
  },
];

export function findImplementationRecipe(candidateKey: string): ImplementationRecipe | undefined {
  return IMPLEMENTATION_RECIPES.find((recipe) => recipe.candidateKey === candidateKey);
}

export function countExactOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const found = text.indexOf(needle, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + needle.length;
  }
}

export function applyImplementationEdit(content: string, edit: ImplementationFileEdit): string {
  const matches = countExactOccurrences(content, edit.before);
  if (matches !== 1) {
    throw new Error(
      `implementation recipe expected exactly one source match in ${edit.path}, found ${matches}; current main changed, STOP`
    );
  }
  if (content.includes(edit.after)) {
    throw new Error(`implementation target already contains proposed state in ${edit.path}; STOP instead of double-applying`);
  }
  return content.replace(edit.before, edit.after);
}
