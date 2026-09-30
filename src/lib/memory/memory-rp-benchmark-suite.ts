/**
 * #1072 RP memory benchmark case suite — the single owner of the benchmark
 * cases, shared by the deterministic test (synthetic embedder, strict) and the
 * opt-in live embedding benchmark script (real provider, record-only).
 *
 * Every case runs the real canonical owners on in-memory SQLite. A mode's
 * semantic arm supplies the model config and embedder; the suite drives the
 * canonical index job and query resolution with them. `strict` turns every
 * fixture invariant into an assertion; non-strict runs record violations as
 * raw evidence instead of aborting (model quality must not crash a live run).
 */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  detectUnverifiedCanonicalization,
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  listEpisodicMemoryFactsForDebug,
  persistEpisodicMemoryFactsCore,
  reconcileEpisodicMemoryFactsForGeneration,
  replaceEpisodicMemoryFactsForCanonicalMutation,
  type EpisodicDynamicBudgetPolicy,
  type GetEpisodicMemoryForPromptInput,
} from "@/lib/episodicMemoryFacts";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  capabilityGroupEvidence,
  computeBenchmarkMetrics,
  computeScaleMatrixFirstDegradation,
  formatBenchmarkMetricsLine,
  LONG_HORIZON_SCALES,
  scaleMatrixMeasured,
  scaleMatrixNotApplicable,
  type BenchmarkCaseOutcome,
  type BenchmarkCategory,
  type BenchmarkCoverageEntry,
  type CapabilityGroupEvidence,
  type LongHorizonScaleMatrix,
  type LongHorizonScaleRow,
} from "@/lib/memory/memory-rp-benchmark";
import type { EpisodicSemanticModelConfig } from "@/lib/memory/memory-episodic-semantic-config";
import {
  resolveEpisodicSemanticQuery,
  runEpisodicSemanticIndexJob,
  type EpisodicEmbedder,
} from "@/lib/memory/memory-episodic-semantic-jobs";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { EpisodicSemanticQuery } from "@/lib/memory/memory-episodic-semantic-index";

/** Fixed retrieval env for every case — independent of the host process env. */
const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;

export type BenchmarkSemanticArm = { model: EpisodicSemanticModelConfig; embed: EpisodicEmbedder };

/**
 * Research-only packing input for leftover-budget / Global layer A/B.
 * Omitted fields keep the current production-equivalent retrieval input
 * (empty higher-priority texts + default leftover policy).
 */
export type BenchmarkPackingArm = {
  dynamicBudgetPolicy?: EpisodicDynamicBudgetPolicy;
  longTermMemoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  dynamicMemoryTotalMaxChars?: number;
};

/**
 * Research-only selection bounds for the canonical episodic scorer.
 * Omitted fields keep production defaults (8 facts / 1000 chars).
 */
export type BenchmarkSelectionArm = {
  maxFacts?: number;
  maxChars?: number;
  candidateLimit?: number;
};

export type BenchmarkMode = {
  label: string;
  /** null = exact lexical Retrieval V2 (the #1072 baseline). */
  semantic: BenchmarkSemanticArm | null;
  /** true: fixture invariants throw (deterministic runs). false: recorded only. */
  strict: boolean;
  /** Pinned known-gap outcome for deterministic runs; omitted for live arms (measured, not expected). */
  expectKnownGapHit?: boolean;
  packing?: BenchmarkPackingArm;
  selection?: BenchmarkSelectionArm;
};

export type BenchmarkTransportProbe = {
  snapshot(): { httpCallsObserved: number; jevCallsObserved: number };
};

export const BASELINE_MODE: BenchmarkMode = {
  label: "lexical-v2-baseline",
  semantic: null,
  strict: true,
  expectKnownGapHit: false,
};

let activeMode: BenchmarkMode = BASELINE_MODE;
let evaluatedTurns = 0;
let promptTokensInjected = 0;
let retrievedFactCount = 0;
let injectedFactCount = 0;
/** Query resolved by the latest `runRetrieval`, reused by diagnostics so they add no embedding call. */
let lastSemanticQuery: EpisodicSemanticQuery | null = null;
let violations: string[] = [];

function check(ok: boolean, label: string): void {
  if (ok) return;
  if (activeMode.strict) assert.fail(`[${activeMode.label}] ${label}`);
  violations.push(label);
}

/** Drives the canonical bounded index job until it stops making progress. */
async function indexIfSemantic(db: Database.Database): Promise<void> {
  const arm = activeMode.semantic;
  if (!arm) return;
  for (let round = 0; round < 1000; round++) {
    const result = await runEpisodicSemanticIndexJob({ db, chatId: 1, runtime: { enabled: true, model: arm.model }, embed: arm.embed });
    if (result.status !== "indexed") return;
  }
}

async function semanticQueryFor(text: string): Promise<EpisodicSemanticQuery | null> {
  const arm = activeMode.semantic;
  if (!arm) return null;
  const resolved = await resolveEpisodicSemanticQuery({
    query: text,
    contentRoute: "safe",
    runtime: { enabled: true, model: arm.model },
    embed: arm.embed,
  });
  return resolved.query;
}

export type Row = [number, string, string, string, string, string, string];

export function openDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  return db;
}

export function seed(db: Database.Database, rows: Row[]): number[] {
  const ids: number[] = [];
  const stmt = db.prepare(
    `INSERT INTO episodic_memory_facts
    (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{"memory_evidence_type":"explicit_scene_event","content_route":"safe"}')`
  );
  for (const [turn, category, subject, attribute, value, importance, text] of rows) {
    ids.push(Number(stmt.run(turn, category, subject, attribute, value, importance, text).lastInsertRowid));
  }
  return ids;
}

export function saturate(db: Database.Database, count: number, startTurn: number): void {
  for (let i = 0; i < count; i++) {
    seed(db, [
      [startTurn + i, "setting", `filler${i}`, "note", `v${i}`, "normal", `채우기 기록 ${i}번 항해 일지 바다 파도`],
    ]);
  }
}

function retrievalInput(
  currentTurn: number,
  query: string,
  semanticQuery: EpisodicSemanticQuery | null
): GetEpisodicMemoryForPromptInput {
  return {
    chatId: 1,
    currentTurn,
    currentUserMessage: query,
    semanticQuery,
    longTermMemoryText: activeMode.packing?.longTermMemoryText,
    relationshipMemoryText: activeMode.packing?.relationshipMemoryText,
    lorebookText: activeMode.packing?.lorebookText,
    dynamicBudgetPolicy: activeMode.packing?.dynamicBudgetPolicy,
    dynamicMemoryTotalMaxChars: activeMode.packing?.dynamicMemoryTotalMaxChars,
    maxFacts: activeMode.selection?.maxFacts,
    maxChars: activeMode.selection?.maxChars,
    candidateLimit: activeMode.selection?.candidateLimit,
  };
}

/** Runs the real candidate-discovery and final-retrieval owners for one turn. */
async function runRetrieval(
  db: Database.Database,
  currentTurn: number,
  query: string
): Promise<{ candidateIds: number[]; injectedFactIds: number[]; promptBlock: string }> {
  await indexIfSemantic(db);
  const semanticQuery = await semanticQueryFor(query);
  lastSemanticQuery = semanticQuery;
  const input = retrievalInput(currentTurn, query, semanticQuery);
  const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const ranked = getEpisodicMemoryForPrompt(db, input, env);
  evaluatedTurns += 1;
  retrievedFactCount += pre.rows.length;
  injectedFactCount += ranked.facts.length;
  if (ranked.promptBlock) promptTokensInjected += estimateTokens(ranked.promptBlock);
  return {
    candidateIds: pre.rows.map((r) => r.id),
    injectedFactIds: ranked.facts.map((f) => f.id),
    promptBlock: ranked.promptBlock,
  };
}

/** Single-answer retrieval case: expected = allowed = [answerId]. */
async function singleAnswerCase(
  caseId: string,
  category: BenchmarkCategory,
  db: Database.Database,
  currentTurn: number,
  query: string,
  answerId: number
): Promise<BenchmarkCaseOutcome> {
  const r = await runRetrieval(db, currentTurn, query);
  return {
    caseId,
    category,
    candidate: { expectedAnswerIds: [answerId], candidateIds: r.candidateIds },
    final: { expectedAnswerIds: [answerId], allowedFactIds: [answerId], injectedFactIds: r.injectedFactIds },
  };
}

function includes(ids: readonly number[] | undefined, id: number): boolean {
  return (ids ?? []).includes(id);
}

export type SemanticAccounting = { admitted: number; novel: number; overlap: number; added: number; droppedNoCapacity: number };

export type BenchmarkRun = {
  outcomes: BenchmarkCaseOutcome[];
  coverage: BenchmarkCoverageEntry[];
  metrics: ReturnType<typeof computeBenchmarkMetrics>;
  knownGap: { candidateHit: boolean; finalHit: boolean; semantic?: SemanticAccounting };
  invariantViolations: string[];
  /** Retrieval turns evaluated by this run (denominator for per-turn deltas). */
  evaluatedTurns: number;
  /** `estimateTokens` over every non-empty episodic prompt block this run produced. */
  promptTokensInjected: number;
  /** Pre-rank candidate rows seen across evaluated retrievals. */
  retrievedFactCount: number;
  /** Facts that entered the episodic prompt block. */
  injectedFactCount: number;
  /** Raw LongMemEval-style groupings over existing outcomes. */
  capabilityEvidence: CapabilityGroupEvidence[];
};

/**
 * Baseline-expansion cases (horizons 6/20/100/2000 + behavior categories) used
 * by the memory research lab as its A/B evaluation surface. They are measured,
 * never `check()`-ed: a candidate arm must be able to regress them so the gates
 * can see it. Cases in EXPANDED_BASELINE_KNOWN_GAPS miss on current main
 * lexical V2 (documented baseline, not permanent invariants).
 * item-ownership-01 is an owner-boundary case (empty episodic final), not a recall miss.
 */
export const EXPANDED_BASELINE_CASE_IDS: readonly string[] = [
  "horizon-t6-01",
  "horizon-t20-01",
  "horizon-t100-01",
  "horizon-t2000-01",
  "relationship-role-consistency-01",
  "item-ownership-01",
  "npc-durable-state-01",
  "distinctive-utterance-01",
  "correction-supersession-01",
  "false-memory-negative-01",
  "continuity-reset-01",
  "high-noise-distractors-01",
];

/** caseId → stage at which current main lexical V2 misses the expected answer. */
export const EXPANDED_BASELINE_KNOWN_GAPS: Readonly<Record<string, "candidate" | "final">> = {
  "distinctive-utterance-01": "candidate",
};

/** Horizon cases beyond boundary_5turn / t300 / t1000: [caseId, category, sourceTurn, currentTurn]. */
const HORIZON_CASES: ReadonlyArray<readonly [string, BenchmarkCategory, number, number]> = [
  ["horizon-t6-01", "t6", 10, 16],
  ["horizon-t20-01", "t20", 10, 30],
  ["horizon-t100-01", "t100", 10, 110],
  ["horizon-t2000-01", "t2000", 10, 2010],
];

export async function runBenchmarkCases(mode: BenchmarkMode, transport: BenchmarkTransportProbe): Promise<BenchmarkRun> {
  activeMode = mode;
  evaluatedTurns = 0;
  promptTokensInjected = 0;
  retrievedFactCount = 0;
  injectedFactCount = 0;
  violations = [];
  const transportBefore = transport.snapshot();
  const outcomes: BenchmarkCaseOutcome[] = [];
  const knownGap: { candidateHit: boolean; finalHit: boolean; semantic?: SemanticAccounting } = { candidateHit: false, finalHit: false };

  { // boundary_5turn — first seal batch (1~5) recalls past RAW via the retrieval owner.
    const db = openDb();
    const [answerId] = seed(db, [[2, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."]]);
    const o = await singleAnswerCase("boundary-5turn-01", "boundary_5turn", db, 12, "창고에 보관한 등잔을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#1');
    outcomes.push(o);
    db.close();
  }

  { // callback_75turn — 80-turn-old fact still recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "well", "rope", "newrope", "normal", "우물에 새 밧줄을 매달았다."]]);
    const o = await singleAnswerCase("callback-75turn-01", "callback_75turn", db, 90, "우물에 매단 새 밧줄을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#2');
    outcomes.push(o);
    db.close();
  }

  { // t300 — critical historical milestone recalls at T300.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const o = await singleAnswerCase("t300-01", "t300", db, 300, "두 사람의 첫 만남을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#3');
    outcomes.push(o);
    db.close();
  }

  { // t1000 — same milestone recalls at T1000.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const o = await singleAnswerCase("t1000-01", "t1000", db, 1000, "두 사람의 첫 만남을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#4');
    outcomes.push(o);
    db.close();
  }

  { // semantic_paraphrase — KNOWN_GAP_BASELINE_REPRO (not a permanent invariant).
    // Old normal non-historical fact + saturated recent lane + paraphrased cue
    // (no shared token) + milestone-ineligible → pre-candidate miss on main.
    // The approved semantic-candidate-discovery fix PR MUST flip this case to
    // candidate hit / final hit; until then the miss is the documented baseline.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "thunderfear", "note", "quietdread", "normal", "사용자는 천둥 소리를 무서워한다고 명시했다."]]);
    saturate(db, 60, 20);
    check(Object.is(listEpisodicMemoryFactsForDebug(db, { chatId: 1, limit: 500 }).some((r) => r.id === answerId), true), 'invariant#5');
    const o = await singleAnswerCase(
      "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01",
      "semantic_paraphrase",
      db,
      200,
      "폭풍우 속 옛 공포가 되살아나는 밤",
      answerId!
    );
    knownGap.semantic = semanticAccounting(
      fetchEpisodicMemoryCandidatesForDebug(
        db,
        {
          chatId: 1,
          currentTurn: 200,
          currentUserMessage: "폭풍우 속 옛 공포가 되살아나는 밤",
          semanticQuery: lastSemanticQuery,
        },
        env
      ).stats
    );
    knownGap.candidateHit = includes(o.candidate?.candidateIds, answerId!);
    knownGap.finalHit = includes(o.final?.injectedFactIds, answerId!);
    if (mode.expectKnownGapHit !== undefined) {
      check(knownGap.candidateHit === mode.expectKnownGapHit, "known-gap candidate outcome");
      check(knownGap.finalHit === mode.expectKnownGapHit, "known-gap final outcome");
    }
    outcomes.push(o);
    db.close();
  }

  { // promise — non-ledger commitment recalls (formal 약속-class stays ledger-owned).
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "meeting_plan", "bringbook", "normal", "다음 만남에 책을 가져오기로 했다."]]);
    const o = await singleAnswerCase("promise-01", "promise", db, 40, "다음 만남에 가져오기로 한 책을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#8');
    outcomes.push(o);
    db.close();
  }

  { // betrayal — completed betrayal event recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "character", "ivan", "scene_event", "betrayal_done", "important", "이반의 배신이 완료되었다."]]);
    const o = await singleAnswerCase("betrayal-01", "betrayal", db, 70, "이반의 배신이 완료된 일을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#9');
    outcomes.push(o);
    db.close();
  }

  { // first_never — first-time marker recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "observatory", "visit", "firstvisit", "normal", "두 사람이 처음으로 전망대에 올랐다."]]);
    const o = await singleAnswerCase("first-never-01", "first_never", db, 50, "전망대에 처음 오른 날을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#10');
    outcomes.push(o);
    db.close();
  }

  { // role_event_direction — participant + direction explicit.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "mina", "role_direction", "embraced_by_jun", "normal", "준이 미나를 뒤에서 안아주었다."]]);
    const o = await singleAnswerCase("role-event-direction-01", "role_event_direction", db, 40, "준이 미나를 안아준 일을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#11');
    outcomes.push(o);
    db.close();
  }

  { // same_turn_multi_event — two same-turn events; allowed = expected = [id1, id2].
    const db = openDb();
    const [id1, id2] = seed(db, [
      [10, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."],
      [10, "setting", "gatekey", "placed", "doorstep", "normal", "낡은 열쇠를 문간에 두었다."],
    ]);
    const r = await runRetrieval(db, 40, "창고의 등잔과 문간의 열쇠를 묻는다");
    check(Object.is(includes(r.injectedFactIds, id1!), true), 'invariant#12');
    check(Object.is(includes(r.injectedFactIds, id2!), true), 'invariant#13');
    outcomes.push({
      caseId: "same-turn-multi-event-01",
      category: "same_turn_multi_event",
      candidate: { expectedAnswerIds: [id1!, id2!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [id1!, id2!], allowedFactIds: [id1!, id2!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // latest_state_replacement — real stale-vs-latest competition; allowed = [latestId].
    const db = openDb();
    const [staleId, latestId] = seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [30, "setting", "harbor", "moored_ship", "redgull", "normal", "항구의 정박 선박이 빨간갈매기호로 바뀌었다."],
    ]);
    const r = await runRetrieval(db, 60, "항구에 정박한 배를 묻는다");
    check(Object.is(includes(r.injectedFactIds, latestId!), true), 'invariant#14');
    check(Object.is(includes(r.injectedFactIds, staleId!), false), 'invariant#15');
    outcomes.push({
      caseId: "latest-state-replacement-01",
      category: "latest_state_replacement",
      candidate: { expectedAnswerIds: [latestId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [latestId!], allowedFactIds: [latestId!], injectedFactIds: r.injectedFactIds },
      stale: { staleFactIds: [staleId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // historical_repeat_events — both completed events preserved; allowed = [id1, id2].
    // Candidate stage must keep both rows (historical events never collapse
    // under latest-wins). Final expected is the lexically cued event (id2);
    // id1 is still allowed because it is true history, not a false injection.
    const db = openDb();
    const [id1, id2] = seed(db, [
      [10, "character", "rin", "action", "fell", "normal", "린이 계단에서 넘어졌다."],
      [20, "character", "rin", "action", "recovered", "normal", "린이 넘어진 뒤 자리에서 일어났다."],
    ]);
    const r = await runRetrieval(db, 60, "린이 넘어진 일을 묻는다");
    check(Object.is(includes(r.candidateIds, id1!), true), 'invariant#16');
    check(Object.is(includes(r.candidateIds, id2!), true), 'invariant#17');
    outcomes.push({
      caseId: "historical-repeat-events-01",
      category: "historical_repeat_events",
      candidate: { expectedAnswerIds: [id1!, id2!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [id2!], allowedFactIds: [id1!, id2!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // irrelevant_critical_vs_relevant_normal — allowed = [answerId]; the critical tower is NOT allowed.
    const db = openDb();
    seed(db, [[10, "setting", "tower", "color", "blue", "critical", "북쪽 탑은 파란색이었다."]]);
    const [answerId] = seed(db, [[11, "setting", "storm", "shelter", "cave", "normal", "폭풍우가 올 때 동굴에 피신했다."]]);
    const o = await singleAnswerCase(
      "irrelevant-critical-vs-relevant-normal-01",
      "irrelevant_critical_vs_relevant_normal",
      db,
      20,
      "폭풍우 장면을 이어줘",
      answerId!
    );
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#18');
    outcomes.push(o);
    db.close();
  }

  { // user_canonical_vs_assistant_hallucination — canon-guard owner only (no retrieval evidence).
    const risky = { category: "character", attribute: "awakening_status", value: "high", fact_text: "그는 높은 등급으로 각성했다" } as const;
    check(Object.is(detectUnverifiedCanonicalization(risky), "unverified_canonicalization"), 'invariant#19');
    check(Object.is(detectUnverifiedCanonicalization({ ...risky, fact_text: "유저가 명시했다: 그는 높은 등급으로 각성했다", evidence_type: "explicit_user_statement" } as never), null), 'invariant#20');
    outcomes.push({ caseId: "user-canonical-vs-assistant-hallucination-01", category: "user_canonical_vs_assistant_hallucination" });
  }

  { // regeneration_rejected_event — real reconcile owner deletes the rejected variant, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","content_route":"safe","assistant_message_id":501,"request_id":"r1"}')`).run();
    await indexIfSemantic(db);
    const out = reconcileEpisodicMemoryFactsForGeneration(db, { chatId: 1, sourceTurn: 10, facts: [], isRegeneration: true, metadata: { regenerated: true } });
    check(Object.is(out.replaced, true), 'invariant#21');
    const r = await runRetrieval(db, 40, "창고의 등잔을 묻는다");
    outcomes.push({
      caseId: "regeneration-rejected-event-01",
      category: "regeneration_rejected_event",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // message_edit — real canonical-mutation replace swaps v1→v2, then real retrieval; allowed = [v2].
    const db = openDb();
    const v1 = { category: "setting", subject: "tower", attribute: "color", value: "blue", importance: "normal", fact_text: "북쪽 탑은 파란색이었다.", evidence_type: "explicit_scene_event" } as const;
    const v2 = { category: "setting", subject: "tower", attribute: "color", value: "red", importance: "normal", fact_text: "북쪽 탑은 빨간색이었다.", evidence_type: "explicit_scene_event" } as const;
    check(Object.is(persistEpisodicMemoryFactsCore(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v1 }], metadata: { content_route: "safe" } }), 1), 'invariant#22');
    await indexIfSemantic(db);
    check(Object.is(replaceEpisodicMemoryFactsForCanonicalMutation(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v2 }], metadata: { content_route: "safe" } }), 1), 'invariant#23');
    const rows = listEpisodicMemoryFactsForDebug(db, { chatId: 1 });
    check(Object.is(rows.length, 1), 'invariant#24');
    check(Object.is(rows[0]?.value, "red"), 'invariant#25');
    const o = await singleAnswerCase("message-edit-01", "message_edit", db, 40, "북쪽 탑의 색을 묻는다", rows[0]!.id);
    check(Object.is(includes(o.final?.injectedFactIds, rows[0]!.id), true), 'invariant#26');
    outcomes.push(o);
    db.close();
  }

  { // delete_rewind — real assistant-id delete owner, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","content_route":"safe","assistant_message_id":601,"request_id":"r1"}')`).run();
    await indexIfSemantic(db);
    check(Object.is(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [601]), 1), 'invariant#27');
    const r = await runRetrieval(db, 40, "창고의 등잔을 묻는다");
    outcomes.push({
      caseId: "delete-rewind-01",
      category: "delete_rewind",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // fork_variant — real recall-side fork reset boundary, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 5, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","content_route":"safe"}')`).run();
    await indexIfSemantic(db);
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    const r = await runRetrieval(db, 40, "창고의 등잔을 묻는다");
    check(Object.is(r.candidateIds.length, 0), 'invariant#28');
    outcomes.push({
      caseId: "fork-variant-01",
      category: "fork_variant",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // persona_secret_wrong_observer — knowledge-store observer isolation owner only.
    // Proves the wrong observer cannot read the row; does NOT prove final
    // prompt/context non-leakage (secretLeakCount stays NOT_MEASURED).
    const db = openDb();
    upsertObserverSecretKnowledge({
      chatId: 1, personaId: 1, secretId: "s1",
      observerType: "CHARACTER", observerId: "10",
      knowledgeState: "CONFIRMED", confidence: 0.9,
      factSnapshot: "지켜야 할 약속의 내용이 여기에 기록되었다.",
      lastEvidenceEventId: "e1", db,
    });
    check(!Object.is(getObserverSecretKnowledge({ chatId: 1, personaId: 1, secretId: "s1", observerType: "CHARACTER", observerId: "10", db }), null), 'invariant#29');
    const wrongObservers = ["99", "11"];
    const wrongObserverHits = wrongObservers.filter(
      (observerId) =>
        getObserverSecretKnowledge({ chatId: 1, personaId: 1, secretId: "s1", observerType: "CHARACTER", observerId, db }) !== null
    ).length;
    outcomes.push({
      caseId: "persona-secret-wrong-observer-01",
      category: "persona_secret_wrong_observer",
      observerIsolation: { wrongObserverLookups: wrongObservers.length, wrongObserverHits },
    });
    db.close();
  }

  { // trpg_quest — quest callback recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "quest", "torch", "delivery", "chapel", "important", "횃불을 예배당에 전달하는 임무를 받았다."]]);
    const o = await singleAnswerCase("trpg-quest-01", "trpg_quest", db, 80, "예배당 임무의 진행 상황을 묻는다", answerId!);
    check(Object.is(includes(o.final?.injectedFactIds, answerId!), true), 'invariant#30');
    outcomes.push(o);
    db.close();
  }

  { // character_state_transition — injury then recovery; allowed = [injury, recovery], expected = [injury].
    const db = openDb();
    const [injuryId, recoveryId] = seed(db, [
      [10, "character", "rin", "action", "leg_injury", "normal", "린이 다리에 부상을 입었다."],
      [20, "character", "rin", "action", "leg_recovery", "normal", "린이 다리 부상에서 회복되었다."],
    ]);
    const r = await runRetrieval(db, 60, "린이 다리 부상을 입은 일을 묻는다");
    check(Object.is(includes(r.injectedFactIds, injuryId!), true), 'invariant#31');
    outcomes.push({
      caseId: "character-state-transition-01",
      category: "character_state_transition",
      candidate: { expectedAnswerIds: [injuryId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [injuryId!], allowedFactIds: [injuryId!, recoveryId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // location_ownership_transition — real stale-vs-latest competition; allowed = [latestId].
    const db = openDb();
    const [staleId, latestId] = seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [30, "setting", "harbor", "moored_ship", "redgull", "normal", "항구의 정박 선박이 빨간갈매기호로 바뀌었다."],
    ]);
    const r = await runRetrieval(db, 60, "항구의 정박 선박을 묻는다");
    check(Object.is(includes(r.injectedFactIds, latestId!), true), 'invariant#32');
    outcomes.push({
      caseId: "location-ownership-transition-01",
      category: "location_ownership_transition",
      candidate: { expectedAnswerIds: [latestId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [latestId!], allowedFactIds: [latestId!], injectedFactIds: r.injectedFactIds },
      stale: { staleFactIds: [staleId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // zero_relevant_control — real retrieval on an irrelevant-only DB; allowed = [].
    const db = openDb();
    seed(db, [[10, "setting", "tower", "color", "blue", "normal", "북쪽 탑은 파란색이었다."]]);
    const r = await runRetrieval(db, 20, "바다 항해를 시작한다");
    check(Object.is(r.injectedFactIds.length, 0), 'invariant#33');
    check(Object.is(r.promptBlock, ""), 'invariant#34');
    outcomes.push({
      caseId: "zero-relevant-control-01",
      category: "zero_relevant_control",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  for (const [caseId, category, sourceTurn, currentTurn] of HORIZON_CASES) {
    const db = openDb();
    const [answerId] = seed(db, [[sourceTurn, "character", "mira", "habit", "violin_dawn", "important", "미라는 새벽마다 바이올린을 연습한다."]]);
    saturate(db, 30, sourceTurn + 1);
    const o = await singleAnswerCase(caseId, category, db, currentTurn, "미라의 새벽 바이올린 연습을 묻는다", answerId!);
    outcomes.push(o);
    db.close();
  }

  { // relationship_role_consistency — role superseded (servant → knight); allowed = [latest].
    const db = openDb();
    const [staleId, latestId] = seed(db, [
      [10, "relationship", "jun", "role_to_mina", "servant", "important", "준은 미나의 하인이었다."],
      [40, "relationship", "jun", "role_to_mina", "guard_knight", "important", "준은 미나의 호위기사가 되었다."],
    ]);
    const r = await runRetrieval(db, 80, "준과 미나의 관계를 묻는다");
    outcomes.push({
      caseId: "relationship-role-consistency-01",
      category: "relationship_role_consistency",
      candidate: { expectedAnswerIds: [latestId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [latestId!], allowedFactIds: [latestId!], injectedFactIds: r.injectedFactIds },
      stale: { staleFactIds: [staleId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // item_ownership — ledger-owned attribute; episodic final must stay empty.
    const db = openDb();
    const [staleId, latestId] = seed(db, [
      [10, "setting", "silverkey", "owner", "rin", "normal", "린이 은열쇠를 가지고 있다."],
      [30, "setting", "silverkey", "owner", "jun", "normal", "은열쇠가 린에게서 준에게 넘어갔다."],
    ]);
    const r = await runRetrieval(db, 70, "은열쇠를 누가 가지고 있는지 묻는다");
    outcomes.push({
      caseId: "item-ownership-01",
      category: "item_ownership",
      candidate: { expectedAnswerIds: [latestId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
      stale: { staleFactIds: [staleId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // npc_durable_state — old durable NPC state under a saturated recent lane.
    const db = openDb();
    const [answerId] = seed(db, [[15, "character", "organ_smith", "body_state", "lost_left_arm", "important", "대장장이 오르간은 왼팔을 잃었다."]]);
    saturate(db, 60, 100);
    const o = await singleAnswerCase("npc-durable-state-01", "npc_durable_state", db, 400, "대장장이 오르간의 몸 상태를 묻는다", answerId!);
    outcomes.push(o);
    db.close();
  }

  { // distinctive_utterance — an exact quoted line recalled far later.
    const db = openDb();
    const [answerId] = seed(db, [[20, "character", "rin", "utterance", "two_moons_return", "normal", "린이 말했다: \"달이 두 번 뜨는 밤에 돌아올게.\""]]);
    saturate(db, 60, 60);
    const o = await singleAnswerCase("distinctive-utterance-01", "distinctive_utterance", db, 250, "달이 두 번 뜨는 밤에 돌아온다던 린의 말을 묻는다", answerId!);
    outcomes.push(o);
    db.close();
  }

  { // correction_supersession — user correction replaces the earlier value; allowed = [corrected].
    const db = openDb();
    const [supersededId, correctedId] = seed(db, [
      [10, "setting", "user_hometown", "place", "north_port", "normal", "사용자의 고향은 북부 항구 도시다."],
      [12, "setting", "user_hometown", "place", "south_village", "normal", "정정: 사용자의 고향은 남부 산골 마을이다."],
    ]);
    const r = await runRetrieval(db, 60, "사용자의 고향을 묻는다");
    outcomes.push({
      caseId: "correction-supersession-01",
      category: "correction_supersession",
      candidate: { expectedAnswerIds: [correctedId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [correctedId!], allowedFactIds: [correctedId!], injectedFactIds: r.injectedFactIds },
      stale: { staleFactIds: [supersededId!], injectedFactIds: r.injectedFactIds },
      correction: { supersededIds: [supersededId!], correctedIds: [correctedId!], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // false_memory_negative — asks about an event that never happened; allowed = [].
    const db = openDb();
    seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [20, "relationship", "pair", "meeting_plan", "bringbook", "normal", "다음 만남에 책을 가져오기로 했다."],
    ]);
    const r = await runRetrieval(db, 60, "우리가 결혼식을 올렸던 날을 묻는다");
    outcomes.push({
      caseId: "false-memory-negative-01",
      category: "false_memory_negative",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // continuity_reset — pre-reset fact excluded, post-reset fact recalled; allowed = [post].
    const db = openDb();
    const insert = db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, ?, ?, 'setting', ?, 'kept', ?, 'normal', ?, '{"memory_evidence_type":"explicit_scene_event","content_route":"safe"}')`);
    insert.run(10, 5, "lantern_old", "shed", "등잔을 창고에 보관했다.");
    const postId = Number(insert.run(30, 9, "lantern_new", "attic", "등잔을 다락에 보관했다.").lastInsertRowid);
    await indexIfSemantic(db);
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    const o = await singleAnswerCase("continuity-reset-01", "continuity_reset", db, 60, "등잔을 보관한 곳을 묻는다", postId);
    outcomes.push(o);
    db.close();
  }

  { // high_noise_distractors — one answer among many lexically adjacent distractors.
    const db = openDb();
    const [answerId] = seed(db, [[30, "character", "rin", "hid_item", "red_scarf_lighthouse", "normal", "린은 붉은 스카프를 등대 지하실에 숨겼다."]]);
    const distractorRows: Row[] = [];
    for (let i = 0; i < 120; i++) {
      distractorRows.push([40 + i, "setting", `crate${i}`, "hidden_at", `cellar${i}`, "normal", `${i}번째 상자를 지하실 구석에 숨겼다.`]);
    }
    const distractorIds = seed(db, distractorRows);
    const r = await runRetrieval(db, 200, "린이 붉은 스카프를 숨긴 곳을 묻는다");
    outcomes.push({
      caseId: "high-noise-distractors-01",
      category: "high_noise_distractors",
      candidate: { expectedAnswerIds: [answerId!], candidateIds: r.candidateIds },
      final: { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: r.injectedFactIds },
      distractor: { distractorIds, injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  const categories: BenchmarkCategory[] = [
    "boundary_5turn", "callback_75turn", "t300", "t1000", "semantic_paraphrase",
    "promise", "betrayal", "first_never", "role_event_direction", "same_turn_multi_event",
    "latest_state_replacement", "historical_repeat_events", "irrelevant_critical_vs_relevant_normal",
    "user_canonical_vs_assistant_hallucination", "regeneration_rejected_event", "message_edit",
    "delete_rewind", "fork_variant", "persona_secret_wrong_observer", "trpg_quest",
    "character_state_transition", "location_ownership_transition", "zero_relevant_control",
    "t6", "t20", "t100", "t2000", "relationship_role_consistency", "item_ownership",
    "npc_durable_state", "distinctive_utterance", "correction_supersession",
    "false_memory_negative", "continuity_reset", "high_noise_distractors",
  ];
  const coverage: BenchmarkCoverageEntry[] = categories.map((category) => {
    const executedCases = outcomes.filter((o) => o.category === category).length;
    check(Boolean(executedCases > 0), `category ${category} must execute at least one real-owner case`);
    return { category, executedCases, status: "MEASURED" as const };
  });

  const transportAfter = transport.snapshot();
  const metrics = computeBenchmarkMetrics(outcomes, coverage, {
    evaluatedTurns,
    httpCallsObserved: transportAfter.httpCallsObserved - transportBefore.httpCallsObserved,
    jevCallsObserved: transportAfter.jevCallsObserved - transportBefore.jevCallsObserved,
  });
  console.info(`[RpMemoryBenchmark] mode=${mode.label} ${formatBenchmarkMetricsLine(metrics)}`);
  console.info(`[RpMemoryBenchmark] mode=${mode.label} coverage=${coverage.map((c) => `${c.category}:${c.executedCases}`).join(",")}`);
  activeMode = BASELINE_MODE;
  return {
    outcomes,
    coverage,
    metrics,
    knownGap,
    invariantViolations: [...violations],
    evaluatedTurns,
    promptTokensInjected,
    retrievedFactCount,
    injectedFactCount,
    capabilityEvidence: capabilityGroupEvidence(outcomes),
  };
}

export function semanticAccounting(stats: ReturnType<typeof fetchEpisodicMemoryCandidatesForDebug>["stats"]): SemanticAccounting {
  const s = stats.semantic;
  return { admitted: s?.admitted ?? 0, novel: s?.novel ?? 0, overlap: s?.overlap ?? 0, added: s?.added ?? 0, droppedNoCapacity: s?.droppedNoCapacity ?? 0 };
}

/**
 * Store-size matrix: one identity fact + (scale-1) filler facts, then one
 * lexical-overlap retrieval on the production candidate + final owners.
 * Persist uses the suite `seed()` INSERT (TEST_SUBSTITUTE). Capture/extract
 * and full contextBuilder assembly are not executed.
 */
export async function measureLongHorizonScaleMatrix(
  mode: BenchmarkMode
): Promise<LongHorizonScaleMatrix> {
  activeMode = mode;
  const rows: LongHorizonScaleRow[] = [];
  const query = "렌의 항구 야간 경비원 직업을 묻는다";
  const na = (reason: string) => scaleMatrixNotApplicable(reason);

  for (const scale of LONG_HORIZON_SCALES) {
    const db = openDb();
    const [answerId] = seed(db, [
      [
        1,
        "character",
        "ren",
        "job",
        "harbor_night_guard",
        "important",
        "렌은 항구 야간 경비원이다.",
      ],
    ]);
    if (scale > 1) saturate(db, scale - 1, 2);
    const persisted = (
      db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=1").get() as {
        n: number;
      }
    ).n;
    const started = performance.now();
    const r = await runRetrieval(db, scale + 10, query);
    const latencyMs = performance.now() - started;
    const candidateHit = includes(r.candidateIds, answerId!);
    const finalHit = includes(r.injectedFactIds, answerId!);
    const falseInjection = r.injectedFactIds.some((id) => id !== answerId);
    const promptTokens = r.promptBlock ? estimateTokens(r.promptBlock) : 0;
    db.close();

    rows.push({
      scale,
      persistedFactCount: scaleMatrixMeasured(persisted, "COUNT(*) after seed+saturate"),
      candidateCount: scaleMatrixMeasured(r.candidateIds.length, "fetchEpisodicMemoryCandidatesForDebug"),
      candidateRecallAtK: scaleMatrixMeasured(candidateHit ? 1 : 0, "target in pre-rank candidate set"),
      finalRecallAtK: scaleMatrixMeasured(finalHit ? 1 : 0, "target in getEpisodicMemoryForPrompt"),
      falseInjectionRate: scaleMatrixMeasured(falseInjection ? 1 : 0, "any injected id other than the target"),
      staleStateInjectionRate: na("this matrix has no stale-vs-latest pair"),
      latestStateRecall: na("this matrix has no stale-vs-latest pair"),
      historicalEventRecall: na("this matrix is store-size identity, not a historical-event case"),
      relationshipContinuityRecall: na("this matrix does not seed a relationship trajectory"),
      identityContinuityRecall: scaleMatrixMeasured(finalHit ? 1 : 0, "identity job fact in final prompt block"),
      zeroRelevantPrecision: na("this matrix always has one relevant target"),
      mutationIsolation: na("regen/edit/delete/fork/reset not executed in this matrix"),
      observerIsolation: na("observer knowledge-store owner not executed in this matrix"),
      promptTokenCount: scaleMatrixMeasured(promptTokens, "estimateTokens of episodic promptBlock only"),
      injectedMemoryTokenCount: scaleMatrixMeasured(promptTokens, "same episodic block; contextBuilder not called"),
      packingSaturation: scaleMatrixMeasured(
        r.promptBlock.length / 1000,
        "episodic promptBlock chars / EPISODIC_MEMORY_PROMPT_MAX_CHARS(1000)"
      ),
      latencyMs: scaleMatrixMeasured(latencyMs, "performance.now around production retrieval"),
      dbRowCount: scaleMatrixMeasured(persisted, "same as persistedFactCount"),
    });
  }

  activeMode = BASELINE_MODE;
  return {
    rows,
    firstDegradation: computeScaleMatrixFirstDegradation(rows),
    persistPath: "TEST_SUBSTITUTE",
    retrievalPath: "PRODUCTION",
    packingPath: "PRODUCTION_EPISODIC_BLOCK",
    contextAssemblyPath: "NOT_EXECUTED",
    captureExtractPath: "NOT_EXECUTED",
  };
}

export async function measureMilestoneRetention(mode: BenchmarkMode): Promise<{ retained: number; total: number; semantic: SemanticAccounting }> {
  activeMode = mode;
  const db = openDb();
  const milestoneRows: Row[] = [];
  for (let i = 0; i < 25; i++) {
    milestoneRows.push([10 + i, "relationship", `tower${i}`, "scene_event", `vow${i}`, "critical", `북쪽 탑 ${i}층에서의 맹세가 완료되었다.`]);
  }
  const milestoneIds = seed(db, milestoneRows);
  for (let i = 0; i < 30; i++) {
    seed(db, [[40 + i, "setting", `stormnight${i}`, "note", `n${i}`, "normal", `${i}번째 천둥 치던 밤 사용자는 무서워했다고 명시했다.`]]);
  }
  saturate(db, 60, 80);
  const r = await runRetrieval(db, 300, "폭풍우 속 옛 공포가 되살아나는 밤");
  const candidates = new Set(r.candidateIds);
  const input = retrievalInput(
    300,
    "폭풍우 속 옛 공포가 되살아나는 밤",
    await semanticQueryFor("폭풍우 속 옛 공포가 되살아나는 밤")
  );
  const semantic = semanticAccounting(fetchEpisodicMemoryCandidatesForDebug(db, input, env).stats);
  db.close();
  activeMode = BASELINE_MODE;
  return { retained: milestoneIds.filter((id) => candidates.has(id)).length, total: milestoneIds.length, semantic };
}
