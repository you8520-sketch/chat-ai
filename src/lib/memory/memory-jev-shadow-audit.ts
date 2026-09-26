/**
 * Jev shadow-memory audit helpers — pure, provider-free, DB-free.
 *
 * READER AUDIT (Phase 9):
 * - writer/caller: `src/lib/memory/memory-jev-shadow-audit.test.ts`,
 *   `src/lib/memory/memory-rp-benchmark.test.ts` (audit/benchmark harness only).
 * - runtime reader: NONE by design — no production path imports this module,
 *   so it cannot change user-visible behavior. (SAFE TO KEEP as audit/test
 *   utility; not a production runtime helper.)
 * - test reader: the two harness tests above.
 * - future approved reader: the semantic-candidate-discovery follow-up PR,
 *   which may reuse `classifyShadowStage` and the fixture stage vocabulary.
 *
 * CODE OWNS STATE. JEV ADVISES SEMANTICS (shadow only).
 * This module never calls OpenRouter/TypeSafe, never writes canonical memory,
 * and never renders Persona Secret text. It only classifies deterministic
 * stage snapshots produced by the existing canonical owners
 * (`fetchEpisodicMemoryCandidatesForDebug` / `getEpisodicMemoryForPrompt`).
 */

/**
 * Retrieval-stage failures ONLY (Phase 7 correction).
 * CAPTURE_FAILURE (extraction/persistence miss) and MODEL_COMPLIANCE_FAILURE
 * (Main RP ignoring a correct prompt) need their own separate evidence
 * owners and MUST NOT be inferred from the pre-candidate/post-rank/final
 * triple this classifier consumes — so they are deliberately absent from
 * this union instead of being listed as if supported.
 */
export type ShadowRetrievalStage =
  | "CANDIDATE_RECALL_FAILURE"
  | "RANKING_FAILURE"
  | "TEMPORAL_FAILURE";

export type JevShadowApplicability =
  | "JEV_RERANK_NOT_APPLICABLE"
  | "JEV_RERANK_CANDIDATE_RANKING_ONLY"
  | "JEV_SHADOW_NO_OP_ALREADY_CORRECT"
  | "JEV_SHADOW_NO_OP_ZERO_RELEVANT";

export type ShadowStageSnapshot = {
  /** Answer fact id present in the bounded pre-rank candidate set. */
  answerInPreCandidateSet: boolean;
  /** Answer fact received a passing post-rank score (final_rank != null). */
  answerPassedRelevanceGate: boolean;
  /** Answer fact text reached the final production prompt block. */
  answerInFinalPrompt: boolean;
  /** No answer exists for this case (zero-relevant control). */
  zeroRelevantControl: boolean;
  /** Answer fact is stale state that must NOT win over the latest row. */
  staleStateControl: boolean;
};

export function describeShadowRetrievalStage(stage: ShadowRetrievalStage): string {
  switch (stage) {
    case "CANDIDATE_RECALL_FAILURE":
      return "answer fact is in DB but missed the pre-rank candidate set";
    case "RANKING_FAILURE":
      return "answer fact is a candidate but lost ranking or the relevance gate";
    case "TEMPORAL_FAILURE":
      return "old/current/historical reconciliation chose the wrong row";
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/**
 * Canonical retrieval-stage classifier. Jev rerank is applicable ONLY when
 * the answer is already inside the existing bounded candidate set but fails
 * ranking. Paraphrase misses at candidate discovery are explicitly NOT
 * rerank cases: they belong to a separate semantic-discovery follow-up.
 */
export function classifyShadowStage(snapshot: ShadowStageSnapshot): {
  stage: ShadowRetrievalStage | null;
  applicability: JevShadowApplicability;
} {
  if (snapshot.zeroRelevantControl) {
    return { stage: null, applicability: "JEV_SHADOW_NO_OP_ZERO_RELEVANT" };
  }
  if (snapshot.answerInFinalPrompt) {
    return { stage: null, applicability: "JEV_SHADOW_NO_OP_ALREADY_CORRECT" };
  }
  if (!snapshot.answerInPreCandidateSet) {
    return {
      stage: snapshot.staleStateControl ? "TEMPORAL_FAILURE" : "CANDIDATE_RECALL_FAILURE",
      applicability: "JEV_RERANK_NOT_APPLICABLE",
    };
  }
  return { stage: "RANKING_FAILURE", applicability: "JEV_RERANK_CANDIDATE_RANKING_ONLY" };
}

export type ShadowSanitizedCandidate = {
  /** Local alias only (P0/P1/...) — raw DB ids never leave the server. */
  alias: string;
  factText: string;
};

export type ShadowJevInput = {
  /** Bounded semantic representation of the current scene/query only. */
  sceneQuery: string;
  candidates: ShadowSanitizedCandidate[];
};

/**
 * Audit-only caller policy (Phase 8, option A — no new privacy subsystem).
 *
 * This builder CANNOT structurally prevent a caller from passing arbitrary
 * strings (transcript excerpts, Global Memory, Persona Secret canonical
 * text): `candidateTexts` is `readonly string[]`, so any text is
 * type-compatible. The restriction is a CALLER POLICY, not a type guarantee:
 * approved callers MUST pass only bounded episodic-candidate fact excerpts
 * already selected by the existing candidate-discovery owner, plus a bounded
 * scene/query representation. Whole transcripts, Global Memory, Persona
 * Secret canonical text, unrelated user data, raw DB ids, credentials, and
 * arbitrary system prompts MUST NOT be passed. A future production
 * integration must replace this policy with a sanitizer owner that
 * structurally enforces it; until then there is no production caller.
 */
export const SHADOW_INPUT_CALLER_POLICY =
  "audit-only: bounded candidate excerpts + bounded scene query; " +
  "never transcript / Global Memory / Persona Secret canonical text / " +
  "unrelated user data / raw DB ids / credentials / system prompts";

export function buildShadowJevInput(opts: {
  sceneQuery: string;
  candidateTexts: readonly string[];
  maxCandidates?: number;
  maxCharsPerCandidate?: number;
}): ShadowJevInput {
  const maxCandidates = Math.max(1, Math.min(16, Math.trunc(opts.maxCandidates ?? 8)));
  const maxChars = Math.max(40, Math.min(400, Math.trunc(opts.maxCharsPerCandidate ?? 200)));
  const candidates: ShadowSanitizedCandidate[] = [];
  for (const text of opts.candidateTexts.slice(0, maxCandidates)) {
    const alias = `P${candidates.length}`;
    candidates.push({ alias, factText: text.slice(0, maxChars) });
  }
  return { sceneQuery: opts.sceneQuery.slice(0, 500), candidates };
}
