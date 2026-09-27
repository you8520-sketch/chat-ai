/**
 * Parameterized live experiment recipes for research candidates that can be
 * evaluated without writing production code first.
 *
 * These recipes are research-only. They reuse the existing opt-in live
 * embeddings benchmark and never activate a production model.
 */
import { createHash } from "node:crypto";
import {
  EPISODIC_SEMANTIC_MODEL_CANDIDATES,
  type EpisodicSemanticModelConfig,
} from "@/lib/memory/memory-episodic-semantic-config";
import type { ArchitectureDelta, DeclaredProductionEfficiency } from "@/lib/memoryResearch/experiments";
import type { MemoryOwnerId } from "@/lib/memoryResearch/ownerMap";

export type LiveExperimentRecipe = {
  id: string;
  candidateKey: string;
  recipeVersion: string;
  kind: "openrouter_embedding_compare";
  targetOwner: MemoryOwnerId;
  candidateModel: EpisodicSemanticModelConfig;
  referenceModel: EpisodicSemanticModelConfig;
  declaredEfficiency: DeclaredProductionEfficiency;
  architectureDelta: ArchitectureDelta;
};

const NO_ARCHITECTURE_CHANGE: ArchitectureDelta = {
  before: "approved BGE-M3 semantic candidate lane is the current reference implementation",
  proposed: "evaluate Qwen3-Embedding through the same canonical OpenRouter embeddings transport and semantic lane",
  after: "no production change in this phase; evidence only",
  removed: [],
  newDb: [],
  newFlags: [],
  newProviders: [],
  newDependencies: [],
  newSchedulers: [],
  ownerCountDelta: 0,
  runtimePathDelta: 0,
};

export const LIVE_EXPERIMENT_RECIPES: readonly LiveExperimentRecipe[] = [
  {
    id: "qwen3-embedding-vs-bge-m3",
    candidateKey: "github:qwenlm/qwen3-embedding",
    recipeVersion: "1",
    kind: "openrouter_embedding_compare",
    targetOwner: "embedding_index",
    candidateModel: EPISODIC_SEMANTIC_MODEL_CANDIDATES.qwen3_embedding_8b,
    referenceModel: EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3,
    declaredEfficiency: {
      providerCallsPerTurn: 0,
      embeddingCallsPerTurn: 0,
      p95LatencyMsPerTurn: 0,
      costUsdPer1kTurns: 0,
      storageBytesPerFact: 0,
      backgroundCallsPerSealedBatch: 0,
    },
    architectureDelta: NO_ARCHITECTURE_CHANGE,
  },
];

export function findLiveExperimentRecipe(candidateKey: string): LiveExperimentRecipe | undefined {
  return LIVE_EXPERIMENT_RECIPES.find((recipe) => recipe.candidateKey === candidateKey);
}

export function liveExperimentRecipeFingerprint(recipe: LiveExperimentRecipe | undefined): string | null {
  if (!recipe) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: recipe.id,
        candidateKey: recipe.candidateKey,
        recipeVersion: recipe.recipeVersion,
        targetOwner: recipe.targetOwner,
        candidateModel: recipe.candidateModel.configVersion,
        referenceModel: recipe.referenceModel.configVersion,
      })
    )
    .digest("hex")
    .slice(0, 16);
}
