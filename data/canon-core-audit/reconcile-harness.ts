/**
 * Phase 1.5 — metric reconciliation harness.
 * Mirrors compiler salience logic READ-ONLY for tracing (does not modify compiler.ts).
 */
import { normalizeCanonSource } from "@/lib/canonPlan/hash";
import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import type { CanonPlanChunk, CanonPlanV1 } from "@/lib/canonPlan/types";
import type { AtomicFact, BudgetPressureScene } from "./types";
import { FIXED_NOW } from "./harness";

import {
  CORE_EXPLICIT_LAW_MARKER,
  CORE_IDENTITY_BODY,
  CORE_SECTION_TITLE,
  DORMANT_PLOT_HOOK_BASE,
  EXPLICIT_LAW_SECTION_TITLE,
  inferSalienceWithReason,
  isGenuinePlotHook,
  isPermanentRampageLaw,
  WORLD_LAW_TITLE,
} from "@/lib/canonPlan/canonSalience";

export type SourceStatus = "PRESERVED_FULL" | "PRESERVED_PARTIAL" | "ABSENT";
export type SalienceStatus = "CORE" | "DORMANT" | "N/A_IF_ABSENT";

export type AFPrimaryCause =
  | "SOURCE_LOSS"
  | "WRONG_BUCKET"
  | "WORLD_LAW_TITLE_NOT_RECOGNIZED"
  | "DORMANT_PLOT_HOOK_PRECEDENCE"
  | "CORE_LEXICAL_MARKER_MISS"
  | "NATURAL_LANGUAGE_FUNDAMENTAL_LAW_MISS"
  | "OTHER"
  | "NONE_PASS";

function norm(s: string): string {
  return normalizeCanonSource(s).toLowerCase();
}

export function compilePlan(raw: string): CanonPlanV1 {
  const r = compileCanonPlanV1({ creatorRawDescription: raw, now: FIXED_NOW });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

export function matchFactChunks(fact: AtomicFact, plan: CanonPlanV1) {
  const hints = fact.matchHints.length ? fact.matchHints : [fact.text];
  const threshold = Math.max(1, Math.ceil(hints.length * 0.6));
  const scored: Array<{ chunk: CanonPlanChunk; hintHits: number }> = [];

  for (const chunk of plan.chunks) {
    const text = norm(chunk.text);
    let hits = 0;
    for (const h of hints) {
      const nh = norm(h);
      if (nh && text.includes(nh)) hits++;
    }
    if (hits > 0) scored.push({ chunk, hintHits: hits });
  }

  scored.sort((a, b) => b.hintHits - a.hintHits);
  const full = scored.filter((s) => s.hintHits >= threshold);

  if (full.length > 0) {
    return { sourceStatus: "PRESERVED_FULL" as SourceStatus, chunks: full.map((s) => s.chunk) };
  }
  if (scored.length > 0) {
    return { sourceStatus: "PRESERVED_PARTIAL" as SourceStatus, chunks: scored.map((s) => s.chunk) };
  }
  return { sourceStatus: "ABSENT" as SourceStatus, chunks: [] as CanonPlanChunk[] };
}

export function salienceStatusForFact(sourceStatus: SourceStatus, chunks: CanonPlanChunk[], plan: CanonPlanV1): SalienceStatus {
  if (sourceStatus === "ABSENT") return "N/A_IF_ABSENT";
  const coreSet = new Set(plan.coreIds);
  if (chunks.some((c) => coreSet.has(c.id))) return "CORE";
  return "DORMANT";
}

export type SalienceTrace = {
  steps: string[];
  plotHookMatch: string | null;
  coreSectionTitleMatch: boolean;
  coreIdentityBodyMatch: boolean;
  coreWorldLawTextMatch: boolean;
  worldLawTitleMatch: boolean;
  inferredSalience: "core" | "dormant";
};

export function traceSalience(chunk: Pick<CanonPlanChunk, "text" | "bucket" | "sectionTitle">): SalienceTrace {
  const decision = inferSalienceWithReason(chunk);
  const plotMatch = chunk.text.match(DORMANT_PLOT_HOOK_BASE) ?? (isGenuinePlotHook(chunk.text) ? ["plot"] : null);
  const steps = [...decision.reason === "PLOT_HOOK" ? [`genuine plot hook → dormant`] : [], ...getReasonSteps(decision.reason, chunk)];
  return {
    steps,
    plotHookMatch: plotMatch?.[0] ?? (isGenuinePlotHook(chunk.text) && !isPermanentRampageLaw(chunk.text) ? "plot-hook" : null),
    coreSectionTitleMatch: CORE_SECTION_TITLE.test(chunk.sectionTitle),
    coreIdentityBodyMatch: CORE_IDENTITY_BODY.test(chunk.text.slice(0, 48)),
    coreWorldLawTextMatch: CORE_EXPLICIT_LAW_MARKER.test(chunk.text),
    worldLawTitleMatch: EXPLICIT_LAW_SECTION_TITLE.test(chunk.sectionTitle) || WORLD_LAW_TITLE.test(chunk.sectionTitle),
    inferredSalience: decision.salience,
  };
}

function getReasonSteps(reason: string, chunk: Pick<CanonPlanChunk, "text" | "bucket" | "sectionTitle">): string[] {
  switch (reason) {
    case "RESTRICTED_BUCKET":
      return ["player/scenario_meta → dormant"];
    case "EXPLICIT_LAW_SECTION":
      return ["EXPLICIT_LAW_SECTION_TITLE → core"];
    case "EXPLICIT_LAW_MARKER":
      return ["CORE_EXPLICIT_LAW_MARKER → core"];
    case "PERMANENT_RAMPAGE_LAW":
      return ["PERMANENT_RAMPAGE_LAW → core"];
    case "FUNDAMENTAL_IMPOSSIBILITY":
      return ["F1 strong impossibility → core"];
    case "FUNDAMENTAL_MANDATORY_COST":
      return ["F2 mandatory capability cost → core"];
    case "FUNDAMENTAL_HAZARD_RESPONSE":
      return ["F3 deterministic hazard response → core"];
    case "IDENTITY_SECTION":
      return ["CORE_SECTION_TITLE → core"];
    case "IDENTITY_BODY":
      return ["CORE_IDENTITY_BODY → core"];
    default:
      return [`${chunk.bucket} bucket → dormant`];
  }
}

export function classifyAFailure(
  fact: AtomicFact,
  sourceStatus: SourceStatus,
  salience: SalienceStatus,
  chunk: CanonPlanChunk | undefined,
  trace: SalienceTrace | undefined
): { primary: AFPrimaryCause; secondary: AFPrimaryCause[] } {
  if (fact.class !== "A") return { primary: "NONE_PASS", secondary: [] };
  if (salience === "CORE") return { primary: "NONE_PASS", secondary: [] };
  if (sourceStatus === "ABSENT") return { primary: "SOURCE_LOSS", secondary: [] };
  if (!chunk || !trace) return { primary: "OTHER", secondary: [] };

  const secondary: AFPrimaryCause[] = [];

  if (fact.fixtureId === "fundamental-law-prose") {
    return { primary: "NATURAL_LANGUAGE_FUNDAMENTAL_LAW_MISS", secondary: trace.worldLawTitleMatch ? ["WORLD_LAW_TITLE_NOT_RECOGNIZED"] : [] };
  }

  if (trace.plotHookMatch) {
    const isPlotMeta = /호감|해금|트리거|루트|고백/.test(chunk.text) && !isPermanentRampageLaw(chunk.text);
    if (!isPlotMeta && trace.plotHookMatch !== "plot-hook") {
      return { primary: "DORMANT_PLOT_HOOK_PRECEDENCE", secondary: ["NATURAL_LANGUAGE_FUNDAMENTAL_LAW_MISS"] };
    }
    if (isPlotMeta) return { primary: "DORMANT_PLOT_HOOK_PRECEDENCE", secondary: [] };
  }

  if (trace.worldLawTitleMatch && chunk.bucket === "character") {
    if (trace.coreWorldLawTextMatch) secondary.push("CORE_LEXICAL_MARKER_MISS");
    return { primary: "WORLD_LAW_TITLE_NOT_RECOGNIZED", secondary };
  }

  if (trace.coreWorldLawTextMatch && chunk.bucket === "character") {
    return { primary: "WORLD_LAW_TITLE_NOT_RECOGNIZED", secondary: ["CORE_LEXICAL_MARKER_MISS"] };
  }

  if (trace.coreSectionTitleMatch || trace.coreIdentityBodyMatch) {
    return { primary: "OTHER", secondary: [] };
  }

  return { primary: "NATURAL_LANGUAGE_FUNDAMENTAL_LAW_MISS", secondary: trace.worldLawTitleMatch ? ["WORLD_LAW_TITLE_NOT_RECOGNIZED"] : [] };
}

export function auditPlotHookOnAFacts(facts: AtomicFact[], plan: CanonPlanV1, fixtureId: string) {
  return facts
    .filter((f) => f.fixtureId === fixtureId && f.class === "A")
    .map((fact) => {
      const { chunks } = matchFactChunks(fact, plan);
      const chunk = chunks[0];
      if (!chunk) return { factId: fact.id, plotHookMatch: null, falseDormantRisk: false };
      const trace = traceSalience(chunk);
      const genuinelyPlotHook = /호감|해금|트리거|루트|고백|유저만|회귀/.test(chunk.text);
      const isFundamental = /법|규칙|규약|결국|반드시|즉사|되살릴|수명|동조체/.test(chunk.text) && !genuinelyPlotHook;
      return {
        factId: fact.id,
        plotHookMatch: trace.plotHookMatch,
        genuinelyPlotHook,
        isFundamentalConstraint: isFundamental,
        falseDormantRisk: !!trace.plotHookMatch && isFundamental && !genuinelyPlotHook,
        chunkSnippet: chunk.text.slice(0, 100),
      };
    });
}

function isActiveEligible(chunk: CanonPlanChunk, plan: CanonPlanV1): boolean {
  const coreSet = new Set(plan.coreIds);
  return !coreSet.has(chunk.id) && chunk.salience !== "core" && chunk.bucket !== "player" && chunk.bucket !== "scenario_meta";
}

function scoreChunk(chunk: CanonPlanChunk, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = chunk.text.toLowerCase();
  const titleLower = chunk.sectionTitle.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += 2;
    else if (titleLower.includes(keyword)) score += 1;
  }
  return score;
}

export function runBudgetReconciliation(plan: CanonPlanV1, scene: BudgetPressureScene, facts: AtomicFact[]) {
  const relevantFacts = scene.relevantFactIds.map((id) => facts.find((f) => f.id === id)!);
  const relevantChunkMap = new Map<string, string>();
  for (const f of relevantFacts) {
    for (const c of matchFactChunks(f, plan).chunks) relevantChunkMap.set(c.id, f.id);
  }
  const expectedRelevantChunks = [...relevantChunkMap.keys()];
  let expectedRelevantChars = 0;
  for (const id of expectedRelevantChunks) {
    const ch = plan.chunks.find((c) => c.id === id)!;
    if (isActiveEligible(ch, plan)) expectedRelevantChars += ch.text.length;
  }

  const sel = selectActiveCanonChunks({ plan, userMessage: scene.userMessage, budgetChars: 1200 });
  const eligible = plan.chunks.filter((c) => isActiveEligible(c, plan));
  const selectedSet = new Set(sel.selectedIds);
  const selectedRelevant = sel.selectedIds.filter((id) => relevantChunkMap.has(id));
  const selectedIrrelevant = sel.selectedIds.filter((id) => !relevantChunkMap.has(id));
  const charSum = (ids: string[]) => ids.reduce((s, id) => s + (plan.chunks.find((c) => c.id === id)?.text.length ?? 0), 0);
  const droppedRelevant = expectedRelevantChunks.filter((id) => !selectedSet.has(id));

  const dropAnalysis = droppedRelevant.map((id) => {
    const ch = plan.chunks.find((c) => c.id === id)!;
    const factId = relevantChunkMap.get(id);
    if (!isActiveEligible(ch, plan)) return { chunkId: id, factId, cause: "KNOWLEDGE_BOUNDARY_EXCLUSION" as const };
    const score = scoreChunk(ch, sel.keywords);
    if (score <= 0) return { chunkId: id, factId, cause: "NO_SCORE_RETRIEVAL_MISS" as const, score };
    const ranked = eligible
      .map((c) => ({ c, score: scoreChunk(c, sel.keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.order - b.c.order);
    let used = 0;
    let wouldFit = false;
    for (const { c, score: sc } of ranked) {
      if (sc <= 0) continue;
      const next = used + c.text.length;
      if (next > 1200 && used > 0) break;
      if (c.id === id) {
        wouldFit = true;
        break;
      }
      used = next;
    }
    if (!wouldFit) return { chunkId: id, factId, cause: "DROPPED_BY_1200_CHAR_BUDGET" as const, score };
    const rank = ranked.findIndex((x) => x.c.id === id);
    const selectedRankCount = sel.selectedIds.length;
    if (rank >= selectedRankCount) return { chunkId: id, factId, cause: "RANKED_BELOW_FALSE_POSITIVES" as const, score, rank };
    return { chunkId: id, factId, cause: "OTHER" as const, score, rank };
  });

  const budgetPressureDrop = dropAnalysis.some((d) => d.cause === "DROPPED_BY_1200_CHAR_BUDGET");
  const irrelevantConsumingBudget =
    selectedIrrelevant.length > 0 &&
    dropAnalysis.some((d) => d.cause === "RANKED_BELOW_FALSE_POSITIVES" || d.cause === "DROPPED_BY_1200_CHAR_BUDGET");

  return {
    sceneId: scene.id,
    expectedRelevantChunks: expectedRelevantChunks.length,
    expectedRelevantChars,
    selectorCandidateChunks: sel.eligibleAfterBoundaryCount,
    selectedTotalChunks: sel.selectedCount,
    selectedTotalChars: sel.selectedChars,
    selectedRelevantChunks: selectedRelevant.length,
    selectedRelevantChars: charSum(selectedRelevant),
    selectedIrrelevantChunks: selectedIrrelevant.length,
    selectedIrrelevantChars: charSum(selectedIrrelevant),
    droppedRelevantChunks: droppedRelevant.length,
    droppedRelevantChars: charSum(droppedRelevant),
    budgetReached: sel.selectedChars >= 1200 || budgetPressureDrop,
    dropAnalysis,
    irrelevantChunksConsumingBudgetIndirectly: irrelevantConsumingBudget,
  };
}

export function testCFactLeaks(fact: AtomicFact, plan: CanonPlanV1) {
  const { sourceStatus, chunks } = matchFactChunks(fact, plan);
  const chunk = chunks[0];
  const structurallyExcluded = chunk ? chunk.bucket === "player" || chunk.bucket === "scenario_meta" : sourceStatus === "ABSENT";

  const cues = {
    quiet: "오늘 날씨 좋네. 그냥 쉬자. 물병 꺼냈다.",
    direct: `${fact.matchHints[0]}에 대해 말해줘.`,
    indirect: buildIndirectCue(fact),
  };

  const out: Record<string, { hit: boolean }> = {};
  const targetIds = new Set(chunks.map((c) => c.id));
  for (const [kind, msg] of Object.entries(cues)) {
    const sel = selectActiveCanonChunks({ plan, userMessage: msg, budgetChars: 1200 });
    out[kind] = { hit: sel.selectedIds.some((id) => targetIds.has(id)) };
  }

  return {
    factId: fact.id,
    compiledBucket: chunk?.bucket ?? null,
    salience: chunk ? (plan.coreIds.includes(chunk.id) ? "CORE" : chunk.salience) : "N/A_IF_ABSENT",
    structurallyExcludedFromActive: structurallyExcluded,
    activeEligible: chunk ? isActiveEligible(chunk, plan) : false,
    quietHit: out.quiet!.hit,
    directHit: out.direct!.hit,
    indirectHit: out.indirect!.hit,
  };
}

function buildIndirectCue(fact: AtomicFact): string {
  const m: Record<string, string> = {
    "leon-C1": "호감이 충분히 쌓이면 특별한 일이 벌어질 것 같아.",
    "leon-C2": "이번 생에서만 아는 정보가 있을 것 같아.",
    "eno-C1": "성채 수뇌부가 실제로 누구 손아귀에 있는지 궁금해.",
    "sg-C1": "호감이 아주 높아지면 숨겨진 루트가 열릴까?",
    "pol-C1": "카일이 실은 어느 쪽 정보원인 것 같아?",
    "fam-C1": "장남의 출신에 숨기는 게 있을 것 같아.",
    "sec-C1": "이안 가족 중 범죄와 연관된 사람이 있었던 것 같아.",
    "sec-C2": "호감 70 넘으면 뭔가 터질 것 같아.",
    "sec-C3": "세 번째만 가능한 루트가 있다고 들었어.",
    "mini-C1": "너만 아는 회귀 정보가 있지?",
    "mini-C2": "상태창 갱신 조건이 뭐야?",
  };
  return m[fact.id] ?? `(${fact.text}) 암시적 질문`;
}

export function generateExpandedBTests(facts: AtomicFact[]) {
  const bFacts = facts.filter((f) => f.class === "B");
  const indirectTemplates: Record<string, string> = {
    "leon-B1": "이 왕국의 정치 구조가 어때?",
    "mod-B1": "옛 라이벌 피아니스트 이야기 들었어?",
    "mod-B2": "무대에서 멈춰 섰던 그날 기억나?",
    "mod-B3": "학원 학생들 가르치는 건 어때?",
    "fan-B1": "60년 전 북변 재난 이후 숲 상태가 어때?",
    "fan-B2": "은빛 손 기사단은 어떻게 됐어?",
    "fan-B3": "약초밭에 흰 꽃 피었어?",
    "eno-B1": "갑자기 너무 다정해진 사람을 어떻게 봐야 해?",
    "eno-B2": "오로라처럼 보이는 Level 3 징후가 보여.",
    "eno-B3": "Level 3만 가는 베테랑 집단이 관심을 보이네.",
    "eno-B4": "지금 상황에서 조용히 행동해야 하는 규칙이 뭐야?",
    "sg-B1": "센티넬 등급 체계 설명해줘.",
    "sg-B2": "폭주 후에는 어떻게 돼?",
    "hd-B1": "상위 길드가 고난이도 게이트를 독점한다며?",
    "hd-B2": "예전 파티 전멸 이야기 들었어?",
    "pol-B1": "검은 깃발 쪽 움직임이 있어?",
    "pol-B2": "개혁파 붉은 깃발은 뭐 하는 쪽이야?",
    "fam-B1": "춘제에서 후계 발표가 있지?",
    "fam-B2": "둘째 형과 비밀 연대가 있다던데?",
    "sur-B1": "전직 군수 장교 경력이 도움이 되지?",
    "fl-B1": "북쪽 관문 너머 안개 때문에 시야가 어때?",
    "mini-B1": "포드 안에서 번식하는 것들 말이야.",
    "mini-B2": "한 집단이 암시장 감시한다던데?",
  };
  const quietMsg = "배낭에서 물병을 꺼내 앉았다. 오늘은 특별한 일 없을 것 같아.";
  return {
    direct: bFacts.map((f) => ({ factId: f.id, fixtureId: f.fixtureId, userMessage: `${f.matchHints[0]}에 대해 알려줘.`, expectHit: true })),
    indirect: bFacts.map((f) => ({ factId: f.id, fixtureId: f.fixtureId, userMessage: indirectTemplates[f.id] ?? `(${f.text})`, expectHit: false })),
    quiet: bFacts.map((f) => ({ factId: f.id, fixtureId: f.fixtureId, userMessage: quietMsg, expectHit: false })),
  };
}

export function runBActiveTest(plan: CanonPlanV1, test: { factId: string; userMessage: string; expectHit: boolean }, facts: AtomicFact[]) {
  const fact = facts.find((f) => f.id === test.factId)!;
  const targetIds = new Set(matchFactChunks(fact, plan).chunks.map((c) => c.id));
  const sel = selectActiveCanonChunks({ plan, userMessage: test.userMessage, budgetChars: 1200 });
  const hit = sel.selectedIds.some((id) => targetIds.has(id));
  return { ...test, hit, pass: hit === test.expectHit };
}

export function traceFundamentalLaw(factId: string, facts: AtomicFact[], raw: string) {
  const fact = facts.find((f) => f.id === factId)!;
  const plan = compilePlan(raw);
  const { chunks, sourceStatus } = matchFactChunks(fact, plan);
  const chunk = chunks[0];
  if (!chunk) return { factId, sourceStatus, error: "ABSENT" };
  const trace = traceSalience(chunk);
  const hint = fact.matchHints[0] ?? "";
  const sourceLine = raw.split("\n").find((l) => l.includes(hint)) ?? "";
  return {
    factId,
    sourceText: sourceLine,
    sourceSectionTitle: chunk.sectionTitle,
    bucket: chunk.bucket,
    plotHookMatch: trace.plotHookMatch,
    coreSectionTitleMatch: trace.coreSectionTitleMatch,
    coreWorldLawTextMatch: trace.coreWorldLawTextMatch,
    worldLawTitleMatch: trace.worldLawTitleMatch,
    resultingSalience: plan.coreIds.includes(chunk.id) ? "CORE" : chunk.salience,
    salienceSteps: trace.steps,
    chunkText: chunk.text,
  };
}

export const QUESTIONABLE_A: Record<string, string> = {
  "mod-A3": "Personality trait alone rarely causes canon-invalid autonomous world action in unrelated cues.",
  "fam-A1": "Marriage-secrecy rule is family-situational; unlikely to invalidate unrelated autonomous actions.",
};

export function reviewALabels(facts: AtomicFact[]) {
  return facts.filter((f) => f.class === "A").map((f) => ({
    factId: f.id,
    questionable: f.id in QUESTIONABLE_A,
    reason: QUESTIONABLE_A[f.id] ?? "Retain: omission could cause canon-invalid autonomous action.",
  }));
}
