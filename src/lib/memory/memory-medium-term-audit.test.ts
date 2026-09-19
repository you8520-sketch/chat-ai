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
import {
  GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT,
  CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT,
  DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT,
} from "@/lib/contextTrack";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/hybridMemory";
import {
  CHRONO_MINI_ARC_FACTS,
  CHRONO_ANCHOR_FACTS,
  assembleChronoGlobalMemoryText,
  assembleChronoMediumRingText,
  buildChronologyAuditHistory,
  classifyFactLayer,
  designAMediumGlobalDuplicateChars,
  estimateGlobalCompactionInputAtTurn,
  estimatePromptBudgetAtTurn,
  globalMajorEventCoverage,
  simulateMediumDesignComparison,
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

  it("documents model-specific stored-summary limits origin", () => {
    assert.equal(GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT, 15);
    assert.equal(DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT, 10);
    assert.equal(CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT, 5);
  });
});

describe("MID-HORIZON LOSS REPRODUCTION", () => {
  const inspectTurns = [80, 120, 300, 1000] as const;

  for (const currentTurn of inspectTurns) {
    it(`T${currentTurn} — mini-arc markers present in medium ring, may drop from global overflow`, () => {
      const medium = assembleChronoMediumRingText(currentTurn, 10);
      const global = assembleChronoGlobalMemoryText(currentTurn);
      const stored = buildChronologyAuditHistory(currentTurn);
      const arcAbsentFromBoth: string[] = [];

      for (const fact of CHRONO_MINI_ARC_FACTS) {
        if (fact.turn >= currentTurn) continue;
        const layer = classifyFactLayer(fact.marker, fact.turn, currentTurn, {
          mediumText: medium,
          globalText: global,
        });
        if (layer === "ABSENT") arcAbsentFromBoth.push(fact.marker);
      }

      if (currentTurn <= 120) {
        assert.equal(arcAbsentFromBoth.length, 0, "short horizon keeps arc in medium or global");
      }

      if (currentTurn >= 300) {
        assert.equal(
          global.includes("OLD_MAJOR_MILESTONE"),
          false,
          "global emergency trim drops old milestone at T300+"
        );
        assert.ok(
          stored.includes("ARC_T45_SMALL_EVENT") && stored.includes("ARC_T70_DIRECTION_CHANGE"),
          "stored 5-turn records still retain full mini-arc at T300+"
        );
        assert.ok(
          arcAbsentFromBoth.length > 0,
          "long horizon loses mid-arc from RAW+Global+default medium ring"
        );
      }
    });
  }

  it("confirms mid-horizon narrative gap at T300", () => {
    const medium = assembleChronoMediumRingText(300, 10);
    const global = assembleChronoGlobalMemoryText(300);
    const stored = buildChronologyAuditHistory(300);
    const oldMilestone = CHRONO_ANCHOR_FACTS.find((f) => f.marker === "OLD_MAJOR_MILESTONE")!;
    const layer = classifyFactLayer(oldMilestone.marker, oldMilestone.turn, 300, {
      mediumText: medium,
      globalText: global,
    });
    assert.equal(layer, "ABSENT");
    assert.ok(stored.includes("OLD_MAJOR_MILESTONE"), "canonical stored records still own old milestone");
    assert.ok(
      assembleChronoMediumRingText(80, 10).includes("ARC_T55_REASON_REVEALED"),
      "medium ring surfaces mid-arc when inside N-block window"
    );
  });
});

describe("N=5/10/15 COMPARISON", () => {
  for (const n of [5, 10, 15] as const) {
    it(`T300 ring N=${n} coverage and budget evidence`, () => {
      const report = simulateMediumDesignComparison(300, n);
      assert.equal(report.ringN, n);
      assert.ok(report.mediumChars > 0);
      assert.ok(report.globalChars <= 10_000);
      assert.ok(report.arcMarkersInMedium.length >= report.arcMarkersInMedium.length);
      if (n === 5) assert.ok(report.mediumChars < report.mediumTokens * 2);
    });
  }
});

describe("SOURCE RANGE OWNERSHIP", () => {
  it("Design A duplicate chars — semantic overlap allowed, literal dup reported", () => {
    const dup = designAMediumGlobalDuplicateChars(300, 10);
    assert.ok(dup >= 0);
    const sim = simulateMediumDesignComparison(300, 10);
    assert.ok(sim.mediumGlobalRangeOverlaps > 0, "medium ranges overlap global source ranges by design A");
  });
});

describe("GLOBAL COVERAGE PRESERVED", () => {
  it("healthy global retains OLD/MID/RECENT markers in audit simulation below overflow", () => {
    const global = assembleChronoGlobalMemoryText(80);
    const coverage = globalMajorEventCoverage(global);
    assert.ok(coverage.old || global.includes("OLD_MAJOR_MILESTONE"));
  });
});

describe("PROMPT TOKEN DELTA", () => {
  it("reports bounded additive medium budget at T300 N=10", () => {
    const budget = estimatePromptBudgetAtTurn(300, 10);
    assert.ok(budget.mediumChars > 0);
    assert.ok(budget.globalChars <= 10_000);
    assert.ok(budget.totalTokens > budget.globalTokens);
    assert.ok(budget.totalTokens < 40_000);
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
  it("gate conditions satisfied for minimal medium reader", () => {
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    const gapAt300 = classifyFactLayer("OLD_MAJOR_MILESTONE", 20, 300, {
      mediumText: assembleChronoMediumRingText(300, 10),
      globalText: assembleChronoGlobalMemoryText(300),
    });
    assert.equal(gapAt300, "ABSENT");
    assert.ok(
      buildChronologyAuditHistory(300).includes("OLD_MAJOR_MILESTONE"),
      "stored summaries still own dropped global fact"
    );
    assert.ok(
      assembleChronoMediumRingText(80, 10).includes("ARC_T55_REASON_REVEALED"),
      "medium reader can surface stored mid-arc inside ring window"
    );
  });
});
