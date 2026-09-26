import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
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
} from "@/lib/episodicMemoryFacts";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  computeBenchmarkMetrics,
  detectFalseInjection,
  formatBenchmarkMetricsLine,
  type BenchmarkCaseOutcome,
  type BenchmarkCategory,
  type BenchmarkCoverageEntry,
} from "@/lib/memory/memory-rp-benchmark";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv;

type Row = [number, string, string, string, string, string, string];

function openDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  return db;
}

function seed(db: Database.Database, rows: Row[]): number[] {
  const ids: number[] = [];
  const stmt = db.prepare(
    `INSERT INTO episodic_memory_facts
    (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, '{"memory_evidence_type":"explicit_scene_event"}')`
  );
  for (const [turn, category, subject, attribute, value, importance, text] of rows) {
    ids.push(Number(stmt.run(turn, category, subject, attribute, value, importance, text).lastInsertRowid));
  }
  return ids;
}

function saturate(db: Database.Database, count: number, startTurn: number): void {
  for (let i = 0; i < count; i++) {
    seed(db, [
      [startTurn + i, "setting", `filler${i}`, "note", `v${i}`, "normal", `채우기 기록 ${i}번 항해 일지 바다 파도`],
    ]);
  }
}

let evaluatedTurns = 0;
let httpCallsObserved = 0;
let jevCallsObserved = 0;
let savedFetch: typeof fetch | undefined;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    httpCallsObserved += 1;
    if (String(url).startsWith(JEV_DECISIONS_URL)) jevCallsObserved += 1;
    throw new Error("benchmark must not perform provider HTTP");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch!;
});

/** Runs the real candidate-discovery and final-retrieval owners for one turn. */
function runRetrieval(
  db: Database.Database,
  currentTurn: number,
  query: string
): { candidateIds: number[]; injectedFactIds: number[]; promptBlock: string } {
  const input = { chatId: 1, currentTurn, currentUserMessage: query };
  const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const ranked = getEpisodicMemoryForPrompt(db, input, env);
  evaluatedTurns += 1;
  return {
    candidateIds: pre.rows.map((r) => r.id),
    injectedFactIds: ranked.facts.map((f) => f.id),
    promptBlock: ranked.promptBlock,
  };
}

/** Single-answer retrieval case: expected = allowed = [answerId]. */
function singleAnswerCase(
  caseId: string,
  category: BenchmarkCategory,
  db: Database.Database,
  currentTurn: number,
  query: string,
  answerId: number
): BenchmarkCaseOutcome {
  const r = runRetrieval(db, currentTurn, query);
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

it("RP memory benchmark executes all requested categories against real canonical owners", () => {
  const outcomes: BenchmarkCaseOutcome[] = [];

  { // boundary_5turn — first seal batch (1~5) recalls past RAW via the retrieval owner.
    const db = openDb();
    const [answerId] = seed(db, [[2, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."]]);
    const o = singleAnswerCase("boundary-5turn-01", "boundary_5turn", db, 12, "창고에 보관한 등잔을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // callback_75turn — 80-turn-old fact still recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "well", "rope", "newrope", "normal", "우물에 새 밧줄을 매달았다."]]);
    const o = singleAnswerCase("callback-75turn-01", "callback_75turn", db, 90, "우물에 매단 새 밧줄을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // t300 — critical historical milestone recalls at T300.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const o = singleAnswerCase("t300-01", "t300", db, 300, "두 사람의 첫 만남을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // t1000 — same milestone recalls at T1000.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const o = singleAnswerCase("t1000-01", "t1000", db, 1000, "두 사람의 첫 만남을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
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
    assert.equal(listEpisodicMemoryFactsForDebug(db, { chatId: 1, limit: 500 }).some((r) => r.id === answerId), true);
    const o = singleAnswerCase(
      "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01",
      "semantic_paraphrase",
      db,
      200,
      "폭풍우 속 옛 공포가 되살아나는 밤",
      answerId!
    );
    assert.equal(includes(o.candidate?.candidateIds, answerId!), false);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), false);
    outcomes.push(o);
    db.close();
  }

  { // promise — non-ledger commitment recalls (formal 약속-class stays ledger-owned).
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "meeting_plan", "bringbook", "normal", "다음 만남에 책을 가져오기로 했다."]]);
    const o = singleAnswerCase("promise-01", "promise", db, 40, "다음 만남에 가져오기로 한 책을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // betrayal — completed betrayal event recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "character", "ivan", "scene_event", "betrayal_done", "important", "이반의 배신이 완료되었다."]]);
    const o = singleAnswerCase("betrayal-01", "betrayal", db, 70, "이반의 배신이 완료된 일을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // first_never — first-time marker recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "observatory", "visit", "firstvisit", "normal", "두 사람이 처음으로 전망대에 올랐다."]]);
    const o = singleAnswerCase("first-never-01", "first_never", db, 50, "전망대에 처음 오른 날을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // role_event_direction — participant + direction explicit.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "mina", "role_direction", "embraced_by_jun", "normal", "준이 미나를 뒤에서 안아주었다."]]);
    const o = singleAnswerCase("role-event-direction-01", "role_event_direction", db, 40, "준이 미나를 안아준 일을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // same_turn_multi_event — two same-turn events; allowed = expected = [id1, id2].
    const db = openDb();
    const [id1, id2] = seed(db, [
      [10, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."],
      [10, "setting", "gatekey", "placed", "doorstep", "normal", "낡은 열쇠를 문간에 두었다."],
    ]);
    const r = runRetrieval(db, 40, "창고의 등잔과 문간의 열쇠를 묻는다");
    assert.equal(includes(r.injectedFactIds, id1!), true);
    assert.equal(includes(r.injectedFactIds, id2!), true);
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
    const r = runRetrieval(db, 60, "항구에 정박한 배를 묻는다");
    assert.equal(includes(r.injectedFactIds, latestId!), true);
    assert.equal(includes(r.injectedFactIds, staleId!), false);
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
    const r = runRetrieval(db, 60, "린이 넘어진 일을 묻는다");
    assert.equal(includes(r.candidateIds, id1!), true);
    assert.equal(includes(r.candidateIds, id2!), true);
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
    const o = singleAnswerCase(
      "irrelevant-critical-vs-relevant-normal-01",
      "irrelevant_critical_vs_relevant_normal",
      db,
      20,
      "폭풍우 장면을 이어줘",
      answerId!
    );
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // user_canonical_vs_assistant_hallucination — canon-guard owner only (no retrieval evidence).
    const risky = { category: "character", attribute: "awakening_status", value: "high", fact_text: "그는 높은 등급으로 각성했다" } as const;
    assert.equal(detectUnverifiedCanonicalization(risky), "unverified_canonicalization");
    assert.equal(
      detectUnverifiedCanonicalization({ ...risky, fact_text: "유저가 명시했다: 그는 높은 등급으로 각성했다", evidence_type: "explicit_user_statement" } as never),
      null
    );
    outcomes.push({ caseId: "user-canonical-vs-assistant-hallucination-01", category: "user_canonical_vs_assistant_hallucination" });
  }

  { // regeneration_rejected_event — real reconcile owner deletes the rejected variant, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","assistant_message_id":501,"request_id":"r1"}')`).run();
    const out = reconcileEpisodicMemoryFactsForGeneration(db, { chatId: 1, sourceTurn: 10, facts: [], isRegeneration: true, metadata: { regenerated: true } });
    assert.equal(out.replaced, true);
    const r = runRetrieval(db, 40, "창고의 등잔을 묻는다");
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
    assert.equal(persistEpisodicMemoryFactsCore(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v1 }] }), 1);
    assert.equal(replaceEpisodicMemoryFactsForCanonicalMutation(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v2 }] }), 1);
    const rows = listEpisodicMemoryFactsForDebug(db, { chatId: 1 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.value, "red");
    const o = singleAnswerCase("message-edit-01", "message_edit", db, 40, "북쪽 탑의 색을 묻는다", rows[0]!.id);
    assert.equal(includes(o.final?.injectedFactIds, rows[0]!.id), true);
    outcomes.push(o);
    db.close();
  }

  { // delete_rewind — real assistant-id delete owner, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","assistant_message_id":601,"request_id":"r1"}')`).run();
    assert.equal(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [601]), 1);
    const r = runRetrieval(db, 40, "창고의 등잔을 묻는다");
    outcomes.push({
      caseId: "delete-rewind-01",
      category: "delete_rewind",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
    });
    db.close();
  }

  { // fork_variant — real recall-side fork reset boundary, then real retrieval; allowed = [].
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 5, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event"}')`).run();
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    const r = runRetrieval(db, 40, "창고의 등잔을 묻는다");
    assert.equal(r.candidateIds.length, 0);
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
    assert.notEqual(getObserverSecretKnowledge({ chatId: 1, personaId: 1, secretId: "s1", observerType: "CHARACTER", observerId: "10", db }), null);
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
    const o = singleAnswerCase("trpg-quest-01", "trpg_quest", db, 80, "예배당 임무의 진행 상황을 묻는다", answerId!);
    assert.equal(includes(o.final?.injectedFactIds, answerId!), true);
    outcomes.push(o);
    db.close();
  }

  { // character_state_transition — injury then recovery; allowed = [injury, recovery], expected = [injury].
    const db = openDb();
    const [injuryId, recoveryId] = seed(db, [
      [10, "character", "rin", "action", "leg_injury", "normal", "린이 다리에 부상을 입었다."],
      [20, "character", "rin", "action", "leg_recovery", "normal", "린이 다리 부상에서 회복되었다."],
    ]);
    const r = runRetrieval(db, 60, "린이 다리 부상을 입은 일을 묻는다");
    assert.equal(includes(r.injectedFactIds, injuryId!), true);
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
    const r = runRetrieval(db, 60, "항구의 정박 선박을 묻는다");
    assert.equal(includes(r.injectedFactIds, latestId!), true);
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
    const r = runRetrieval(db, 20, "바다 항해를 시작한다");
    assert.equal(r.injectedFactIds.length, 0);
    assert.equal(r.promptBlock, "");
    outcomes.push({
      caseId: "zero-relevant-control-01",
      category: "zero_relevant_control",
      final: { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: r.injectedFactIds },
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
  ];
  const coverage: BenchmarkCoverageEntry[] = categories.map((category) => {
    const executedCases = outcomes.filter((o) => o.category === category).length;
    assert.ok(executedCases > 0, `category ${category} must execute at least one real-owner case`);
    return { category, executedCases, status: "MEASURED" as const };
  });

  const metrics = computeBenchmarkMetrics(outcomes, coverage, {
    evaluatedTurns,
    httpCallsObserved,
    jevCallsObserved,
  });
  console.info(`[RpMemoryBenchmark] ${formatBenchmarkMetricsLine(metrics)}`);
  console.info(`[RpMemoryBenchmark] coverage=${coverage.map((c) => `${c.category}:${c.executedCases}`).join(",")}`);

  // Eligibility is derived from evidence actually produced, never fixed.
  const expectFalseInjectionEligible = outcomes.filter((o) => o.final).length;
  assert.equal(metrics.cases, outcomes.length);
  assert.equal(metrics.falseInjectionRate.eligibleCases, expectFalseInjectionEligible);
  assert.ok(expectFalseInjectionEligible < outcomes.length, "non-retrieval cases must not inflate the denominator");
  assert.equal(metrics.falseInjectionRate.totalCases, outcomes.length);
  assert.equal(metrics.staleStateRecallRate.eligibleCases, outcomes.filter((o) => o.stale).length);

  for (const m of [metrics.candidateRecallAtK, metrics.finalRecallAt8, metrics.falseInjectionRate, metrics.staleStateRecallRate]) {
    assert.equal(m.status, "MEASURED");
  }
  assert.equal(metrics.falseInjectionRate.value, 0);
  assert.equal(metrics.staleStateRecallRate.value, 0);
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.status, "MEASURED");
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.eligibleCases, 1);
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.value, 0);
  assert.equal(metrics.secretLeakCount.status, "NOT_MEASURED");
  assert.equal(metrics.secretLeakCount.value, null);
  assert.equal(metrics.providerCallsPerTurn.status, "MEASURED");
  assert.equal(metrics.providerCallsPerTurn.value, 0);
  assert.equal(metrics.jevInvocationRate.status, "MEASURED");
  assert.equal(metrics.jevInvocationRate.value, 0);
  assert.equal(httpCallsObserved, 0);
  for (const m of [metrics.baselineVsShadowDelta, metrics.jevP50LatencyMs, metrics.jevP95LatencyMs, metrics.jevCostPer1000Turns, metrics.promptTokenDelta, metrics.fallbackParity]) {
    assert.equal(m.status, "NOT_APPLICABLE");
    assert.equal(m.value, null);
  }
});

it("false-injection metric detects an injected fact outside the allowed set (negative proof)", () => {
  // Real fixture ids (relevant normal answer + unrelated critical fact), but a
  // deliberately wrong final result is fed to the pure metric evaluator — the
  // production scorer is not manipulated.
  const db = openDb();
  const [unrelatedCriticalId] = seed(db, [[10, "setting", "tower", "color", "blue", "critical", "북쪽 탑은 파란색이었다."]]);
  const [answerId] = seed(db, [[11, "setting", "storm", "shelter", "cave", "normal", "폭풍우가 올 때 동굴에 피신했다."]]);
  db.close();

  const wrong = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [answerId!, unrelatedCriticalId!] };
  const onlyWrong = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [unrelatedCriticalId!] };
  const clean = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [answerId!] };
  const emptyAllowedButInjected = { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: [unrelatedCriticalId!] };
  assert.equal(detectFalseInjection(wrong), true);
  assert.equal(detectFalseInjection(onlyWrong), true);
  assert.equal(detectFalseInjection(emptyAllowedButInjected), true);
  assert.equal(detectFalseInjection(clean), false);

  const metrics = computeBenchmarkMetrics(
    [
      { caseId: "neg-wrong", category: "irrelevant_critical_vs_relevant_normal", final: wrong },
      { caseId: "neg-clean", category: "irrelevant_critical_vs_relevant_normal", final: clean },
      { caseId: "neg-no-final", category: "user_canonical_vs_assistant_hallucination" },
    ],
    []
  );
  assert.equal(metrics.falseInjectionRate.status, "MEASURED");
  assert.equal(metrics.falseInjectionRate.eligibleCases, 2);
  assert.equal(metrics.falseInjectionRate.totalCases, 3);
  assert.equal(metrics.falseInjectionRate.value, 0.5);
  assert.equal(metrics.finalRecallAt8.value, 1);
  console.info(`[RpMemoryBenchmark] negative proof: ${formatBenchmarkMetricsLine(metrics)}`);
});

it("unexecuted stages stay NOT_MEASURED instead of counting as 0", () => {
  const metrics = computeBenchmarkMetrics(
    [{ caseId: "guard-only", category: "user_canonical_vs_assistant_hallucination" }],
    []
  );
  for (const m of [metrics.candidateRecallAtK, metrics.finalRecallAt8, metrics.falseInjectionRate, metrics.staleStateRecallRate, metrics.wrongObserverKnowledgeLeakCount, metrics.secretLeakCount]) {
    assert.equal(m.status, "NOT_MEASURED");
    assert.equal(m.value, null);
    assert.equal(m.eligibleCases, 0);
  }
});
