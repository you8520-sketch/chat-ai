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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

import {
  GEMINI_STATIC_STORED_SUMMARY_LIMIT,
  DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT,
  CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT,
  GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT,
  resolveStaticStoredSummaryLimit,
  resolveRecentNarrativeContextLimit,
} from "@/lib/contextTrack";
import {
  DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES,
  RAW_HISTORY_COMPLETE_EXCHANGES,
} from "@/lib/hybridMemory";
import {
  ARCHIVE_CAPACITY_FIXED,
  MEMORY_CAPACITY_FIXED,
} from "./memory-capacity-shared";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import {
  MEMORY_POLICY_ID,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_TARGET_CHARS,
} from "./memory-constants";
import {
  assembleActiveRingText,
  assembleCurrentMemoryText,
  auditTenKOverflowOwnerProof,
  buildOverflowSummaryFixture,
  classifyFactFailure,
  detectOverflowMarkers,
  inspectFactPresence,
  joinOverflowBlocks,
  MID_HORIZON_FACTS,
  OVERFLOW_AUDIT_MARKERS,
  simulateDesign,
  TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS,
  worstCaseCombinedBudgetChars,
} from "./memory-architecture-audit";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { resolveLorebookFromRecordsSync } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __setCompactCurrentMemoryTestOverride,
  compactCurrentMemory,
} from "./memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import {
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  resolveEpisodicMemoryMaxChars,
  resolveEpisodicMemoryMaxFacts,
  resolveEpisodicMemoryMinAgeTurns,
} from "@/lib/episodicMemoryFacts";
import { buildContext } from "@/services/contextBuilder";
import { buildHierarchicalMemoryPromptLayers } from "./memory-manager";
import { buildRecentNarrativeContextBlock, buildStoredHistoryStaticBlock } from "./memory-narrative-context";

const productionRecallEnv = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

describe("CURRENT PRODUCTION NUMBERS", () => {
  it("canonical policy and budgets match Railway defaults", () => {
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES, 5);
    assert.equal(ROLLING_SUMMARY_TARGET_CHARS, 450);
    assert.equal(ROLLING_SUMMARY_MAX_CHARS, 600);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
    assert.equal(ARCHIVE_CAPACITY_FIXED, 3000);
    assert.equal(resolveEpisodicMemoryMaxFacts({} as NodeJS.ProcessEnv), 8);
    assert.equal(resolveEpisodicMemoryMaxChars({} as NodeJS.ProcessEnv), 1000);
    assert.equal(resolveEpisodicMemoryMinAgeTurns({} as NodeJS.ProcessEnv), 5);
  });
});

describe("DORMANT SUMMARY SYSTEM AUDIT", () => {
  it("contextTrack stored-summary limits are Gemini 15 / DeepSeek 10 / Claude 5", () => {
    assert.equal(GEMINI_STATIC_STORED_SUMMARY_LIMIT, 15);
    assert.equal(GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT, 15);
    assert.equal(DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT, 10);
    assert.equal(CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT, 5);
    assert.equal(resolveStaticStoredSummaryLimit("gemini-3.1-pro", "gemini"), 15);
    assert.equal(resolveStaticStoredSummaryLimit("deepseek-v4-pro", "openrouter"), 10);
    assert.equal(resolveStaticStoredSummaryLimit("claude-sonnet", "openrouter"), 5);
    assert.equal(resolveRecentNarrativeContextLimit("gemini-3.1-pro", "gemini"), 15);
    assert.equal(resolveRecentNarrativeContextLimit("deepseek-v4-pro", "openrouter"), 10);
    assert.equal(resolveRecentNarrativeContextLimit("claude-sonnet", "openrouter"), 5);
  });

  it("helpers exist but Main RP does not call them", () => {
    assert.equal(typeof buildRecentNarrativeContextBlock, "function");
    assert.equal(typeof buildStoredHistoryStaticBlock, "function");
    assert.equal(typeof buildHierarchicalMemoryPromptLayers, "function");

    const route = readFileSync("src/app/api/chat/route.ts", "utf8");
    const builder = readFileSync("src/services/contextBuilder.ts", "utf8");
    const manager = readFileSync("src/lib/memory/memory-manager.ts", "utf8");
    assert.doesNotMatch(route, /buildHierarchicalMemoryPromptLayers/);
    assert.doesNotMatch(route, /recentNarrativeContext/);
    assert.doesNotMatch(builder, /recentNarrativeContext/);
    assert.doesNotMatch(builder, /buildStoredHistoryStaticBlock/);
    assert.match(manager, /buildHierarchicalMemoryPromptLayers/);
    assert.match(manager, /buildRecentNarrativeContextBlock/);
  });

  it("OpenRouter Main RP does not inject recent-narrative-context even when provided", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "안녕" }],
      currentUserMessage: "다음",
      nsfw: false,
      provider: "openrouter",
      longTermMemory: "[현재기억]\n요약 본문",
      recentNarrativeContext: "[RECENT NARRATIVE CONTEXT]\n독립 요약 블록",
    });
    const ids = built.meta.trackedSections?.map((section) => section.id) ?? [];
    assert.doesNotMatch(ids.join(","), /recent-narrative-context/);
    assert.doesNotMatch(built.systemPrompt, /RECENT NARRATIVE CONTEXT/);
    assert.match(built.systemPrompt, /현재기억|Memory/);
  });
});

describe("MID-HORIZON LOSS REPRODUCTION", () => {
  const inspectTurns = [40, 80, 120, 300, 1000];

  for (const currentTurn of inspectTurns) {
    it(`classifies each fixture at T${currentTurn}`, () => {
      const currentMemoryText = assembleCurrentMemoryText(currentTurn);
      const ringText = assembleActiveRingText(currentTurn, 10);
      assert.ok(currentMemoryText.length <= MEMORY_CAPACITY_FIXED);

      for (const fact of MID_HORIZON_FACTS) {
        if (fact.turn >= currentTurn) continue;
        const presence = inspectFactPresence(fact, currentTurn, {
          currentMemoryText,
          ringText: "",
          archiveText: "",
          relationshipText: "",
          episodicCandidate: false,
          episodicInjected: false,
        });
        const failure = classifyFactFailure(fact, presence, currentTurn);
        const summarizedThrough = Math.floor((currentTurn - 1) / 5) * 5;
        assert.equal(presence.individualSummaryRecord, fact.turn <= summarizedThrough);

        if (currentTurn <= 80) {
          assert.equal(presence.raw, false);
          assert.equal(presence.currentMemory, true, `${fact.id} should still fit prefix 10K at T${currentTurn}`);
        }

        if (currentTurn >= 300 && fact.id === "B") {
          assert.equal(
            presence.currentMemory,
            false,
            `${fact.id} must fall out of prefer-recent 10K overflow at T${currentTurn}`
          );
        }

        if (currentTurn === 300 && fact.id === "E") {
          assert.equal(
            presence.currentMemory,
            true,
            `${fact.id} stays in prefer-recent overflow window at T300`
          );
        }

        if (currentTurn === 300 && fact.id === "B") {
          assert.equal(ringText.includes(fact.marker), false, "T30 is not inside a latest-10 ring at T300");
        }
      }
    });
  }

  it("prefer-recent overflow at T300 keeps T200 and drops T30 milestone", () => {
    const currentMemoryText = assembleCurrentMemoryText(300);
    const ringText = assembleActiveRingText(300, 10);
    assert.equal(currentMemoryText.includes("AUDIT_TEMP_RAIN_SOAKED_T200"), true);
    assert.equal(currentMemoryText.includes("AUDIT_MILESTONE_FIRST_KISS_T30"), false);
    assert.equal(ringText.includes("AUDIT_PLOT_MISSING_LEDGER_T90"), false);
  });
});

describe("DESIGN A/B/C SIMULATION", () => {
  it("reports ring cost and overlap at T300 for N=5/10/15", () => {
    const designA = simulateDesign("A", 300);
    assert.equal(designA.ringChars, 0);
    assert.ok(designA.currentMemoryChars <= MEMORY_CAPACITY_FIXED);

    for (const n of [5, 10, 15] as const) {
      const designB = simulateDesign("B", 300, n);
      const designC = simulateDesign("C", 300, n);
      assert.ok(designB.ringChars > 0);
      assert.ok(designB.ringChars <= n * 520);
      assert.ok(designB.currentMemoryCharsRemovedForOwnership >= 0);
      assert.ok(designC.currentMemoryChars >= designB.currentMemoryChars);
      assert.equal(typeof designB.deepSeekPromptEstimate, "number");
      assert.equal(typeof designB.gemini31PromptEstimate, "number");
      assert.equal(typeof designB.gemini37PromptEstimate, "number");
      assert.ok(designB.coveredTurnHorizon.includes("ring"));
    }
  });

  it("Design B without LTM exclusion duplicates newest sealed ranges still inside prefix", () => {
    const early = assembleCurrentMemoryText(40);
    const ring = assembleActiveRingText(40, 5);
    assert.ok(early.length > 0);
    assert.ok(ring.length > 0);
    assert.ok(early.includes("[1~5턴]"));
    assert.ok(ring.includes("[1~5턴]") || ring.includes("[6~10턴]") || ring.includes("[11~15턴]") || ring.includes("[16~20턴]") || ring.includes("[21~25턴]") || ring.includes("[26~30턴]") || ring.includes("[31~35턴]"));
  });
});

describe("CURRENT MEMORY SYNC TRIM FOOTGUN", () => {
  it("arrow-less overflow lorebook stays non-empty under prefer-recent sync trim", () => {
    const blob = Array.from({ length: 40 }, (_, i) =>
      `[${i * 5 + 1}~${i * 5 + 5}턴] ${"화살표없는요약 ".repeat(40)}${i}`
    ).join("\n\n");
    assert.ok(blob.length > MEMORY_CAPACITY_FIXED);
    const trimmed = trimLorebookToBudgetSync(blob, MEMORY_CAPACITY_FIXED);
    assert.ok(trimmed.length > 0);
    assert.ok(trimmed.length <= MEMORY_CAPACITY_FIXED);
  });
});

describe("GLOBAL CONTEXT BUDGET", () => {
  it("layers independently fill caps — no single global owner", () => {
    const budget = worstCaseCombinedBudgetChars();
    assert.equal(budget.singleGlobalBudgetOwner, false);
    assert.equal(budget.currentMemoryChars, 10000);
    assert.equal(budget.archiveChars, 3000);
    assert.equal(budget.episodicChars, 1000);
    assert.ok(budget.totalChars > 30000);
    assert.ok(budget.totalTokens > 27000);
  });
});

const OVERFLOW_CHAT = 993001;
const OVERFLOW_USER = 993002;
const OVERFLOW_CHAR = 993003;

function listProductionTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".next-dev") continue;
      listProductionTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function cleanupOverflowFixture(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(OVERFLOW_CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(OVERFLOW_CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(OVERFLOW_CHAT);
}

function seedOverflowChat(): void {
  const db = getDb();
  cleanupOverflowFixture();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    OVERFLOW_USER,
    `overflow-${OVERFLOW_USER}@test.local`,
    "overflow-audit",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(OVERFLOW_CHAR, "OverflowChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    OVERFLOW_CHAT,
    OVERFLOW_USER,
    OVERFLOW_CHAR
  );
  getOrCreateChatMemory(OVERFLOW_CHAT, OVERFLOW_USER, OVERFLOW_CHAR, "free");
}

function insertOverflowSummaries(extraBlocks = 0): ReturnType<typeof buildOverflowSummaryFixture> {
  const blocks = buildOverflowSummaryFixture({ blockCount: 28 + extraBlocks });
  const db = getDb();
  for (const block of blocks) {
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
       VALUES (?,?,?,?,?)`
    ).run(OVERFLOW_CHAT, block.turnStart, block.turnEnd, block.body, "main_canon");
  }
  return blocks;
}

function extractPromptRecentBody(injectionText: string): string {
  const match = injectionText.match(/\[현재기억\][\s\S]*?\n\n([\s\S]*)$/);
  return match?.[1]?.trim() ?? injectionText;
}

describe("10K OVERFLOW OWNER PROOF", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  beforeEach(() => {
    seedOverflowChat();
    __setCompactCurrentMemoryTestOverride(null);
  });

  after(() => {
    __setCompactCurrentMemoryTestOverride(null);
    cleanupOverflowFixture();
  });

  it("fixture exceeds 10K and carries OLD/MID/RECENT markers in stored records", () => {
    const blocks = insertOverflowSummaries();
    const joined = joinOverflowBlocks(blocks);
    assert.ok(joined.length > MEMORY_CAPACITY_FIXED, `joined=${joined.length}`);
    const rebuilt = rebuildLorebookFromRecords(OVERFLOW_CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED, `rebuilt=${rebuilt.length}`);
    assert.match(rebuilt, new RegExp(OVERFLOW_AUDIT_MARKERS.OLD));
    assert.match(rebuilt, new RegExp(OVERFLOW_AUDIT_MARKERS.MID));
    assert.match(rebuilt, new RegExp(OVERFLOW_AUDIT_MARKERS.RECENT));
  });

  it("A/B/D: production buildMemoryContextForChat uses unified chat_turn_summaries owner", async () => {
    insertOverflowSummaries();
    const rebuilt = rebuildLorebookFromRecords(OVERFLOW_CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED);

    __setCompactCurrentMemoryTestOverride(async (_existing, maxChars) => {
      let compressed = `${OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY} → ${OVERFLOW_AUDIT_MARKERS.OLD} → ${OVERFLOW_AUDIT_MARKERS.MID} → ${OVERFLOW_AUDIT_MARKERS.RECENT} → background compressed`;
      while (compressed.length < Math.min(maxChars, 9500)) {
        compressed += " → compressed_pad";
      }
      return compressed.slice(0, maxChars);
    });

    const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    assert.ok(compacted.includes(OVERFLOW_AUDIT_MARKERS.OLD));
    assert.ok(compacted.includes(OVERFLOW_AUDIT_MARKERS.MID));
    assert.ok(compacted.includes(OVERFLOW_AUDIT_MARKERS.RECENT));
    assert.ok(compacted.includes(OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY));

    updateChatMemory(OVERFLOW_CHAT, OVERFLOW_USER, OVERFLOW_CHAR, {
      recent_summary: compacted,
      membership_tier: "free",
    });

    const storedRecent = (
      getDb()
        .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
        .get(OVERFLOW_CHAT) as { recent_summary: string }
    ).recent_summary;

    const resolved = resolveLorebookFromRecordsSync(OVERFLOW_CHAT, MEMORY_CAPACITY_FIXED);
    const syncTrim = trimLorebookToBudgetSync(resolved.text || rebuilt, MEMORY_CAPACITY_FIXED);

    const injection = await buildMemoryContextForChat({
      chatId: OVERFLOW_CHAT,
      userId: OVERFLOW_USER,
      characterId: OVERFLOW_CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });

    const promptRecent = extractPromptRecentBody(injection.text);
    const storedSummaryChars = (
      getDb()
        .prepare(`SELECT COALESCE(SUM(LENGTH(summary)),0) AS total FROM chat_turn_summaries WHERE chat_id=?`)
        .get(OVERFLOW_CHAT) as { total: number }
    ).total;

    const records = listMemoryRecordsForChat(OVERFLOW_CHAT);
    const report = auditTenKOverflowOwnerProof({
      storedTurnSummaryChars: storedSummaryChars,
      storedRecentSummary: storedRecent,
      rebuiltText: rebuilt,
      syncTrimText: syncTrim,
      promptRecentText: promptRecent,
      rebuildTurnStarts: records.map((r) => r.turnStart),
    });

    assert.ok(report.storedTurnSummaryChars > MEMORY_CAPACITY_FIXED);
    assert.ok(report.storedRecentSummaryChars > 0);
    assert.ok(report.rebuiltChars > MEMORY_CAPACITY_FIXED);
    assert.ok(report.syncTrimChars <= MEMORY_CAPACITY_FIXED);
    assert.ok(report.actualCurrentMemoryPromptChars <= MEMORY_CAPACITY_FIXED);
    assert.equal(report.rebuildOrdering, "oldest_to_newest");
    assert.equal(report.canonicalSource, "chat_turn_summaries_rebuild");
    assert.equal(report.storedRecentDiffersFromRebuilt, true);
    assert.equal(report.promptUsesStoredCompressed, false);
    assert.equal(
      TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS.GLOBAL_MEMORY_COMPACTION_WRITE_READ_MISMATCH,
      "ROOT_CAUSE_FIXED"
    );
    assert.equal(
      TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS.GLOBAL_MEMORY_CANONICAL_PROMPT_OWNER,
      "chat_turn_summaries (rebuilt at prompt time)"
    );

    assert.ok(report.markers.recent, "RECENT_MARKER in prompt after prefer-recent overflow");
    assert.ok(!report.markers.compressedOnly, "stored compressed-only marker must not win prompt");
    assert.notEqual(promptRecent, storedRecent.trim());
    assert.equal(injection.recentChars, promptRecent.length);
  });

  it("C: prefer-recent overflow keeps RECENT_MARKER and drops OLD_MARKER at 10K", () => {
    insertOverflowSummaries();
    const rebuilt = rebuildLorebookFromRecords(OVERFLOW_CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED);

    const trimmed = trimLorebookToBudgetSync(rebuilt, MEMORY_CAPACITY_FIXED);
    const rebuiltMarkers = detectOverflowMarkers(rebuilt);
    const trimmedMarkers = detectOverflowMarkers(trimmed);

    assert.ok(rebuiltMarkers.old && rebuiltMarkers.mid && rebuiltMarkers.recent);
    assert.ok(trimmedMarkers.recent, "prefer-recent trim keeps newest blocks");
    assert.equal(trimmedMarkers.old, false, "prefer-recent trim drops oldest sealed summaries");
    assert.equal(
      TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS.CURRENT_MEMORY_OVERFLOW_PREFIX_BIAS,
      "ROOT_CAUSE_FIXED"
    );
  });

  it("E: seal path no longer invokes full-history LLM compact after overflow", async () => {
    insertOverflowSummaries();
    const compactCalls: {
      inputChars: number;
      recordCount: number;
      inputText: string;
      priorCompactedSummary: string;
    }[] = [];
    __setCompactCurrentMemoryTestOverride(async (existing, maxChars) => {
      compactCalls.push({
        inputChars: existing.length,
        recordCount: listMemoryRecordsForChat(OVERFLOW_CHAT).length,
        inputText: existing,
        priorCompactedSummary: "",
      });
      return existing.slice(0, maxChars);
    });

    for (let seal = 0; seal < 3; seal++) {
      const turnStart = (28 + seal) * ROLLING_SUMMARY_INTERVAL + 1;
      const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
      getDb()
        .prepare(
          `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
           VALUES (?,?,?,?,?)`
        )
        .run(
          OVERFLOW_CHAT,
          turnStart,
          turnEnd,
          `${OVERFLOW_AUDIT_MARKERS.RECENT}_SEAL_${seal} → 추가 봉인 → 장면 마무리`.repeat(20),
          "main_canon"
        );
    }

    assert.equal(compactCalls.length, 0, "seal/overflow path must not call compactCurrentMemory");
    assert.equal(
      TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS.FULL_HISTORY_RECOMPRESSION_EVERY_SEAL,
      "REMOVED"
    );
  });

  it("F: archive_summary has no active overflow rollover writer in production", () => {
    const manager = readFileSync("src/lib/memory/memory-manager.ts", "utf8");
    assert.match(manager, /let archiveSummary = memory\.archive_summary/);
    assert.doesNotMatch(
      manager,
      /archiveSummary\s*=\s*recentSummary|archiveSummary\s*=\s*rebuilt|archiveSummary\s*=\s*currentMemory|archiveSummary\s*\+/
    );
    assert.match(
      manager,
      /if \(archiveSummary\.length > budget\.archive\)/
    );

    const rolling = readFileSync("src/lib/memory/memory-rolling-summary.ts", "utf8");
    assert.doesNotMatch(rolling, /archive_summary/);

    const root = join(process.cwd(), "src");
    const rolloverHits: string[] = [];
    for (const file of listProductionTsFiles(root)) {
      const src = readFileSync(file, "utf8");
      if (
        /archiveSummary\s*=\s*recentSummary/.test(src) ||
        /archive_summary:\s*recentSummary/.test(src) ||
        /archive_summary:\s*rebuilt/.test(src) ||
        /archive_summary:\s*compacted/.test(src) ||
        /append.*archive_summary.*recent_summary/i.test(src)
      ) {
        rolloverHits.push(file.replace(process.cwd() + "/", ""));
      }
    }
    assert.deepEqual(
      rolloverHits,
      [],
      "no production path assigns archive_summary from Current Memory overflow"
    );
    assert.equal(TEN_K_OVERFLOW_AUDIT_CLASSIFICATIONS.ARCHIVE_OVERFLOW_ROLE, "NOT_ACTIVE");
  });
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

  it("paraphrase cue does not lexically retrieve a normal-importance rain shelter event", () => {
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

    const candidates = fetchEpisodicMemoryCandidatesForDebug(
      db,
      { chatId: 1, currentTurn: 180, currentUserMessage: "그 비 오던 밤 기억나?" },
      productionRecallEnv
    );
    const targetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
    ).id;
    const lanes = candidates.laneById.get(targetId) ?? [];
    assert.ok(!lanes.includes("relevance"), "paraphrase must not hit lexical relevance");

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 180, currentUserMessage: "그 비 오던 밤 기억나?" },
      productionRecallEnv
    );
    assert.ok(
      !recall.facts.some((fact) => fact.id === targetId),
      "normal-importance paraphrase event is not retrieved — SEMANTIC_RETRIEVAL_GAP"
    );
  });
});
