import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";

export const CANON_PLAN_VERSION = 1 as const;
export const CANON_COMPILER_VERSION = 1 as const;

export type CanonChunkSalience = "core" | "active" | "dormant";

export type CanonPlanChunk = {
  id: string;
  text: string;
  salience: CanonChunkSalience;
  bucket: CanonKnowledgeBucket;
  /** Stable compile order — lower first */
  order: number;
  sectionTitle: string;
  provenance: {
    sectionIndex: number;
    paragraphIndex: number;
    source: "public_canon" | "compiled_sentence";
  };
};

export type CanonPlanV1 = {
  version: typeof CANON_PLAN_VERSION;
  sourceHash: string;
  compilerVersion: typeof CANON_COMPILER_VERSION;
  chunks: CanonPlanChunk[];
  coreIds: string[];
  provenance: {
    sourceLength: number;
    compiledAt: string;
    publicCanonLineCount: number;
    chunkCount: number;
  };
  retrieval: {
    activeBudgetChars: number;
    archiveBudgetChars: number;
  };
};

export type CanonPlanCompileResult =
  | { ok: true; plan: CanonPlanV1 }
  | { ok: false; error: string };
