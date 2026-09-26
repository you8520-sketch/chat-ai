/**
 * Deterministic synthetic embedding fixture shared by the semantic discovery
 * tests and the #1072 RP memory benchmark. It stands in for a real model only
 * to exercise the pipeline — its similarities say nothing about bge-m3/qwen.
 *
 * Vector = concept features (paraphrase synonyms share a concept dimension)
 * + small hashed token features (so unrelated texts are near-orthogonal but
 * never exactly zero). Unit-normalized downstream by the canonical owner.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import type Database from "better-sqlite3";
import {
  EPISODIC_SEMANTIC_MODEL_CANDIDATES,
  type EpisodicSemanticModelConfig,
  type EpisodicSemanticRuntime,
} from "@/lib/memory/memory-episodic-semantic-config";
import {
  resolveEpisodicSemanticQuery,
  runEpisodicSemanticIndexJob,
  type EpisodicEmbedder,
} from "@/lib/memory/memory-episodic-semantic-jobs";
import type { EpisodicSemanticQuery } from "@/lib/memory/memory-episodic-semantic-index";

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
const HASH_DIMS = 8;
const HASH_WEIGHT = 0.15;

export const SYNTHETIC_DIMENSIONS = CONCEPTS.length + HASH_DIMS;

function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % HASH_DIMS;
}

export function syntheticEmbed(text: string): number[] {
  const v = new Array<number>(SYNTHETIC_DIMENSIONS).fill(0);
  CONCEPTS.forEach((terms, dim) => {
    if (terms.some((term) => text.includes(term))) v[dim] = 1;
  });
  for (const token of text.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2)) {
    v[CONCEPTS.length + hashToken(token)]! += HASH_WEIGHT;
  }
  return v;
}

/** Test-only model: provisional thresholds come from the canonical config owner. */
export const SYNTHETIC_SEMANTIC_MODEL: EpisodicSemanticModelConfig = {
  ...EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3,
  modelId: "test/synthetic-concept-embedding",
  dimensions: SYNTHETIC_DIMENSIONS,
  configVersion: `synthetic-concept@${SYNTHETIC_DIMENSIONS}/test-only`,
};

export function syntheticRuntime(
  model: EpisodicSemanticModelConfig = SYNTHETIC_SEMANTIC_MODEL
): EpisodicSemanticRuntime {
  return { enabled: true, model };
}

export function countingSyntheticEmbedder(): { embed: EpisodicEmbedder; calls: () => number; inputs: () => number } {
  let calls = 0;
  let inputs = 0;
  return {
    embed: async (texts) => {
      calls += 1;
      inputs += texts.length;
      return texts.map(syntheticEmbed);
    },
    calls: () => calls,
    inputs: () => inputs,
  };
}

/** Drives the canonical bounded index job until idle. */
export async function indexChatSynthetically(
  db: Database.Database,
  chatId: number,
  model: EpisodicSemanticModelConfig = SYNTHETIC_SEMANTIC_MODEL,
  embed: EpisodicEmbedder = countingSyntheticEmbedder().embed
): Promise<number> {
  let written = 0;
  for (let round = 0; round < 1000; round++) {
    const result = await runEpisodicSemanticIndexJob({ db, chatId, runtime: syntheticRuntime(model), embed });
    written += result.written;
    if (result.status !== "indexed") return written;
  }
  throw new Error("synthetic index job did not reach idle");
}

export async function syntheticQuery(
  text: string,
  model: EpisodicSemanticModelConfig = SYNTHETIC_SEMANTIC_MODEL
): Promise<EpisodicSemanticQuery> {
  const resolved = await resolveEpisodicSemanticQuery({
      contentRoute: "safe",
    query: text,
    runtime: syntheticRuntime(model),
    embed: countingSyntheticEmbedder().embed,
  });
  assert.ok(resolved.query, `synthetic query must resolve (${resolved.reason})`);
  return resolved.query;
}

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return dot / (na * nb);
}

it("synthetic embedder is deterministic and separates the known-gap paraphrase from unrelated text", () => {
  const fact = "사용자는 천둥 소리를 무서워한다고 명시했다.";
  const query = "폭풍우 속 옛 공포가 되살아나는 밤";
  const filler = "채우기 기록 3번 항해 일지 바다 파도";
  assert.deepEqual(syntheticEmbed(fact), syntheticEmbed(fact));
  const pass = SYNTHETIC_SEMANTIC_MODEL.similarityPassThreshold;
  assert.ok(cosine(syntheticEmbed(fact), syntheticEmbed(query)) >= pass);
  assert.ok(cosine(syntheticEmbed(filler), syntheticEmbed(query)) < pass);
});
