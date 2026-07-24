import { normalizeCanonSource } from "@/lib/canonPlan/hash";
import { compileCanonPlanV1, canonCoreInflationMetrics } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import type { CanonPlanChunk, CanonPlanV1 } from "@/lib/canonPlan/types";
import type {
  ActiveCueTest,
  AtomicFact,
  BudgetPressureScene,
  ChunkAuditRow,
  FactMatchResult,
  RootCause,
} from "./types";

const FIXED_NOW = "2026-07-24T00:00:00.000Z";

function norm(s: string): string {
  return normalizeCanonSource(s).toLowerCase();
}

export function compileFixturePlan(creatorRawDescription: string): CanonPlanV1 {
  const r = compileCanonPlanV1({ creatorRawDescription, now: FIXED_NOW });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

export function buildChunkRows(fixtureId: string, plan: CanonPlanV1): ChunkAuditRow[] {
  const coreSet = new Set(plan.coreIds);
  return plan.chunks.map((c) => ({
    fixtureId,
    chunkId: c.id,
    sectionTitle: c.sectionTitle,
    bucket: c.bucket,
    salience: c.salience,
    coreId: coreSet.has(c.id),
    provenanceSource: c.provenance.source,
    charCount: c.text.length,
    text: c.text,
  }));
}

export function buildFixtureTotals(plan: CanonPlanV1, sourceChars: number) {
  const metrics = canonCoreInflationMetrics(plan);
  const bucketDist: Record<string, number> = {};
  for (const c of plan.chunks) {
    bucketDist[c.bucket] = (bucketDist[c.bucket] ?? 0) + 1;
  }
  return {
    sourceChars,
    chunkCount: plan.chunks.length,
    coreChunks: metrics.coreChunks,
    coreChars: metrics.coreChars,
    dormantChunks: metrics.dormantChunks,
    dormantChars: metrics.totalChars - metrics.coreChars,
    bucketDistribution: bucketDist,
    coreRatio: metrics.coreRatio,
  };
}

function scoreHintMatch(chunkText: string, hints: string[]): number {
  const text = norm(chunkText);
  let score = 0;
  for (const h of hints) {
    const nh = norm(h);
    if (!nh) continue;
    if (text.includes(nh)) score++;
  }
  return score;
}

export function matchFactToPlan(fact: AtomicFact, plan: CanonPlanV1): FactMatchResult {
  const hints = fact.matchHints.length ? fact.matchHints : [fact.text];
  const threshold = Math.max(1, Math.ceil(hints.length * 0.6));
  const matched: CanonPlanChunk[] = [];

  for (const chunk of plan.chunks) {
    if (scoreHintMatch(chunk.text, hints) >= threshold) matched.push(chunk);
  }

  // Fallback: any single strong hint across plan
  if (matched.length === 0) {
    for (const chunk of plan.chunks) {
      for (const h of hints) {
        if (h.length >= 3 && norm(chunk.text).includes(norm(h))) {
          matched.push(chunk);
          break;
        }
      }
    }
  }

  const unique = [...new Map(matched.map((c) => [c.id, c])).values()];
  const coreSet = new Set(plan.coreIds);
  const inCore = unique.some((c) => coreSet.has(c.id));
  const inDormant = unique.some((c) => !coreSet.has(c.id));
  const presentInPlan = unique.length > 0;

  let rootCause: RootCause | undefined;
  if (!presentInPlan) rootCause = "compiler_source_loss";
  else if (fact.class === "A" && !inCore && inDormant) {
    rootCause = /(?:불변|절대|immutable|must never)/i.test(unique.map((c) => c.text).join(" "))
      ? undefined
      : "lexical_core_heuristic_miss";
    if (fact.fixtureId === "fundamental-law-prose") rootCause = "lexical_core_heuristic_miss";
  } else if (fact.class === "C" && inCore) rootCause = "salience_misclassification";
  else if (fact.class === "C" && unique.some((c) => c.bucket === "character" || c.bucket === "world")) {
    if (inCore) rootCause = "salience_misclassification";
  }

  return {
    fact,
    presentInPlan,
    inCore,
    inDormant: presentInPlan && !inCore,
    omittedOrSemanticallyLost: !presentInPlan,
    matchedChunkIds: unique.map((c) => c.id),
    matchedChunkSalience: unique.map((c) => c.salience),
    rootCause,
  };
}

export function classifyPublicCoverage(fact: AtomicFact, match: FactMatchResult) {
  if (!match.presentInPlan) return "absent" as const;
  if (match.inCore) return "core" as const;
  if (match.inDormant) return "dormant_preserved" as const;
  return "partial" as const;
}

export function auditRestrictedLeakage(fact: AtomicFact, plan: CanonPlanV1, match: FactMatchResult) {
  const coreSet = new Set(plan.coreIds);
  const incorrectlyCore = match.matchedChunkIds.some((id) => coreSet.has(id));
  const chunks = plan.chunks.filter((c) => match.matchedChunkIds.includes(c.id));
  const wrongBucket = chunks.some((c) => c.bucket === "character" || c.bucket === "world");
  const eligibleActive = chunks.some((c) => !coreSet.has(c.id) && c.bucket !== "player" && c.bucket !== "scenario_meta");
  const quiet = selectActiveCanonChunks({ plan, userMessage: "오늘 날씨 좋네. 그냥 쉬자." });
  const falseActive = quiet.selectedIds.some((id) => match.matchedChunkIds.includes(id));
  return {
    factId: fact.id,
    incorrectlyCore,
    wrongBucketOrdinaryKnowledge: wrongBucket && fact.class === "C",
    eligibleForActive: eligibleActive,
    falseActiveOnQuietCue: falseActive,
    bucketOk: chunks.every((c) => c.bucket === "player" || c.bucket === "scenario_meta" || c.salience === "dormant"),
  };
}

function chunkMatchesFact(plan: CanonPlanV1, fact: AtomicFact): Set<string> {
  const m = matchFactToPlan(fact, plan);
  return new Set(m.matchedChunkIds);
}

export function runActiveCueTest(plan: CanonPlanV1, test: ActiveCueTest, facts: AtomicFact[]) {
  const fact = facts.find((f) => f.id === test.factId);
  if (!fact) throw new Error("missing fact " + test.factId);
  const targetIds = chunkMatchesFact(plan, fact);
  const sel = selectActiveCanonChunks({
    plan,
    userMessage: test.userMessage,
    recentContext: test.recentContext,
    recentTurns: test.recentContext
      ? [{ role: "user", content: test.recentContext }]
      : undefined,
    budgetChars: 1200,
  });
  const hit = sel.selectedIds.some((id) => targetIds.has(id));
  return {
    ...test,
    hit,
    pass: hit === test.expectHit,
    selectedIds: sel.selectedIds,
    selectedChars: sel.selectedChars,
    keywords: sel.keywords,
  };
}

export function runBudgetPressure(plan: CanonPlanV1, scene: BudgetPressureScene, facts: AtomicFact[]) {
  const relevantFacts = scene.relevantFactIds.map((id) => {
    const f = facts.find((x) => x.id === id);
    if (!f) throw new Error("missing fact " + id);
    return f;
  });
  const relevantChunkIds = new Set<string>();
  let eligibleRelevantChars = 0;
  for (const f of relevantFacts) {
    const m = matchFactToPlan(f, plan);
    for (const id of m.matchedChunkIds) {
      relevantChunkIds.add(id);
      const ch = plan.chunks.find((c) => c.id === id)!;
      if (!plan.coreIds.includes(id) && ch.bucket !== "player" && ch.bucket !== "scenario_meta") {
        eligibleRelevantChars += ch.text.length;
      }
    }
  }

  const sel = selectActiveCanonChunks({ plan, userMessage: scene.userMessage, budgetChars: 1200 });
  const selectedRelevant = sel.selectedIds.filter((id) => relevantChunkIds.has(id));
  const droppedRelevant = [...relevantChunkIds].filter((id) => !sel.selectedIds.includes(id));

  let missCause: RootCause = "active_keyword_retrieval_miss";
  if (sel.selectedChars >= 1200 && droppedRelevant.length > 0) missCause = "active_budget_pressure";
  else if (selectedRelevant.length === 0 && sel.keywords.length === 0) missCause = "active_keyword_retrieval_miss";
  else if (droppedRelevant.length > 0 && sel.selectedChars < 1200) missCause = "active_keyword_retrieval_miss";

  return {
    ...scene,
    eligibleRelevantChars,
    eligibleRelevantChunks: relevantChunkIds.size,
    selectedChars: sel.selectedChars,
    selectedChunks: sel.selectedCount,
    selectedRelevantCount: selectedRelevant.length,
    droppedRelevantIds: droppedRelevant,
    missCause: droppedRelevant.length ? missCause : null,
    selectedIds: sel.selectedIds,
  };
}

export function summarizeARecall(matches: FactMatchResult[]) {
  const aFacts = matches.filter((m) => m.fact.class === "A");
  const total = aFacts.length;
  const inCore = aFacts.filter((m) => m.inCore).length;
  const dormant = aFacts.filter((m) => m.presentInPlan && !m.inCore).length;
  const missing = aFacts.filter((m) => m.omittedOrSemanticallyLost).length;
  return {
    total,
    inCore,
    dormant,
    missing,
    recall: total > 0 ? inCore / total : 0,
  };
}

export function rootCauseDistribution(matches: FactMatchResult[], activeFails: ReturnType<typeof runActiveCueTest>[]) {
  const counts: Partial<Record<RootCause, number>> = {};
  const bump = (k: RootCause) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  for (const m of matches) {
    if (m.fact.class === "A" && m.presentInPlan && !m.inCore) bump("lexical_core_heuristic_miss");
    if (m.omittedOrSemanticallyLost) bump("compiler_source_loss");
    if (m.fact.class === "C" && m.inCore) bump("salience_misclassification");
  }
  for (const t of activeFails) {
    if (!t.pass && t.expectHit && t.kind === "direct") bump("active_keyword_retrieval_miss");
    if (!t.pass && t.expectHit && t.kind === "indirect") bump("indirect_semantic_cue_miss");
  }
  return counts;
}

export { FIXED_NOW };
