/**
 * Medium-Term / Cascaded Memory audit — zero provider calls.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/hybridMemory";
import { MEDIUM_TERM_BLOCK_COUNT, shouldInjectMediumTermMemory } from "./memory-medium-term";
import {
  MOVING_DETAIL_MARKERS,
  MOVING_MAJOR_MARKERS,
  assembleMovingGlobalCompactStub,
  assembleMovingMediumRingText,
  buildMovingHorizonAuditHistory,
  estimateGlobalCompactionInputAtTurn,
  estimatePromptBudgetAtTurn,
  expectedMovingDetailPresence,
  globalMajorEventCoverage,
  movingDetailTurns,
  simulateMovingHorizonCoverage,
} from "./memory-medium-term-audit";
import { buildRecentNarrativeContextBlock, buildStoredHistoryStaticBlock } from "./memory-narrative-context";
import {
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import { readFileSync } from "node:fs";

const productionRecallEnv = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

describe("DORMANT HELPER AUDIT", () => {
  it("classifies narrative context helpers", () => {
    assert.equal(typeof buildRecentNarrativeContextBlock, "function");
    assert.equal(typeof buildStoredHistoryStaticBlock, "function");
    const route = readFileSync("src/app/api/chat/route.ts", "utf8");
    const builder = readFileSync("src/services/contextBuilder.ts", "utf8");
    assert.doesNotMatch(route, /buildRecentNarrativeContextBlock/);
    assert.doesNotMatch(route, /buildStoredHistoryStaticBlock/);
    assert.doesNotMatch(route, /recentNarrativeContext/);
    assert.match(route, /mediumTermMemoryBlock/);
    assert.match(builder, /medium-term-memory/);
  });

  it("Medium block count policy owner is canonical N15 — separate from dormant Recent Narrative Context", () => {
    assert.equal(MEDIUM_TERM_BLOCK_COUNT, 15);
    const mediumTerm = readFileSync("src/lib/memory/memory-medium-term.ts", "utf8");
    assert.match(mediumTerm, /MEDIUM_TERM_BLOCK_COUNT\s*=\s*15/);
    assert.doesNotMatch(mediumTerm, /resolveMediumTermBlockCount/);
    assert.doesNotMatch(mediumTerm, /MEDIUM_TERM_BLOCK_COUNT_GEMINI/);
  });
});

describe("MEDIUM ACTIVATION MATRIX", () => {
  it("exact / failure_fallback / stored_fallback / manual_global → OFF", () => {
    assert.equal(shouldInjectMediumTermMemory("exact"), false);
    assert.equal(shouldInjectMediumTermMemory("failure_fallback"), false);
    assert.equal(shouldInjectMediumTermMemory("stored_fallback"), false);
    assert.equal(shouldInjectMediumTermMemory("manual_global"), false);
  });

  it("global_compact → ON", () => {
    assert.equal(shouldInjectMediumTermMemory("global_compact"), true);
  });
});

describe("MOVING MID-HORIZON REPRODUCTION", () => {
  for (const currentTurn of [300, 1000] as const) {
    describe(`T${currentTurn}`, () => {
      it("WITHOUT Medium — compact Global drops all moving details", () => {
        const report = simulateMovingHorizonCoverage(currentTurn, 10, { mediumActive: false });
        assert.equal(report.globalHasNear, false);
        assert.equal(report.globalHasMid, false);
        assert.equal(report.globalHasFar, false);
        assert.equal(report.nearPresent, false);
        assert.equal(report.midPresent, false);
        assert.equal(report.farPresent, false);
        const stored = buildMovingHorizonAuditHistory(currentTurn);
        assert.ok(stored.includes(MOVING_DETAIL_MARKERS.near));
        assert.ok(stored.includes(MOVING_DETAIL_MARKERS.mid));
        assert.ok(stored.includes(MOVING_DETAIL_MARKERS.far));
      });

      for (const ringN of [5, 10, 15] as const) {
        it(`WITH Medium N=${ringN} — recovers expected moving details`, () => {
          const report = simulateMovingHorizonCoverage(currentTurn, ringN, { mediumActive: true });
          assert.equal(report.nearPresent, expectedMovingDetailPresence(ringN, "near"));
          assert.equal(report.midPresent, expectedMovingDetailPresence(ringN, "mid"));
          assert.equal(report.farPresent, expectedMovingDetailPresence(ringN, "far"));
          assert.equal(report.mediumGlobalLiteralDuplicateChars, 0);
        });
      }

      it("detail turns follow relative age, not hard-coded absolute turns", () => {
        const turns = movingDetailTurns(currentTurn);
        assert.equal(turns.near, currentTurn - 20);
        assert.equal(turns.mid, currentTurn - 40);
        assert.equal(turns.far, currentTurn - 70);
      });
    });
  }
});

describe("N=5/10/15 ACTUAL COVERAGE", () => {
  for (const ringN of [5, 10, 15] as const) {
    it(`T300 N=${ringN} — turn horizon and budget evidence`, () => {
      const report = simulateMovingHorizonCoverage(300, ringN, { mediumActive: true });
      assert.ok(report.mediumChars > 0);
      assert.ok(report.globalChars > 0);
      assert.equal(report.mediumGlobalLiteralDuplicateChars, 0);
      const budget = estimatePromptBudgetAtTurn(300, ringN);
      assert.ok(budget.totalTokens < 40_000);
    });
  }
});

describe("GLOBAL COMPACT OVERLAP", () => {
  it("healthy global_compact stub retains OLD/MID/RECENT majors", () => {
    const global = assembleMovingGlobalCompactStub(300);
    const coverage = globalMajorEventCoverage(global);
    assert.ok(coverage.old);
    assert.ok(coverage.mid);
    assert.ok(coverage.recent);
    assert.equal(global.includes(MOVING_DETAIL_MARKERS.near), false);
  });

  it("Medium restores granular details without literal body duplication", () => {
    const report = simulateMovingHorizonCoverage(300, 10, { mediumActive: true });
    assert.equal(report.mediumGlobalLiteralDuplicateChars, 0);
  });
});

describe("PROMPT TOKEN DELTA", () => {
  it("global_compact path — bounded additive medium budget at T300 N=10", () => {
    const withMedium = estimatePromptBudgetAtTurn(300, 10, { mediumActive: true });
    const withoutMedium = estimatePromptBudgetAtTurn(300, 10, { mediumActive: false });
    assert.ok(withMedium.mediumChars > 0);
    assert.equal(withoutMedium.mediumChars, 0);
    assert.ok(withMedium.totalTokens > withoutMedium.totalTokens);
    assert.ok(withMedium.totalTokens < 40_000);
  });
});

describe("GLOBAL COMPACTION COST", () => {
  for (const turns of [100, 300, 1000, 2000] as const) {
    it(`input growth at ${turns} turns`, () => {
      const report = estimateGlobalCompactionInputAtTurn(turns);
      assert.equal(report.sealCadenceTurns, 5);
      assert.ok(report.rebuiltInputChars > 0);
      assert.ok(report.sealedBlockCount === Math.floor((turns - 1) / 5));
      if (turns > 100) {
        assert.ok(
          report.rebuiltInputChars >
            estimateGlobalCompactionInputAtTurn(100).rebuiltInputChars
        );
      }
    });
  }
});

describe("SEMANTIC RETRIEVAL GAP", () => {
  function createDb(): Database.Database {
    const db = new Database(":memory:");
    ensureEpisodicMemoryFactsTable(db);
    db.exec(`
      CREATE TABLE chat_memories (
        chat_id INTEGER PRIMARY KEY,
        memory_reset_after_message_id INTEGER,
        memory_epoch INTEGER NOT NULL DEFAULT 0
      );
    `);
    return db;
  }

  it("paraphrase cue still misses normal-importance rain shelter event", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'setting', 'abandoned_station', 'scene_event', 'rain_shelter', 'normal',
               '폭우가 쏟아지는 폐역 안으로 피신했다.', '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, ?, 'setting', 'ambient', ?, ?, 'normal', ?, '{}')`
    );
    for (let turn = 21; turn <= 170; turn++) {
      insert.run(turn, `ambient_${turn}`, `detail_${turn}`, `T${turn}에서 무관한 배경 디테일이 기록되었다.`);
    }
    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 180, currentUserMessage: "그 비 오던 밤 기억나?" },
      productionRecallEnv
    );
    const targetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
    ).id;
    assert.ok(!recall.facts.some((fact) => fact.id === targetId));
    const candidates = fetchEpisodicMemoryCandidatesForDebug(
      db,
      { chatId: 1, currentTurn: 180, currentUserMessage: "그 비 오던 밤 기억나?" },
      productionRecallEnv
    );
    const lanes = candidates.laneById.get(targetId) ?? [];
    assert.ok(!lanes.includes("relevance"));
  });
});

describe("IMPLEMENTATION GATE", () => {
  it("moving-window gap confirmed and Medium N15 recovers near+mid+far", () => {
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    const withoutMedium = simulateMovingHorizonCoverage(300, MEDIUM_TERM_BLOCK_COUNT, {
      mediumActive: false,
    });
    assert.equal(withoutMedium.nearPresent, false);
    assert.equal(withoutMedium.midPresent, false);
    assert.equal(withoutMedium.farPresent, false);
    const withMedium = simulateMovingHorizonCoverage(300, MEDIUM_TERM_BLOCK_COUNT, {
      mediumActive: true,
    });
    assert.equal(withMedium.nearPresent, true);
    assert.equal(withMedium.midPresent, true);
    assert.equal(withMedium.farPresent, true);
  });
});
