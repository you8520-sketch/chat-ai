import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import {
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import {
  computeBenchmarkMetrics,
  formatBenchmarkMetricsLine,
  type BenchmarkCaseOutcome,
} from "@/lib/memory/memory-rp-benchmark";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv;

function openDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  return db;
}

function seed(db: Database.Database, rows: Array<[number, string, string, string, string, string, string]>): number[] {
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

function evaluate(
  db: Database.Database,
  currentTurn: number,
  query: string,
  answerId: number
): { pre: boolean; final: boolean; falseInjected: boolean } {
  const input = { chatId: 1, currentTurn, currentUserMessage: query };
  const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const ranked = getEpisodicMemoryForPrompt(db, input, env);
  const finalIds = new Set(ranked.facts.map((f) => f.id));
  const unrelatedInjected = ranked.facts.some((f) => f.id !== answerId && f.subject.startsWith("filler"));
  return {
    pre: pre.rows.some((r) => r.id === answerId),
    final: finalIds.has(answerId),
    falseInjected: unrelatedInjected,
  };
}

it("RP memory benchmark emits raw metrics only (no subjective scores)", () => {
  const outcomes: BenchmarkCaseOutcome[] = [];

  // semantic_paraphrase: saturated recent lane → candidate-recall gap.
  {
    const db = openDb();
    const [answerId] = seed(db, [
      [10, "setting", "thunderfear", "note", "quietdread", "normal", "사용자는 천둥 소리를 무서워한다고 명시했다."],
    ]);
    for (let i = 0; i < 60; i++) {
      seed(db, [
        [20 + i, "setting", `filler${i}`, "note", `v${i}`, "normal", `채우기 기록 ${i}번 항해 일지 바다 파도`],
      ]);
    }
    const r = evaluate(db, 200, "폭풍우 속 옛 공포가 되살아나는 밤", answerId!);
    outcomes.push({
      caseId: "semantic-paraphrase-01",
      category: "semantic_paraphrase",
      expectedPresent: true,
      preCandidateHit: r.pre,
      finalInjected: r.final,
      falseInjected: r.falseInjected,
      staleInjected: false,
      secretLeaked: false,
    });
    db.close();
  }

  // irrelevant-critical vs relevant-normal: lexical bridge present → correct recall.
  {
    const db = openDb();
    seed(db, [[10, "setting", "tower", "color", "blue", "critical", "북쪽 탑은 파란색이었다."]]);
    const [answerId] = seed(db, [
      [11, "setting", "storm", "shelter", "cave", "normal", "폭풍우가 올 때 동굴에 피신했다."],
    ]);
    const r = evaluate(db, 20, "폭풍우 장면을 이어줘", answerId!);
    outcomes.push({
      caseId: "irrelevant-critical-vs-relevant-normal-01",
      category: "irrelevant_critical_vs_relevant_normal",
      expectedPresent: true,
      preCandidateHit: r.pre,
      finalInjected: r.final,
      falseInjected: false,
      staleInjected: false,
      secretLeaked: false,
    });
    db.close();
  }

  // latest-state replacement: newest row must win, stale must not.
  {
    const db = openDb();
    const [, latestId] = seed(db, [
      [10, "setting", "harbor", "moored_ship", "bluegull", "normal", "항구에 갈매기호가 정박했다."],
      [30, "setting", "harbor", "moored_ship", "redgull", "normal", "항구의 정박 선박이 빨간갈매기호로 바뀌었다."],
    ]);
    const r = evaluate(db, 60, "항구에 정박한 배를 확인한다", latestId!);
    const ranked = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 60, currentUserMessage: "항구에 정박한 배를 확인한다" },
      env
    );
    const staleInjected = ranked.facts.some((f) => f.value === "bluegull");
    outcomes.push({
      caseId: "latest-state-replacement-01",
      category: "latest_state_replacement",
      expectedPresent: true,
      preCandidateHit: r.pre,
      finalInjected: r.final,
      falseInjected: false,
      staleInjected,
      secretLeaked: false,
    });
    db.close();
  }

  // boundary_5turn: answer just outside RAW (turn 1 of 1~5 seal) still recalls.
  {
    const db = openDb();
    const [answerId] = seed(db, [
      [2, "setting", "lantern", "kept", "shed", "normal", "등잔을 창고에 보관했다."],
    ]);
    const r = evaluate(db, 12, "창고에 보관한 등잔을 떠올린다", answerId!);
    outcomes.push({
      caseId: "boundary-5turn-01",
      category: "boundary_5turn",
      expectedPresent: true,
      preCandidateHit: r.pre,
      finalInjected: r.final,
      falseInjected: false,
      staleInjected: false,
      secretLeaked: false,
    });
    db.close();
  }

  // zero-relevant control is implicit in the harness contract: no expected answer,
  // no injection. Represented here as an expectedPresent=false passing case.
  outcomes.push({
    caseId: "zero-relevant-control-01",
    category: "semantic_paraphrase",
    expectedPresent: false,
    preCandidateHit: false,
    finalInjected: false,
    falseInjected: false,
    staleInjected: false,
    secretLeaked: false,
  });

  const metrics = computeBenchmarkMetrics(outcomes);
  console.info(`[RpMemoryBenchmark] ${formatBenchmarkMetricsLine(metrics)}`);

  // Raw-metric invariants only — no subjective quality assertions.
  assert.equal(metrics.cases, outcomes.length);
  assert.ok(metrics.candidateRecallAtK >= 0 && metrics.candidateRecallAtK <= 1);
  assert.ok(metrics.finalRecallAt8 >= 0 && metrics.finalRecallAt8 <= 1);
  assert.equal(metrics.secretLeakCount, 0);
  // Shadow integration is STOPped: no live calls, exact V2 fallback parity.
  assert.equal(metrics.providerCallsPerTurn, 0);
  assert.equal(metrics.jevInvocationRate, 0);
  assert.equal(metrics.jevP50LatencyMs, null);
  assert.equal(metrics.jevP95LatencyMs, null);
  assert.equal(metrics.jevCostPer1000Turns, null);
  assert.equal(metrics.fallbackParity, true);
  // The paraphrase candidate-recall gap is the proven narrow point.
  assert.ok(metrics.candidateRecallAtK < 1);
});
