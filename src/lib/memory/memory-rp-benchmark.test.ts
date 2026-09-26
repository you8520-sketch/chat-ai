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

function evaluate(
  db: Database.Database,
  currentTurn: number,
  query: string,
  answerId: number
): { pre: boolean; final: boolean; falseInjected: boolean } {
  const input = { chatId: 1, currentTurn, currentUserMessage: query };
  const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  evaluatedTurns += 1;
  const ranked = getEpisodicMemoryForPrompt(db, input, env);
  const finalIds = new Set(ranked.facts.map((f) => f.id));
  return {
    pre: pre.rows.some((r) => r.id === answerId),
    final: finalIds.has(answerId),
    falseInjected: ranked.facts.some((f) => f.id !== answerId && f.subject.startsWith("filler")),
  };
}

function push(
  outcomes: BenchmarkCaseOutcome[],
  o: BenchmarkCaseOutcome
): void {
  outcomes.push(o);
}

it("RP memory benchmark executes all requested categories against real canonical owners", () => {
  const outcomes: BenchmarkCaseOutcome[] = [];

  { // boundary_5turn — first seal batch (1~5) recalls past RAW via the retrieval owner.
    const db = openDb();
    const [answerId] = seed(db, [[2, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."]]);
    const r = evaluate(db, 12, "창고에 보관한 등잔을 묻는다", answerId!);
    assert.equal(r.pre, true);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "boundary-5turn-01", category: "boundary_5turn", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // callback_75turn — 80-turn-old fact still recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "well", "rope", "newrope", "normal", "우물에 새 밧줄을 매달았다."]]);
    const r = evaluate(db, 90, "우물에 매단 새 밧줄을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "callback-75turn-01", category: "callback_75turn", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // t300 — critical historical milestone recalls at T300.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const r = evaluate(db, 300, "두 사람의 첫 만남을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "t300-01", category: "t300", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // t1000 — same milestone recalls at T1000.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "scene_event", "first_meeting", "critical", "두 사람의 첫 만남이 오래전에 끝났다."]]);
    const r = evaluate(db, 1000, "두 사람의 첫 만남을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "t1000-01", category: "t1000", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // semantic_paraphrase — KNOWN_GAP_BASELINE_REPRO (not a permanent invariant).
    // Old normal non-historical fact + saturated recent lane + paraphrased cue
    // (no shared token) + milestone-ineligible → pre-candidate miss on main.
    // The approved semantic-candidate-discovery fix PR MUST flip this case to
    // pre=true / final=true; until then the miss is the documented baseline.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "thunderfear", "note", "quietdread", "normal", "사용자는 천둥 소리를 무서워한다고 명시했다."]]);
    saturate(db, 60, 20);
    const r = evaluate(db, 200, "폭풍우 속 옛 공포가 되살아나는 밤", answerId!);
    assert.equal(r.pre, false);
    assert.equal(r.final, false);
    push(outcomes, { caseId: "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01", category: "semantic_paraphrase", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // promise — non-ledger commitment recalls (formal 약속-class stays ledger-owned).
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "pair", "meeting_plan", "bringbook", "normal", "다음 만남에 책을 가져오기로 했다."]]);
    const r = evaluate(db, 40, "다음 만남에 가져오기로 한 책을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "promise-01", category: "promise", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // betrayal — completed betrayal event recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "character", "ivan", "scene_event", "betrayal_done", "important", "이반의 배신이 완료되었다."]]);
    const r = evaluate(db, 70, "이반의 배신이 완료된 일을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "betrayal-01", category: "betrayal", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // first_never — first-time marker recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "setting", "observatory", "visit", "firstvisit", "normal", "두 사람이 처음으로 전망대에 올랐다."]]);
    const r = evaluate(db, 50, "전망대에 처음 오른 날을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "first-never-01", category: "first_never", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // role_event_direction — participant + direction explicit.
    const db = openDb();
    const [answerId] = seed(db, [[10, "relationship", "mina", "role_direction", "embraced_by_jun", "normal", "준이 미나를 뒤에서 안아주었다."]]);
    const r = evaluate(db, 40, "준이 미나를 안아준 일을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "role-event-direction-01", category: "role_event_direction", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // same_turn_multi_event — two same-turn events both inject.
    const db = openDb();
    const [id1, id2] = seed(db, [
      [10, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."],
      [10, "setting", "gatekey", "placed", "doorstep", "normal", "낡은 열쇠를 문간에 두었다."],
    ]);
    const input = { chatId: 1, currentTurn: 40, currentUserMessage: "창고의 등잔과 문간의 열쇠를 묻는다" };
    fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    evaluatedTurns += 1;
    const ranked = getEpisodicMemoryForPrompt(db, input, env);
    const ids = new Set(ranked.facts.map((f) => f.id));
    assert.equal(ids.has(id1!), true);
    assert.equal(ids.has(id2!), true);
    push(outcomes, { caseId: "same-turn-multi-event-01", category: "same_turn_multi_event", expectedPresent: true, preCandidateHit: true, finalInjected: true, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // latest_state_replacement — newest row wins, stale row loses (measured).
    const db = openDb();
    const [, latestId] = seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [30, "setting", "harbor", "moored_ship", "redgull", "normal", "항구의 정박 선박이 빨간갈매기호로 바뀌었다."],
    ]);
    const r = evaluate(db, 60, "항구에 정박한 배를 묻는다", latestId!);
    const ranked = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 60, currentUserMessage: "항구에 정박한 배를 묻는다" }, env);
    evaluatedTurns += 1;
    const staleInjected = ranked.facts.some((f) => f.value === "bluegull");
    assert.equal(r.final, true);
    assert.equal(staleInjected, false);
    push(outcomes, { caseId: "latest-state-replacement-01", category: "latest_state_replacement", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: false, staleInjected, secretLeaked: false });
    db.close();
  }

  { // historical_repeat_events — two completed events on one key both stay candidates.
    const db = openDb();
    const [id1, id2] = seed(db, [
      [10, "character", "rin", "action", "fell", "normal", "린이 계단에서 넘어졌다."],
      [20, "character", "rin", "action", "recovered", "normal", "린이 넘어진 뒤 자리에서 일어났다."],
    ]);
    const input = { chatId: 1, currentTurn: 60, currentUserMessage: "린이 넘어진 일을 묻는다" };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    evaluatedTurns += 1;
    const preIds = new Set(pre.rows.map((r) => r.id));
    assert.equal(preIds.has(id1!), true);
    assert.equal(preIds.has(id2!), true);
    const ranked = getEpisodicMemoryForPrompt(db, input, env);
    push(outcomes, { caseId: "historical-repeat-events-01", category: "historical_repeat_events", expectedPresent: true, preCandidateHit: true, finalInjected: ranked.facts.some((f) => f.id === id2), falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // irrelevant_critical_vs_relevant_normal — lexical bridge decides, not importance.
    const db = openDb();
    seed(db, [[10, "setting", "tower", "color", "blue", "critical", "북쪽 탑은 파란색이었다."]]);
    const [answerId] = seed(db, [[11, "setting", "storm", "shelter", "cave", "normal", "폭풍우가 올 때 동굴에 피신했다."]]);
    const r = evaluate(db, 20, "폭풍우 장면을 이어줘", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "irrelevant-critical-vs-relevant-normal-01", category: "irrelevant_critical_vs_relevant_normal", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // user_canonical_vs_assistant_hallucination — real canon guard owner, no retrieval.
    // Risky state claim without disclosure framing is blocked; the same claim
    // grounded as an explicit user statement is allowed.
    const risky = { category: "character", attribute: "awakening_status", value: "high", fact_text: "그는 높은 등급으로 각성했다" } as const;
    assert.equal(detectUnverifiedCanonicalization(risky), "unverified_canonicalization");
    assert.equal(
      detectUnverifiedCanonicalization({ ...risky, fact_text: "유저가 명시했다: 그는 높은 등급으로 각성했다", evidence_type: "explicit_user_statement" } as never),
      null
    );
    push(outcomes, { caseId: "user-canonical-vs-assistant-hallucination-01", category: "user_canonical_vs_assistant_hallucination", expectedPresent: false, preCandidateHit: false, finalInjected: false, falseInjected: false, staleInjected: false, secretLeaked: false });
  }

  { // regeneration_rejected_event — real reconcile owner deletes the rejected variant.
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","assistant_message_id":501,"request_id":"r1"}')`).run();
    const out = reconcileEpisodicMemoryFactsForGeneration(db, { chatId: 1, sourceTurn: 10, facts: [], isRegeneration: true, metadata: { regenerated: true } });
    assert.equal(out.replaced, true);
    assert.equal(listEpisodicMemoryFactsForDebug(db, { chatId: 1 }).length, 0);
    const ranked = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 40, currentUserMessage: "창고의 등잔을 묻는다" }, env);
    evaluatedTurns += 1;
    assert.equal(ranked.facts.length, 0);
    push(outcomes, { caseId: "regeneration-rejected-event-01", category: "regeneration_rejected_event", expectedPresent: false, preCandidateHit: false, finalInjected: false, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // message_edit — real canonical-mutation replace owner swaps v1 for v2.
    const db = openDb();
    const v1 = { category: "setting", subject: "tower", attribute: "color", value: "blue", importance: "normal", fact_text: "북쪽 탑은 파란색이었다.", evidence_type: "explicit_scene_event" } as const;
    const v2 = { category: "setting", subject: "tower", attribute: "color", value: "red", importance: "normal", fact_text: "북쪽 탑은 빨간색이었다.", evidence_type: "explicit_scene_event" } as const;
    assert.equal(persistEpisodicMemoryFactsCore(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v1 }] }), 1);
    assert.equal(replaceEpisodicMemoryFactsForCanonicalMutation(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v2 }] }), 1);
    const rows = listEpisodicMemoryFactsForDebug(db, { chatId: 1 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.value, "red");
    const r = evaluate(db, 40, "북쪽 탑의 색을 묻는다", rows[0]!.id);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "message-edit-01", category: "message_edit", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // delete_rewind — real assistant-id delete owner removes the facts.
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event","assistant_message_id":601,"request_id":"r1"}')`).run();
    assert.equal(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [601]), 1);
    assert.equal(listEpisodicMemoryFactsForDebug(db, { chatId: 1 }).length, 0);
    push(outcomes, { caseId: "delete-rewind-01", category: "delete_rewind", expectedPresent: false, preCandidateHit: false, finalInjected: false, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // fork_variant — real recall-side fork scope excludes pre-fork sources.
    const db = openDb();
    db.prepare(`INSERT INTO episodic_memory_facts (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata) VALUES (1, 10, 5, 'setting','lantern','kept','shed','normal','등잔을 창고에 보관했다.','{"memory_evidence_type":"explicit_scene_event"}')`).run();
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, { chatId: 1, currentTurn: 40, currentUserMessage: "창고의 등잔을 묻는다" }, env);
    evaluatedTurns += 1;
    assert.equal(pre.rows.length, 0);
    push(outcomes, { caseId: "fork-variant-01", category: "fork_variant", expectedPresent: false, preCandidateHit: false, finalInjected: false, falseInjected: false, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // persona_secret_wrong_observer — real isolation owner: B sees nothing of A's knowledge.
    const db = openDb();
    upsertObserverSecretKnowledge({
      chatId: 1, personaId: 1, secretId: "s1",
      observerType: "CHARACTER", observerId: "10",
      knowledgeState: "CONFIRMED", confidence: 0.9,
      factSnapshot: "지켜야 할 약속의 내용이 여기에 기록되었다.",
      lastEvidenceEventId: "e1", db,
    });
    assert.notEqual(getObserverSecretKnowledge({ chatId: 1, personaId: 1, secretId: "s1", observerType: "CHARACTER", observerId: "10", db }), null);
    const leaked = getObserverSecretKnowledge({ chatId: 1, personaId: 1, secretId: "s1", observerType: "CHARACTER", observerId: "99", db }) !== null;
    assert.equal(leaked, false);
    push(outcomes, { caseId: "persona-secret-wrong-observer-01", category: "persona_secret_wrong_observer", expectedPresent: false, preCandidateHit: false, finalInjected: false, falseInjected: false, staleInjected: false, secretLeaked: leaked });
    db.close();
  }

  { // trpg_quest — quest callback recalls.
    const db = openDb();
    const [answerId] = seed(db, [[10, "quest", "torch", "delivery", "chapel", "important", "횃불을 예배당에 전달하는 임무를 받았다."]]);
    const r = evaluate(db, 80, "예배당 임무의 진행 상황을 묻는다", answerId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "trpg-quest-01", category: "trpg_quest", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // character_state_transition — injury then recovery both preserved; injury recalls.
    const db = openDb();
    const [injuryId] = seed(db, [
      [10, "character", "rin", "action", "leg_injury", "normal", "린이 다리에 부상을 입었다."],
      [20, "character", "rin", "action", "leg_recovery", "normal", "린이 다리 부상에서 회복되었다."],
    ]);
    const r = evaluate(db, 60, "린이 다리 부상을 입은 일을 묻는다", injuryId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "character-state-transition-01", category: "character_state_transition", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  { // location_ownership_transition — harbor mooring replacement, newest wins.
    const db = openDb();
    const [, latestId] = seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [30, "setting", "harbor", "moored_ship", "redgull", "normal", "항구의 정박 선박이 빨간갈매기호로 바뀌었다."],
    ]);
    const r = evaluate(db, 60, "항구의 정박 선박을 묻는다", latestId!);
    assert.equal(r.final, true);
    push(outcomes, { caseId: "location-ownership-transition-01", category: "location_ownership_transition", expectedPresent: true, preCandidateHit: r.pre, finalInjected: r.final, falseInjected: r.falseInjected, staleInjected: false, secretLeaked: false });
    db.close();
  }

  const categories: BenchmarkCategory[] = [
    "boundary_5turn", "callback_75turn", "t300", "t1000", "semantic_paraphrase",
    "promise", "betrayal", "first_never", "role_event_direction", "same_turn_multi_event",
    "latest_state_replacement", "historical_repeat_events", "irrelevant_critical_vs_relevant_normal",
    "user_canonical_vs_assistant_hallucination", "regeneration_rejected_event", "message_edit",
    "delete_rewind", "fork_variant", "persona_secret_wrong_observer", "trpg_quest",
    "character_state_transition", "location_ownership_transition",
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

  // Status contract — measured values are evidence, nulls are explicit stops.
  assert.equal(metrics.cases, outcomes.length);
  assert.equal(metrics.candidateRecallAtK.status, "MEASURED");
  assert.equal(metrics.finalRecallAt8.status, "MEASURED");
  assert.equal(metrics.falseInjectionRate.status, "MEASURED");
  assert.equal(metrics.staleStateRecallRate.status, "MEASURED");
  assert.equal(metrics.secretLeakCount.status, "MEASURED");
  assert.equal(metrics.secretLeakCount.value, 0);
  assert.equal(metrics.baselineVsShadowDelta.status, "NOT_APPLICABLE");
  assert.equal(metrics.baselineVsShadowDelta.value, null);
  assert.equal(metrics.providerCallsPerTurn.status, "MEASURED");
  assert.equal(metrics.providerCallsPerTurn.value, 0);
  assert.equal(metrics.jevInvocationRate.status, "MEASURED");
  assert.equal(metrics.jevInvocationRate.value, 0);
  for (const m of [metrics.jevP50LatencyMs, metrics.jevP95LatencyMs, metrics.jevCostPer1000Turns, metrics.promptTokenDelta, metrics.fallbackParity]) {
    assert.equal(m.status, "NOT_APPLICABLE");
    assert.equal(m.value, null);
  }
});

it("zero-relevant control executes real retrieval and injects nothing", () => {
  const db = openDb();
  seed(db, [[10, "setting", "tower", "color", "blue", "normal", "북쪽 탑은 파란색이었다."]]);
  // Real production retrieval owner — not a hand-written outcome object.
  const ranked = getEpisodicMemoryForPrompt(
    db,
    { chatId: 1, currentTurn: 20, currentUserMessage: "바다 항해를 시작한다" },
    env
  );
  assert.equal(ranked.facts.length, 0);
  assert.equal(ranked.promptBlock, "");
  console.info("[RpMemoryBenchmark] zero-relevant control: real retrieval, 0 facts injected");
  db.close();
});
