import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";
import type { CanonChunkSalience } from "@/lib/canonPlan/types";

export type FixtureGenre =
  | "post_apocalypse"
  | "fantasy_magic_law"
  | "sentinel_guide"
  | "hunter_dungeon"
  | "modern_relationship"
  | "political_faction"
  | "family_simulation"
  | "secret_heavy"
  | "curse_condition"
  | "survival_resources"
  | "fundamental_law_prose"
  | "mixed_benchmark";

export type AuditFixture = {
  id: string;
  label: string;
  genre: FixtureGenre;
  creatorRawDescription: string;
};

export type FactClass = "A" | "B" | "C";

/** Human-labeled atomic creator fact for audit. */
export type AtomicFact = {
  id: string;
  fixtureId: string;
  class: FactClass;
  /** Short atomic statement — audit label, not copied private prod text. */
  text: string;
  /** Substrings that must appear in a matching plan chunk (deterministic match). */
  matchHints: string[];
  notes?: string;
};

export type ActiveCueKind = "direct" | "indirect" | "quiet";

export type ActiveCueTest = {
  id: string;
  fixtureId: string;
  factId: string;
  kind: ActiveCueKind;
  userMessage: string;
  recentContext?: string;
  /** Whether selectActiveCanonChunks should include a chunk matching this B fact. */
  expectHit: boolean;
};

export type BudgetPressureScene = {
  id: string;
  fixtureId: string;
  label: string;
  userMessage: string;
  relevantFactIds: string[];
  expectedRelevantCount: number;
};

export type ChunkAuditRow = {
  fixtureId: string;
  chunkId: string;
  sectionTitle: string;
  bucket: CanonKnowledgeBucket;
  salience: CanonChunkSalience;
  coreId: boolean;
  provenanceSource: string;
  charCount: number;
  text: string;
};

export type FactMatchResult = {
  fact: AtomicFact;
  presentInPlan: boolean;
  inCore: boolean;
  inDormant: boolean;
  omittedOrSemanticallyLost: boolean;
  matchedChunkIds: string[];
  matchedChunkSalience: CanonChunkSalience[];
  rootCause?: string;
};

export type RootCause =
  | "compiler_source_loss"
  | "bucket_misclassification"
  | "salience_misclassification"
  | "lexical_core_heuristic_miss"
  | "active_keyword_retrieval_miss"
  | "indirect_semantic_cue_miss"
  | "active_budget_pressure"
  | "intentional_restricted_exclusion"
  | "other";
