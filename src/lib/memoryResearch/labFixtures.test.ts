/**
 * Test-only fixtures for the memory research lab (imported by *.test.ts only).
 * Fixture adapters are never registered in EXPERIMENT_ADAPTERS.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import type { EpisodicEmbedder } from "@/lib/memory/memory-episodic-semantic-jobs";
import type { BenchmarkMode } from "@/lib/memory/memory-rp-benchmark-suite";
import type { ArchitectureDelta, DeclaredProductionEfficiency, ExperimentAdapter } from "@/lib/memoryResearch/experiments";
import type { ResearchObservation } from "@/lib/memoryResearch/types";
import {
  SYNTHETIC_SEMANTIC_MODEL,
  syntheticEmbed,
} from "@/lib/memory/memory-episodic-semantic-synthetic.test";

const CONCEPTS: string[][] = [
  ["천둥", "폭풍", "번개", "뇌우"],
  ["무서", "공포", "두려", "겁"],
  ["항해", "바다", "파도"],
  ["탑"],
  ["등잔", "등불"],
  ["항구", "정박"],
  ["옛", "기억", "떠올"],
  ["첫 만남", "인연", "시작"],
];
const WIDE_HASH_DIMS = 512;

function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % WIDE_HASH_DIMS;
}

/** Concept features + wide hashed tokens: concept-free texts become near-orthogonal. */
export function wideSyntheticEmbed(text: string): number[] {
  const v = new Array<number>(CONCEPTS.length + WIDE_HASH_DIMS).fill(0);
  CONCEPTS.forEach((terms, dim) => {
    if (terms.some((term) => text.includes(term))) v[dim] = 1;
  });
  for (const token of text.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2)) {
    v[CONCEPTS.length + hashToken(token)]! += 0.15;
  }
  return v;
}

export const ZERO_DECLARED: DeclaredProductionEfficiency = {
  providerCallsPerTurn: 0,
  embeddingCallsPerTurn: 1,
  p95LatencyMsPerTurn: 80,
  costUsdPer1kTurns: 0.02,
  storageBytesPerFact: 4096,
  backgroundCallsPerSealedBatch: 1,
};

export const NO_INFRA_DELTA: ArchitectureDelta = {
  before: "semantic lane flag-off; lexical Retrieval V2 is the only discovery lane",
  proposed: "enable the additive semantic lane with the candidate embedder",
  after: "episodicMemoryFacts.ts remains the single retrieval owner; semantic lane config in memory-episodic-semantic-config.ts",
  removed: [],
  newDb: [],
  newFlags: [],
  newProviders: [],
  newDependencies: [],
  newSchedulers: [],
  ownerCountDelta: 0,
  runtimePathDelta: 0,
};

function semanticMode(label: string, embedOne: (text: string) => number[], dimensions: number): BenchmarkMode {
  const embed: EpisodicEmbedder = async (texts) => texts.map(embedOne);
  return {
    label,
    semantic: { model: { ...SYNTHETIC_SEMANTIC_MODEL, dimensions, configVersion: `${label}@${dimensions}/test-only` }, embed },
    strict: false,
  };
}

/** Known to regress false-memory on the expanded baseline (8 hash dims collide). */
export function narrowSyntheticAdapter(candidateKey: string, adapterVersion = "1"): ExperimentAdapter {
  return {
    candidateKey,
    adapterVersion,
    targetOwner: "semantic_retrieval",
    description: "fixture: narrow synthetic concept embedder",
    buildMode: () => semanticMode("narrow-synthetic", syntheticEmbed, SYNTHETIC_SEMANTIC_MODEL.dimensions),
    declaredEfficiency: ZERO_DECLARED,
    architectureDelta: NO_INFRA_DELTA,
  };
}

export function wideSyntheticAdapter(candidateKey: string, adapterVersion = "1"): ExperimentAdapter {
  return {
    candidateKey,
    adapterVersion,
    targetOwner: "semantic_retrieval",
    description: "fixture: wide-hash synthetic concept embedder",
    buildMode: () => semanticMode("wide-synthetic", wideSyntheticEmbed, CONCEPTS.length + WIDE_HASH_DIMS),
    declaredEfficiency: ZERO_DECLARED,
    architectureDelta: NO_INFRA_DELTA,
  };
}

export function observation(overrides: Partial<ResearchObservation> & { candidateKey: string }): ResearchObservation {
  return {
    sourceKind: "github_repository",
    sourceUrl: `https://github.com/${overrides.candidateKey.replace(/^github:/, "")}`,
    title: overrides.candidateKey,
    version: "v1.0.0",
    publishedAt: "2026-09-01T00:00:00Z",
    summary: "fixture",
    claimedAdvantage: "better paraphrase recall",
    category: "embedding_model",
    evidence: { hasReproducibleCode: true, hasPublishedBenchmark: true, archived: false, lastActivityAt: "2026-09-20T00:00:00Z" },
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
    ...overrides,
  };
}

it("wide synthetic embedder keeps concept-free texts near-orthogonal (fixture sanity)", () => {
  const a = wideSyntheticEmbed("우리가 결혼식을 올렸던 날을 묻는다");
  const b = wideSyntheticEmbed("다음 만남에 책을 가져오기로 했다.");
  const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
  assert.ok(dot < 0.05);
});
