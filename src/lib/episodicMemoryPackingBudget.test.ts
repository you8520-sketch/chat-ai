import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { formatMemoryMetaForPrompt } from "@/lib/chatMemory";
import {
  allocateEpisodicDynamicCharBudget,
  DEFAULT_EPISODIC_DYNAMIC_BUDGET_POLICY,
  EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS,
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  inspectEpisodicMemoryFactsForDebug,
  resolveDynamicMemoryTotalMaxChars,
  resolveEpisodicMemoryMaxChars,
  type EpisodicDynamicBudgetPolicy,
} from "@/lib/episodicMemoryFacts";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { ARCHIVE_CAPACITY_FIXED, MEMORY_CAPACITY_FIXED } from "@/lib/memory/memory-capacity-shared";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/memory/memory-constants";
import { MEDIUM_TERM_BLOCK_COUNT } from "@/lib/memory/memory-medium-term";
import { estimateTokens } from "@/lib/tokenEstimate";

const recallEnv = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

const STORM_FACT = "폭풍우가 몰아치던 밤 두 사람은 동굴에 피신했다.";
const STORM_QUERY = "폭풍우 치던 밤 동굴에 피신한 일을 기억해?";
const IRRELEVANT_QUERY = "오늘 점심으로 무엇을 먹을지 정한다";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  return db;
}

function seedStormFact(db: Database.Database, opts?: { importance?: string; turn?: number }): void {
  db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'setting', 'storm_shelter', 'scene_event', 'cave', ?, ?,
       '{"memory_evidence_type":"explicit_scene_event"}')`
  ).run(opts?.turn ?? 1, opts?.importance ?? "important", STORM_FACT);
}

function recall(
  db: Database.Database,
  opts: {
    query: string;
    higherPriorityChars: number;
    policy?: EpisodicDynamicBudgetPolicy;
    relationshipMemoryText?: string;
    lorebookText?: string;
  }
) {
  const input = {
    chatId: 1,
    currentTurn: 20,
    currentUserMessage: opts.query,
    longTermMemoryText: "x".repeat(opts.higherPriorityChars),
    relationshipMemoryText: opts.relationshipMemoryText ?? "",
    lorebookText: opts.lorebookText ?? "",
    dynamicBudgetPolicy: opts.policy,
  };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, recallEnv);
  const recalled = getEpisodicMemoryForPrompt(db, input, recallEnv);
  return { input, candidates, recalled };
}

describe("allocateEpisodicDynamicCharBudget", () => {
  const total = 2500;
  const maxChars = 1000;

  it("A baseline leftover is 0 when higher-priority text fills the envelope", () => {
    const budget = allocateEpisodicDynamicCharBudget({
      maxChars,
      dynamicMemoryTotalMaxChars: total,
      higherPriorityDynamicChars: total,
      hasRelevancePassCandidates: true,
      policy: "baseline",
    });
    assert.equal(budget.leftoverChars, 0);
    assert.equal(budget.effectiveMaxChars, 0);
    assert.equal(budget.reservedFloorApplied, false);
    assert.equal(budget.higherPriorityCapChars, total);
  });

  it("B reserved floor opens a fact-text slot only when relevance passed", () => {
    const withRelevance = allocateEpisodicDynamicCharBudget({
      maxChars,
      dynamicMemoryTotalMaxChars: total,
      higherPriorityDynamicChars: total + 500,
      hasRelevancePassCandidates: true,
      policy: "reserved_floor",
    });
    assert.equal(withRelevance.leftoverChars, 0);
    assert.equal(withRelevance.effectiveMaxChars, EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS);
    assert.equal(withRelevance.reservedFloorApplied, true);
    assert.equal(withRelevance.higherPriorityCapChars, total);

    const withoutRelevance = allocateEpisodicDynamicCharBudget({
      maxChars,
      dynamicMemoryTotalMaxChars: total,
      higherPriorityDynamicChars: total,
      hasRelevancePassCandidates: false,
      policy: "reserved_floor",
    });
    assert.equal(withoutRelevance.effectiveMaxChars, 0);
    assert.equal(withoutRelevance.reservedFloorApplied, false);
  });

  it("C shared allocator keeps the four leftover layers inside the same total", () => {
    const budget = allocateEpisodicDynamicCharBudget({
      maxChars,
      dynamicMemoryTotalMaxChars: total,
      higherPriorityDynamicChars: total,
      hasRelevancePassCandidates: true,
      policy: "shared_allocator",
    });
    assert.equal(budget.effectiveMaxChars, EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS);
    assert.equal(budget.higherPriorityCapChars, total - EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS);
    assert.equal(budget.effectiveMaxChars + budget.higherPriorityCapChars, total);
  });

  it("production default is reserved_floor and does not raise the published caps", () => {
    assert.equal(DEFAULT_EPISODIC_DYNAMIC_BUDGET_POLICY, "reserved_floor");
    assert.equal(resolveDynamicMemoryTotalMaxChars(recallEnv), 2500);
    assert.equal(resolveEpisodicMemoryMaxChars(recallEnv), 1000);
    assert.ok(EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS < 1000);
    assert.ok(EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS < 2500);
  });

  it("allocator is model-neutral across every Main RP id", () => {
    assert.ok(MAIN_RP_MODEL_IDS.length > 0);
    const budgets = MAIN_RP_MODEL_IDS.map(() =>
      allocateEpisodicDynamicCharBudget({
        maxChars: 1000,
        dynamicMemoryTotalMaxChars: 2500,
        higherPriorityDynamicChars: 2500,
        hasRelevancePassCandidates: true,
      })
    );
    for (const budget of budgets) {
      assert.deepEqual(budget, budgets[0]);
    }
  });
});

describe("PR #1214 starvation fixture on current packing owner", () => {
  const cap = resolveDynamicMemoryTotalMaxChars(recallEnv);

  it("separates candidate discovery success from baseline final-injection failure", () => {
    const db = createDb();
    seedStormFact(db);
    const { candidates, recalled } = recall(db, {
      query: STORM_QUERY,
      higherPriorityChars: cap,
      policy: "baseline",
    });
    assert.equal(candidates.rows.length, 1, "candidate discovery must still find the fact");
    assert.equal(recalled.debug[0]?.relevance_pass, true);
    assert.equal(recalled.facts.length, 0);
    assert.equal(recalled.promptBlock, "");
    assert.equal(recalled.debug[0]?.budget_reason, "dynamic_memory_total_budget");
    db.close();
  });

  it("A starves at cap and above; leftover still injects", () => {
    const rows = [0, cap - 500, cap - 100, cap, cap + 500].map((higherPriorityChars) => {
      const db = createDb();
      seedStormFact(db);
      const { candidates, recalled } = recall(db, {
        query: STORM_QUERY,
        higherPriorityChars,
        policy: "baseline",
      });
      const out = {
        higherPriorityChars,
        candidateCount: candidates.rows.length,
        injectedFacts: recalled.facts.length,
        budgetReason: recalled.debug[0]?.budget_reason ?? null,
        relevancePass: recalled.debug[0]?.relevance_pass ?? false,
      };
      db.close();
      return out;
    });

    assert.deepEqual(
      rows.filter((row) => row.higherPriorityChars < cap).map((row) => row.injectedFacts),
      [1, 1, 1]
    );
    const starved = rows.filter((row) => row.higherPriorityChars >= cap);
    assert.ok(starved.length === 2);
    for (const row of starved) {
      assert.equal(row.candidateCount, 1);
      assert.equal(row.injectedFacts, 0);
      assert.equal(row.relevancePass, true);
      assert.equal(row.budgetReason, "dynamic_memory_total_budget");
    }
  });

  it("B reserved_floor injects the relevance-pass fact when leftover is 0", () => {
    const db = createDb();
    seedStormFact(db);
    const { candidates, recalled } = recall(db, {
      query: STORM_QUERY,
      higherPriorityChars: cap,
      policy: "reserved_floor",
    });
    assert.equal(candidates.rows.length, 1);
    assert.equal(recalled.facts.length, 1);
    assert.match(recalled.promptBlock, /폭풍우가 몰아치던 밤/);
    assert.equal(recalled.debug[0]?.budget_reason, null);
    assert.equal(recalled.debug[0]?.would_inject, true);
    db.close();
  });

  it("production default matches reserved_floor on the starvation fixture", () => {
    const db = createDb();
    seedStormFact(db);
    const def = recall(db, { query: STORM_QUERY, higherPriorityChars: cap });
    const reserved = recall(db, {
      query: STORM_QUERY,
      higherPriorityChars: cap,
      policy: "reserved_floor",
    });
    assert.equal(def.recalled.facts.length, 1);
    assert.equal(reserved.recalled.facts.length, 1);
    assert.equal(def.recalled.promptBlock, reserved.recalled.promptBlock);
    db.close();
  });

  it("irrelevant query does not reserve a floor and stays empty", () => {
    const db = createDb();
    seedStormFact(db, { importance: "critical" });
    const { candidates, recalled } = recall(db, {
      query: IRRELEVANT_QUERY,
      higherPriorityChars: cap,
      policy: "reserved_floor",
    });
    assert.equal(candidates.rows.length, 1, "critical distractor remains discoverable");
    assert.equal(recalled.debug[0]?.relevance_pass, false);
    assert.equal(recalled.facts.length, 0);
    assert.equal(recalled.promptBlock, "");
    db.close();
  });

  it("implicit keyword-less paraphrase without lexical overlap does not reserve", () => {
    const db = createDb();
    seedStormFact(db);
    const { candidates, recalled } = recall(db, {
      query: "그날 밤 비를 피해 숨어 있던 곳이 어디였지?",
      higherPriorityChars: cap,
    });
    assert.equal(candidates.rows.length, 1);
    assert.equal(recalled.debug[0]?.relevance_pass, false);
    assert.equal(recalled.facts.length, 0);
    db.close();
  });

  it("A/B/C comparison keeps C inside the envelope and B bounded", () => {
    const db = createDb();
    seedStormFact(db);
    const arms = (["baseline", "reserved_floor", "shared_allocator"] as const).map((policy) => {
      const { recalled } = recall(db, {
        query: STORM_QUERY,
        higherPriorityChars: cap,
        policy,
      });
      const budget = allocateEpisodicDynamicCharBudget({
        maxChars: resolveEpisodicMemoryMaxChars(recallEnv),
        dynamicMemoryTotalMaxChars: cap,
        higherPriorityDynamicChars: cap,
        hasRelevancePassCandidates: recalled.debug[0]?.relevance_pass === true,
        policy,
      });
      return {
        policy,
        injectedFacts: recalled.facts.length,
        promptTokens: recalled.promptBlock ? estimateTokens(recalled.promptBlock) : 0,
        promptChars: recalled.promptBlock.length,
        leftoverChars: budget.leftoverChars,
        effectiveMaxChars: budget.effectiveMaxChars,
        higherPriorityCapChars: budget.higherPriorityCapChars,
        envelopeChars: budget.higherPriorityCapChars + budget.effectiveMaxChars,
      };
    });
    const baseline = arms.find((arm) => arm.policy === "baseline")!;
    const reserved = arms.find((arm) => arm.policy === "reserved_floor")!;
    const shared = arms.find((arm) => arm.policy === "shared_allocator")!;

    assert.equal(baseline.injectedFacts, 0);
    assert.equal(reserved.injectedFacts, 1);
    assert.equal(shared.injectedFacts, 1);
    assert.equal(shared.envelopeChars, cap);
    assert.ok(reserved.promptChars > 0);
    assert.ok(
      reserved.promptChars < EPISODIC_DYNAMIC_RESERVED_FLOOR_CHARS + 800,
      "floor may add the existing wrapper, not an unbounded section"
    );
    assert.ok(reserved.promptTokens > 0);
    assert.ok(
      reserved.promptTokens < 800,
      "token cost is the existing episodic wrapper plus one fact, not a new section"
    );
    db.close();
  });

  it("inspect debug uses the same packing owner", () => {
    const db = createDb();
    seedStormFact(db);
    const inspected = inspectEpisodicMemoryFactsForDebug(
      db,
      {
        chatId: 1,
        currentTurn: 20,
        currentUserMessage: STORM_QUERY,
        longTermMemoryText: "x".repeat(cap),
        dynamicBudgetPolicy: "baseline",
      },
      recallEnv
    );
    assert.equal(inspected[0]?.relevance_pass, true);
    assert.equal(inspected[0]?.would_inject, false);
    assert.equal(inspected[0]?.budget_reason, "dynamic_memory_total_budget");

    const reserved = inspectEpisodicMemoryFactsForDebug(
      db,
      {
        chatId: 1,
        currentTurn: 20,
        currentUserMessage: STORM_QUERY,
        longTermMemoryText: "x".repeat(cap),
        dynamicBudgetPolicy: "reserved_floor",
      },
      recallEnv
    );
    assert.equal(reserved[0]?.would_inject, true);
    assert.equal(reserved[0]?.budget_reason, null);
    db.close();
  });
});

describe("canonical memory packing owner map", () => {
  it("keeps RAW4 and Medium N15 invariants and documents leftover membership", () => {
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(MEDIUM_TERM_BLOCK_COUNT, 15);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
    assert.equal(ARCHIVE_CAPACITY_FIXED, 3000);

    const facts = readFileSync(join(process.cwd(), "src/lib/episodicMemoryFacts.ts"), "utf8");
    assert.match(
      facts,
      /input\.longTermMemoryText,\s*\n\s*input\.relationshipMemoryText,\s*\n\s*input\.lorebookText/
    );
    assert.doesNotMatch(facts, /mediumTermText/);

    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(
      route,
      /longTermMemoryText: memoryFeatureOn\s*\n\s*\? \[memoryInjection\.text, memoryInjection\.archiveText\]/
    );
    assert.match(route, /relationshipMemoryText: relationshipMemoryForPrompt/);
    assert.match(route, /lorebookText: lorebookTextForEpisodicMemory/);

    const builder = readFileSync(join(process.cwd(), "src/services/contextBuilder.ts"), "utf8");
    const mediumAt = builder.indexOf('pushMediumTermMemory();');
    const currentAt = builder.indexOf("pushCurrentMemory(false);");
    const episodicAt = builder.indexOf("pushEpisodicMemory();");
    const relationshipAt = builder.indexOf("pushRelationshipMeta();");
    const ragAt = builder.indexOf("pushRagContextSections();");
    assert.ok(mediumAt > 0 && currentAt > mediumAt);
    assert.ok(episodicAt > currentAt);
    assert.ok(relationshipAt > episodicAt);
    assert.ok(ragAt > relationshipAt);
  });

  it("measures Global/Relationship semantic overlap without deleting either owner", () => {
    const relationship = formatMemoryMetaForPrompt({
      honorifics: [],
      items: ["준: 은열쇠"],
      thoughts: [],
      promises: [{ text: "다음 만남에 책을 가져온다", deadline: "이번 주말" }],
    });
    assert.ok(relationship);
    const globalNarrative =
      "[현재기억]\n준이 은열쇠를 가지고 있다. 다음 만남에 책을 가져오기로 약속함.";
    const overlapTerms = ["은열쇠", "책", "약속"];
    const overlapHits = overlapTerms.filter(
      (term) => relationship!.includes(term) && globalNarrative.includes(term)
    );
    assert.equal(overlapHits.length, overlapTerms.length);

    const leftoverIfBothInjected = globalNarrative.length + relationship!.length;
    assert.ok(
      leftoverIfBothInjected < 2500,
      "this pair alone does not fill the envelope — overlap is quality/stale risk, not the starvation mechanism"
    );
    assert.ok(
      MEMORY_CAPACITY_FIXED + ARCHIVE_CAPACITY_FIXED > 2500,
      "Global+archive caps can consume the leftover envelope by themselves"
    );
  });
});
