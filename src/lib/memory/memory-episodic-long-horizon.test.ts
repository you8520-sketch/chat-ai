import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  buildEpisodicCandidateScope,
  classifyEpisodicFactTemporalNature,
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
  reconcileGlobalStateLikeFacts,
  resolveEpisodicLaneBudgets,
  resolveEpisodicMemoryMinAgeTurns,
} from "@/lib/episodicMemoryFacts";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";

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

const recallEnv = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "0",
} as NodeJS.ProcessEnv;

/** Production-parity recall: no minAge override → code default 5. */
const productionRecallEnv = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

/** Old critical milestone at T20 — the starvation victim in long chats. */
const OLD_MILESTONE_T20: ExtractedStatusFact = {
  category: "relationship",
  subject: "user_char",
  attribute: "scene_event",
  value: "first_intimacy_milestone",
  importance: "critical",
  fact_text: "처음으로 둘 사이에 친밀한 관계가 완료되었다.",
  evidence_type: "explicit_scene_event",
};

function insertFillerFacts(db: Database.Database, chatId: number, fromTurn: number, count: number): void {
  const insert = db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (?, ?, 'setting', 'ambient', ?, ?, 'normal', ?, '{}')`
  );
  for (let i = 0; i < count; i++) {
    const turn = fromTurn + i;
    insert.run(
      chatId,
      turn,
      `ambient_detail_${turn}`,
      `detail_${turn}`,
      `T${turn}에서 무관한 배경 디테일이 기록되었다.`
    );
  }
}

function traceRetrievalStages(
  db: Database.Database,
  opts: {
    chatId: number;
    targetId: number;
    currentTurn: number;
    currentUserMessage: string;
  }
) {
  const inDb = db
    .prepare("SELECT id FROM episodic_memory_facts WHERE id = ?")
    .get(opts.targetId) as { id: number } | undefined;

  const candidates = fetchEpisodicMemoryCandidatesForDebug(
    db,
    {
      chatId: opts.chatId,
      currentTurn: opts.currentTurn,
      currentUserMessage: opts.currentUserMessage,
    },
    recallEnv
  );
  const inCandidateSet = candidates.rows.some((row) => row.id === opts.targetId);

  const recall = getEpisodicMemoryForPrompt(
    db,
    {
      chatId: opts.chatId,
      currentTurn: opts.currentTurn,
      currentUserMessage: opts.currentUserMessage,
    },
    recallEnv
  );
  const debug = recall.debug.find((row) => row.id === opts.targetId);
  const inFinalPrompt = recall.facts.some((row) => row.id === opts.targetId);

  return {
    IN_DB: Boolean(inDb),
    IN_SQL_CANDIDATE_SET: inCandidateSet,
    PASSED_VALIDATION: debug != null && debug.blocked_reason == null,
    PASSED_CONTAMINATION_GUARD: debug?.blocked_reason !== "status_or_countdown_mechanic",
    PASSED_TEMPORAL_GUARD: debug?.blocked_reason !== "clearly_temporary",
    PASSED_OWNERSHIP_GUARD:
      debug?.blocked_reason !== "relationship_ledger_promise" &&
      debug?.blocked_reason !== "relationship_ledger_item",
    PASSED_DEDUPE: debug?.duplicate_reason == null,
    RANK: debug?.final_rank ?? null,
    IN_FINAL_PROMPT: inFinalPrompt,
    lanes: candidates.laneById.get(opts.targetId) ?? [],
    stats: candidates.stats,
  };
}

describe("LONG_HORIZON candidate starvation reproduction", () => {
  for (const currentTurn of [120, 300, 1000, 2000]) {
    it(`T20 milestone reachable at currentTurn=${currentTurn} with 100+ newer rows`, () => {
      const db = createDb();
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        sourceTurn: 20,
        facts: [OLD_MILESTONE_T20],
        metadata: { memory_evidence_type: "explicit_scene_event" },
      });
      insertFillerFacts(db, 1, 21, currentTurn - 20);

      const targetId = (
        db
          .prepare("SELECT id FROM episodic_memory_facts WHERE source_turn = 20")
          .get() as { id: number }
      ).id;

      const stages = traceRetrievalStages(db, {
        chatId: 1,
        targetId,
        currentTurn,
        currentUserMessage: "우리 관계의 시작점, 그 첫 밤 이야기해줘",
      });

      assert.equal(stages.IN_DB, true, "fixture row exists");
      assert.equal(
        stages.IN_SQL_CANDIDATE_SET,
        true,
        `T20 must enter candidate set at T${currentTurn} (was starved by recent-only LIMIT 100)`
      );
      assert.equal(stages.PASSED_VALIDATION, true);
      assert.equal(stages.IN_FINAL_PROMPT, true, `T20 milestone must reach final prompt at T${currentTurn}`);
      assert.ok(
        stages.lanes.includes("milestone_critical") ||
          stages.lanes.includes("milestone_important") ||
          stages.lanes.includes("relevance"),
        "recovered via milestone or relevance lane"
      );
    });
  }

  it("proves pre-fix starvation class: old fact excluded when only recent lane would apply", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [OLD_MILESTONE_T20],
    });
    insertFillerFacts(db, 1, 21, 110);

    const recentOnly = db
      .prepare(
        `SELECT id FROM episodic_memory_facts WHERE chat_id=1 ORDER BY source_turn DESC, id DESC LIMIT 100`
      )
      .all() as Array<{ id: number }>;
    const targetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
    ).id;

    assert.ok(
      !recentOnly.some((row) => row.id === targetId),
      "ROOT_CAUSE: T20 is outside recent-only ORDER BY source_turn DESC LIMIT 100"
    );
  });
});

describe("FIRST-TIME RESET continuity fixture", () => {
  it("old pre-reset milestone stays excluded; post-reset milestone is retrievable", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO chat_memories (chat_id, memory_reset_after_message_id, memory_epoch)
       VALUES (1, 50, 1)`
    ).run();

    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 10, 10, 'relationship', 'user_char', 'scene_event', 'pre_reset_milestone', 'critical',
               '리셋 이전 첫 친밀 행위가 완료되었다.', '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 80, 80, 'relationship', 'user_char', 'scene_event', 'post_reset_milestone', 'critical',
               '리셋 이후 처음으로 친밀 행위가 완료되었다.', '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run();
    insertFillerFacts(db, 1, 81, 50);

    const preResetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE value='pre_reset_milestone'").get() as {
        id: number;
      }
    ).id;
    const postResetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE value='post_reset_milestone'").get() as {
        id: number;
      }
    ).id;

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 140,
        currentUserMessage: "리셋 이후 처음으로 친밀 행위가 완료된 그날 기억나?",
      },
      recallEnv
    );

    assert.ok(!recall.facts.some((f) => f.id === preResetId), "stale pre-reset row must not resurrect");
    assert.ok(recall.facts.some((f) => f.id === postResetId), "post-reset milestone must be retrievable");
    assert.match(recall.promptBlock, /리셋 이후/);
  });
});

describe("ROLE DIRECTION continuity fixture", () => {
  const ROLE_EVENT_T10: ExtractedStatusFact = {
    category: "relationship",
    subject: "char_a_char_b",
    attribute: "scene_event",
    value: "a_receptive_b_insertive",
    importance: "important",
    fact_text: "그 장면에서 A는 받는 역할로, B는 주도하는 역할로 친밀 행위가 완료되었다.",
    evidence_type: "explicit_scene_event",
  };

  it("preserves directional semantics for old scene_event at long horizon", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 10,
      facts: [ROLE_EVENT_T10],
    });
    insertFillerFacts(db, 1, 11, 150);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 170,
        currentUserMessage: "그때 A는 받는 역할이었지?",
      },
      recallEnv
    );

    assert.match(recall.promptBlock, /A는 받는 역할/);
    assert.match(recall.promptBlock, /B는 주도하는 역할/);
    assert.doesNotMatch(recall.promptBlock, /A는 주도하는 역할/);
  });
});

describe("FABRICATED PAST negative fixture", () => {
  it("does not inject synthetic episodic memory when none exists", () => {
    const db = createDb();
    insertFillerFacts(db, 1, 1, 120);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 130,
        currentUserMessage: "우리 처음으로 친밀했던 그날 기억해?",
      },
      recallEnv
    );

    assert.ok(
      !recall.facts.some((f) => /친밀|처음으로 둘/.test(f.fact_text)),
      "must not fabricate or recall a nonexistent intimacy milestone"
    );
  });
});

function insertDrinkPreferenceFixture(db: Database.Database): { t20Id: number; t140Id: number } {
  db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, 20, 'preference', 'user', 'favorite_drink', 'syrup_coffee', 'important',
             '사용자는 커피에 시럽을 넣어 마신다.', '{}')`
  ).run();
  db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, 140, 'preference', 'user', 'favorite_drink', 'black_coffee', 'normal',
             '사용자는 블랙 커피만 마신다.', '{}')`
  ).run();
  insertFillerFacts(db, 1, 21, 119);
  insertFillerFacts(db, 1, 141, 140);
  const t20Id = (
    db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
  ).id;
  const t140Id = (
    db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=140").get() as { id: number }
  ).id;
  return { t20Id, t140Id };
}

describe("STATE_RECONCILIATION guard closure", () => {
  it("blocked latest T140 is not injected and stale T20 is not used as fallback", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'preference', 'user', 'favorite_drink', 'syrup_coffee', 'important',
               '사용자는 커피에 시럽을 넣어 마신다.', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 140, 'preference', 'user', 'favorite_drink', 'awakening_in_progress', 'normal',
               '렌의 각성은 현재 진행 중이다.', '{}')`
    ).run();
    insertFillerFacts(db, 1, 21, 119);
    insertFillerFacts(db, 1, 141, 140);

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 300, currentUserMessage: "커피" },
      recallEnv
    );

    assert.doesNotMatch(recall.promptBlock, /각성은 현재 진행/);
    assert.doesNotMatch(recall.promptBlock, /시럽을 넣어/);
    assert.ok(
      !recall.facts.some((f) => f.attribute === "favorite_drink"),
      "logical key omitted when latest canonical row fails guards"
    );
  });
});

describe("BLOCKED-LATEST no-fallback", () => {
  it("drops logical key when latest is guard-blocked even if older row was valid", () => {
    const db = createDb();
    const { t20Id, t140Id } = insertDrinkPreferenceFixture(db);
    db.prepare(
      `UPDATE episodic_memory_facts SET fact_text='렌의 각성은 현재 진행 중이다.', value='awakening_in_progress'
       WHERE id=?`
    ).run(t140Id);

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 300, currentUserMessage: "커피" },
      recallEnv
    );

    assert.ok(!recall.facts.some((f) => f.id === t20Id), "must not fall back to older T20");
    assert.ok(!recall.facts.some((f) => f.id === t140Id), "blocked latest must not inject");
    assert.doesNotMatch(recall.promptBlock, /시럽|각성|블랙/);
  });
});

describe("STATE reconcile query bound", () => {
  it("single key with 500 versions returns at most 1 row per lookup", () => {
    const db = createDb();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, ?, 'preference', 'user', 'favorite_drink', ?, 'normal', ?, '{}')`
    );
    for (let turn = 1; turn <= 500; turn++) {
      insert.run(turn, `v${turn}`, `사용자는 음료 선호 버전 ${turn}번을 꾸준히 마셨다.`);
    }

    const scope = buildEpisodicCandidateScope(
      db,
      { chatId: 1, currentTurn: 510 },
      recallEnv
    );
    assert.ok(scope);
    const candidate = db
      .prepare(
        "SELECT * FROM episodic_memory_facts WHERE source_turn=20 AND chat_id=1"
      )
      .get() as { id: number; category: string; subject: string; attribute: string };

    const { stats } = reconcileGlobalStateLikeFacts(db, scope!, [
      {
        ...candidate,
        chat_id: 1,
        character_id: null,
        user_id: null,
        source_user_message_id: null,
        importance: "important",
        metadata: "{}",
        created_at: "",
        fact_text: "사용자는 음료 선호 버전 20번을 꾸준히 마셨다.",
        value: "v20",
      },
    ]);

    assert.equal(stats.rowsFetched, 1);
    assert.equal(stats.queryCount, 1);
    assert.equal(stats.keysReconciled, 1);
  });
});

describe("candidateLimit lane budget safety", () => {
  const spotLimits = [1, 2, 3, 4, 5, 10, 100, 500];

  for (const limit of spotLimits) {
    it(`candidateLimit=${limit}: non-negative lane budgets sum <= limit`, () => {
      const budgets = resolveEpisodicLaneBudgets(limit);
      assert.ok(budgets.recent >= 0);
      assert.ok(budgets.relevance >= 0);
      assert.ok(budgets.milestoneCritical >= 0);
      assert.ok(budgets.milestoneImportant >= 0);
      assert.ok(budgets.milestoneCriticalFetch >= 0);
      assert.ok(budgets.milestoneImportantFetch >= 0);
      const sum = budgets.recent + budgets.relevance + budgets.milestoneCritical + budgets.milestoneImportant;
      assert.ok(sum <= limit, `sum ${sum} <= ${limit}`);
      if (limit >= 1) assert.ok(budgets.recent >= 1, "limit>=1 funds recent lane");
    });
  }

  it("property: all candidateLimit 1..500 stay safe", () => {
    for (let limit = 1; limit <= 500; limit++) {
      const budgets = resolveEpisodicLaneBudgets(limit);
      const sum =
        budgets.recent + budgets.relevance + budgets.milestoneCritical + budgets.milestoneImportant;
      assert.ok(budgets.recent >= 0);
      assert.ok(budgets.relevance >= 0);
      assert.ok(budgets.milestoneCritical >= 0);
      assert.ok(budgets.milestoneImportant >= 0);
      assert.ok(sum <= limit);
    }
  });
});

describe("candidateLimit=1 bounded recent lane", () => {
  it("returns exactly one recent row from hundreds in DB", () => {
    const db = createDb();
    insertFillerFacts(db, 1, 1, 400);

    const { rows, stats } = fetchEpisodicMemoryCandidatesForDebug(
      db,
      { chatId: 1, currentTurn: 410, candidateLimit: 1 },
      recallEnv
    );

    assert.equal(stats.laneCounts.recent, 1);
    assert.ok(rows.length <= 1);
    assert.equal(rows.length, 1);
  });
});

describe("STATE reconcile key cap", () => {
  it("drops unreconciled state keys beyond max key cap", () => {
    const db = createDb();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, ?, 'preference', ?, 'favorite_drink', ?, 'important', ?, '{}')`
    );
    const candidates = [];
    for (let i = 1; i <= 30; i++) {
      insert.run(i, `user_${i}`, `drink_${i}`, `사용자 ${i}는 음료 ${i}번을 꾸준히 좋아한다.`);
      candidates.push(
        db.prepare("SELECT * FROM episodic_memory_facts WHERE source_turn=?").get(i)
      );
    }

    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 40 }, recallEnv);
    assert.ok(scope);
    const { rows, stats } = reconcileGlobalStateLikeFacts(
      db,
      scope!,
      candidates as never[]
    );

    assert.equal(stats.keysDiscovered, 30);
    assert.ok(stats.keysDroppedDueToCap >= 5);
    assert.ok(stats.keysReconciled <= 25);
    assert.ok(
      !rows.some((r) => r.subject === "user_30"),
      "unreconciled stale state key must not pass through"
    );
  });
});

describe("STALE STATE resurrection — indirect query", () => {
  it("must not inject T20 syrup as current truth when T140 black exists (message: 뭐 마실래?)", () => {
    const db = createDb();
    const { t20Id, t140Id } = insertDrinkPreferenceFixture(db);

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 300, currentUserMessage: "뭐 마실래?" },
      recallEnv
    );

    const injectedT20 = recall.facts.some((f) => f.id === t20Id);
    const injectedT140 = recall.facts.some((f) => f.id === t140Id);

    assert.ok(
      !injectedT20 || injectedT140,
      "STALE_STATE_RESURRECTION: T20 syrup must not appear without T140 black"
    );
    assert.doesNotMatch(recall.promptBlock, /시럽을 넣어/);
  });
});

describe("OLD-VALUE relevance trap", () => {
  it("keyword 시럽 must not let obsolete T20 beat canonical T140 for same logical key", () => {
    const db = createDb();
    const { t20Id, t140Id } = insertDrinkPreferenceFixture(db);

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 300, currentUserMessage: "시럽" },
      recallEnv
    );

    const injectedT20 = recall.facts.some((f) => f.id === t20Id);
    const injectedT140 = recall.facts.some((f) => f.id === t140Id);

    assert.ok(
      !injectedT20 || injectedT140,
      "obsolete T20 must not win relevance trap without latest T140"
    );
    if (injectedT140) {
      assert.match(recall.promptBlock, /블랙 커피/);
    }
  });
});

describe("CRITICAL vs IMPORTANT milestone priority", () => {
  it("T21 critical historical event survives 20 older important milestones", () => {
    const db = createDb();
    for (let turn = 1; turn <= 20; turn++) {
      db.prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (1, ?, 'relationship', 'user_char', 'scene_event', ?, 'important',
                 ?, '{"memory_evidence_type":"explicit_scene_event"}')`
      ).run(
        turn,
        `important_event_${turn}`,
        `T${turn}에서 중요한 역사적 사건 ${turn}이 완료되었다.`
      );
    }
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 21, 'relationship', 'user_char', 'scene_event', 'critical_turning_point', 'critical',
               'T21에서 결정적인 전환점 사건이 완료되었다.', '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run();
    insertFillerFacts(db, 1, 22, 150);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 180,
        currentUserMessage: "요즘 날씨 어때?",
      },
      recallEnv
    );

    assert.ok(
      recall.facts.some((f) => f.source_turn === 21 && f.value === "critical_turning_point"),
      "T21 critical milestone must reach final prompt despite 20 older important events"
    );
  });
});

describe("lane cap arbitration — no insertion-order ranking", () => {
  it("merged candidates include milestone rows even when recent lane is full", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 5,
      facts: [OLD_MILESTONE_T20],
    });
    insertFillerFacts(db, 1, 6, 200);

    const { rows, laneById, stats } = fetchEpisodicMemoryCandidatesForDebug(
      db,
      { chatId: 1, currentTurn: 210, currentUserMessage: "우리 첫 밤" },
      recallEnv
    );

    const milestoneId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=5").get() as { id: number }
    ).id;

    assert.ok(rows.some((r) => r.id === milestoneId), "milestone row must survive merge without lane-order cap drop");
    const milestoneLanes = laneById.get(milestoneId) ?? [];
    assert.ok(
      milestoneLanes.includes("milestone_critical") ||
        milestoneLanes.includes("milestone_important"),
      "T5 milestone provenance preserved"
    );
    assert.ok(stats.mergedCandidateCount <= 100, "merged cap respected");
    const laneSum =
      stats.laneCounts.recent +
      stats.laneCounts.relevance +
      stats.laneCounts.milestone_critical +
      stats.laneCounts.milestone_important;
    assert.ok(laneSum <= 100, "lane budgets sum within candidateLimit");
  });
});

describe("state-like latest-wins at long horizon", () => {
  it("newer state overrides older keyword-relevant state", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'preference', 'user', 'favorite_drink', 'syrup_coffee', 'important',
               '사용자는 커피에 시럽을 두 번 넣어 마신다.', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 140, 'preference', 'user', 'favorite_drink', 'black_coffee', 'important',
               '사용자는 블랙 커피만 마신다.', '{}')`
    ).run();
    insertFillerFacts(db, 1, 21, 119);
    insertFillerFacts(db, 1, 141, 20);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 170,
        currentUserMessage: "커피 취향이 어땠지?",
      },
      recallEnv
    );

    assert.match(recall.promptBlock, /블랙 커피/);
    assert.doesNotMatch(recall.promptBlock, /시럽을 두 번/);
  });
});

describe("duplicate owner safety", () => {
  it("skips episodic duplicate when fact already in recent RAW", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [OLD_MILESTONE_T20],
    });
    insertFillerFacts(db, 1, 21, 110);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 140,
        currentUserMessage: "우리 첫 밤 이야기해줘",
        recentChatText: "처음으로 둘 사이에 친밀한 관계가 완료되었다.",
      },
      recallEnv
    );

    const milestoneDebug = recall.debug.find((row) => row.source_turn === 20);
    assert.equal(milestoneDebug?.duplicate_reason, "duplicate_recent_chat");
    assert.ok(
      !recall.facts.some((f) => f.source_turn === 20),
      "T20 milestone must not inject when already in recent RAW"
    );
  });
});

describe("reset / regen stale-memory safety", () => {
  it("does not resurrect facts tied to deleted assistant source after regen cleanup", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 20, 'relationship', 'user_char', 'scene_event', 'regen_deleted', 'critical',
               '재생성으로 삭제된 변형의 사건.', '{"assistant_message_id":999}')`
    ).run();
    db.prepare("DELETE FROM episodic_memory_facts WHERE json_extract(metadata,'$.assistant_message_id')=999").run();
    insertFillerFacts(db, 1, 21, 110);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 140,
        currentUserMessage: "재생성으로 삭제된 변형",
      },
      recallEnv
    );

    assert.ok(
      !recall.facts.some((f) => f.value === "regen_deleted"),
      "deleted regen source must not resurrect"
    );
  });
});

describe("performance benchmark — bounded multi-lane retrieval", () => {
  const sizes = [100, 300, 1000, 2000];

  function explainRecentPlan(db: Database.Database): string {
    return (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT id FROM episodic_memory_facts
           WHERE chat_id=1 ORDER BY source_turn DESC, id DESC LIMIT 55`
        )
        .all() as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(" | ");
  }

  for (const size of sizes) {
    it(`size≈${size}: query count, timing, and merged candidates stay bounded`, () => {
      const db = createDb();
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        sourceTurn: 20,
        facts: [OLD_MILESTONE_T20],
      });
      insertFillerFacts(db, 1, 21, size - 20);

      const candidateStart = performance.now();
      const { stats } = fetchEpisodicMemoryCandidatesForDebug(
        db,
        {
          chatId: 1,
          currentTurn: size + 5,
          currentUserMessage: "우리 첫 밤 기억나",
        },
        recallEnv
      );
      const candidateMs = performance.now() - candidateStart;

      const recallStart = performance.now();
      const recall = getEpisodicMemoryForPrompt(
        db,
        {
          chatId: 1,
          currentTurn: size + 5,
          currentUserMessage: "우리 첫 밤 기억나",
        },
        recallEnv
      );
      const recallMs = performance.now() - recallStart;

      const recentPlan = explainRecentPlan(db);

      assert.ok(stats.queryCount <= 4, `query count bounded (got ${stats.queryCount})`);
      assert.ok(stats.mergedCandidateCount <= 100, "merged candidates capped at 100");
      assert.ok(recall.facts.length <= 8, "final facts capped at 8");
      assert.ok(recall.promptBlock.length <= 2000, "prompt block stays within practical budget");
      assert.ok(candidateMs < 5000, `candidate fetch ${candidateMs.toFixed(1)}ms`);
      assert.ok(recallMs < 5000, `full recall ${recallMs.toFixed(1)}ms`);
      assert.match(recentPlan, /idx_episodic_memory_facts_chat_turn|USING INDEX/i);
    });
  }
});

describe("PRODUCTION minAge parity", () => {
  it("default minAge is 5 when env override absent", () => {
    assert.equal(resolveEpisodicMemoryMinAgeTurns(productionRecallEnv), 5);
  });
});

describe("RECENT_RAW_STATE_SHADOWING — production minAge=5", () => {
  it("T20 syrup must not inject when T299 black owns RAW window at currentTurn=301", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'preference', 'user', 'favorite_drink', 'syrup_coffee', 'important',
               '사용자는 커피에 시럽을 넣어 마신다.', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 299, 'preference', 'user', 'favorite_drink', 'black_coffee', 'normal',
               '사용자는 블랙 커피만 마신다.', '{}')`
    ).run();
    insertFillerFacts(db, 1, 21, 278);
    insertFillerFacts(db, 1, 300, 1);

    const t20Id = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
    ).id;
    const t299Id = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=299").get() as { id: number }
    ).id;

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 301, currentUserMessage: "커피" },
      productionRecallEnv
    );

    assert.ok(!recall.facts.some((f) => f.id === t20Id), "T20 syrup must not inject via relevance");
    assert.ok(!recall.facts.some((f) => f.id === t299Id), "T299 black must not inject via episodic");
    assert.ok(
      !recall.facts.some((f) => f.attribute === "favorite_drink"),
      "logical key omitted — RAW owns recent canonical state"
    );
    assert.doesNotMatch(recall.promptBlock, /시럽|블랙/);
  });
});

describe("RAW-window blocked-latest safety — production minAge=5", () => {
  it("guard-blocked newer row in RAW window prevents older stale resurrection", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'preference', 'user', 'favorite_drink', 'syrup_coffee', 'important',
               '사용자는 커피에 시럽을 넣어 마신다.', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 299, 'preference', 'user', 'favorite_drink', 'awakening_in_progress', 'normal',
               '렌의 각성은 현재 진행 중이다.', '{}')`
    ).run();
    insertFillerFacts(db, 1, 21, 278);
    insertFillerFacts(db, 1, 300, 1);

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 301, currentUserMessage: "커피" },
      productionRecallEnv
    );

    assert.doesNotMatch(recall.promptBlock, /시럽|각성/);
    assert.ok(
      !recall.facts.some((f) => f.attribute === "favorite_drink"),
      "newer canonical row in RAW window blocks older candidate even when guard-blocked"
    );
  });
});

describe("RESET + RAW-window freshness — production minAge=5", () => {
  it("pre-reset state cannot suppress post-reset current state inside RAW window", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO chat_memories (chat_id, memory_reset_after_message_id, memory_epoch)
       VALUES (1, 50, 1)`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 10, 10, 'preference', 'user', 'favorite_drink', 'pre_reset_drink', 'important',
               '리셋 이전 음료 선호.', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 295, 295, 'preference', 'user', 'favorite_drink', 'post_reset_drink', 'normal',
               '리셋 이후 블랙 커피 선호.', '{}')`
    ).run();
    insertFillerFacts(db, 1, 296, 4);

    const preResetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE value='pre_reset_drink'").get() as {
        id: number;
      }
    ).id;

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 301, currentUserMessage: "음료" },
      productionRecallEnv
    );

    assert.ok(!recall.facts.some((f) => f.id === preResetId), "pre-reset row must not resurrect");
    assert.ok(
      !recall.facts.some((f) => f.attribute === "favorite_drink"),
      "post-reset RAW-owned state must not inject via episodic either"
    );
  });
});

/** Exact classifier probe — canonical owner must recognize completed mission abort. */
const QUEST_ABORT_CLASSIFIER_ROW = {
  category: "quest",
  subject: "mission",
  attribute: "mission_status",
  value: "aborted",
  importance: "critical" as const,
  fact_text: "임무를 중단했다.",
};

/** Persisted fixture text — schema-valid (≥10 Hangul) while preserving abort semantics. */
const QUEST_ABORT_FIXTURE_TEXT = "작전 도중에 임무를 중단했다.";

describe("MILESTONE SQL semantic owner conflict", () => {
  it("canonical classifier marks quest mission abort as historical_event", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature(QUEST_ABORT_CLASSIFIER_ROW),
      "historical_event"
    );
  });

  it("quest historical_event reaches milestone lane without category SQL exclusion", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'quest', 'mission', 'mission_status', 'aborted', 'critical',
               ?, '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run(QUEST_ABORT_FIXTURE_TEXT);
    insertFillerFacts(db, 1, 21, 150);

    const targetId = (
      db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn=20").get() as { id: number }
    ).id;

    const candidates = fetchEpisodicMemoryCandidatesForDebug(
      db,
      {
        chatId: 1,
        currentTurn: 180,
        currentUserMessage: "요즘 날씨 어때?",
      },
      recallEnv
    );
    const milestoneLanes = candidates.laneById.get(targetId) ?? [];
    assert.ok(
      milestoneLanes.includes("milestone_critical"),
      "MILESTONE_SQL_SEMANTIC_OWNER_CONFLICT: quest category must not block milestone SQL fetch"
    );

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 180,
        currentUserMessage: "요즘 날씨 어때?",
      },
      recallEnv
    );
    assert.ok(
      recall.facts.some((f) => f.id === targetId),
      "quest historical_event must reach final prompt via milestone lane"
    );
    assert.match(recall.promptBlock, /임무를 중단/);
  });
});

describe("UNKNOWN-ATTRIBUTE historical recall", () => {
  it("mission_status attribute outside COMPLETED_SCENE_EVENT_ATTRIBUTES still recalls when classifier says historical_event", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 20, 'quest', 'mission', 'mission_status', 'aborted', 'critical',
               ?, '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run(QUEST_ABORT_FIXTURE_TEXT);
    insertFillerFacts(db, 1, 21, 150);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 180,
        currentUserMessage: "오늘 하루 어땠어?",
      },
      recallEnv
    );

    assert.equal(classifyEpisodicFactTemporalNature(QUEST_ABORT_CLASSIFIER_ROW), "historical_event");
    assert.ok(
      recall.facts.some((f) => f.source_turn === 20 && f.value === "aborted"),
      "unknown-attribute historical row must remain eligible for long-horizon recall"
    );
  });
});

describe("MILESTONE post-filter starvation — nonhistorical-critical crowding", () => {
  it("T21 critical historical scene_event survives 20 critical state-like rows", () => {
    const db = createDb();
    for (let turn = 1; turn <= 20; turn++) {
      db.prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (1, ?, 'preference', 'user', ?, ?, 'critical',
                 ?, '{}')`
      ).run(
        turn,
        `state_key_${turn}`,
        `state_value_${turn}`,
        `T${turn}에서 중요한 상태 선호 ${turn}이 기록되었다.`
      );
    }
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 21, 'relationship', 'user_char', 'scene_event', 'critical_turning_point', 'critical',
               'T21에서 결정적인 전환점 사건이 완료되었다.', '{"memory_evidence_type":"explicit_scene_event"}')`
    ).run();
    insertFillerFacts(db, 1, 22, 150);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 180,
        currentUserMessage: "요즘 날씨 어때?",
      },
      recallEnv
    );

    assert.ok(
      recall.facts.some((f) => f.source_turn === 21 && f.value === "critical_turning_point"),
      "T21 critical historical milestone must remain reachable despite 20 critical state-like rows"
    );
  });
});

function explainStateLookupPlan(
  db: Database.Database,
  scope: NonNullable<ReturnType<typeof buildEpisodicCandidateScope>>
): string {
  return (
    db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM episodic_memory_facts
         WHERE ${scope.baseWhere.join(" AND ")}
           AND category = ? AND subject = ? AND attribute = ?
         ORDER BY source_turn DESC, id DESC
         LIMIT 1`
      )
      .all(...scope.baseParams, "preference", "user", "favorite_drink") as Array<{ detail: string }>
  )
    .map((row) => row.detail)
    .join(" | ");
}

describe("STATE lookup query plan — honest classification", () => {
  it("records EXPLAIN QUERY PLAN for per-key state reconciliation lookup", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 10, 'preference', 'user', 'favorite_drink', 'tea', 'normal', 'tea', '{}')`
    ).run();

    const scope = buildEpisodicCandidateScope(
      db,
      { chatId: 1, currentTurn: 20 },
      productionRecallEnv
    );
    assert.ok(scope);
    const plan = explainStateLookupPlan(db, scope!);
    assert.ok(plan.length > 0, "query plan captured");
    assert.match(plan, /idx_episodic_memory_facts|SEARCH|SCAN/i);
  });
});

describe("STATE lookup stress — bounded result rows", () => {
  it("A: 1 key × 500 versions — result rows bounded, reconciliation fast", () => {
    const db = createDb();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, ?, 'preference', 'user', 'favorite_drink', ?, 'normal', ?, '{}')`
    );
    for (let turn = 1; turn <= 500; turn++) {
      insert.run(turn, `v${turn}`, `version ${turn}`);
    }

    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 510 }, productionRecallEnv);
    assert.ok(scope);
    const candidate = db
      .prepare("SELECT * FROM episodic_memory_facts WHERE source_turn=20 AND chat_id=1")
      .get() as Record<string, unknown>;

    const start = performance.now();
    const { stats } = reconcileGlobalStateLikeFacts(db, scope!, [
      {
        ...candidate,
        chat_id: 1,
        character_id: null,
        user_id: null,
        source_user_message_id: null,
        importance: "important",
        metadata: "{}",
        created_at: "",
        fact_text: "version 20",
        value: "v20",
      },
    ] as never[]);
    const elapsedMs = performance.now() - start;

    assert.equal(stats.rowsFetched, 1, "STATE_RECONCILIATION_RESULT_BOUND = YES");
    assert.equal(stats.queryCount, 1);
    assert.ok(elapsedMs < 5000, `reconciliation ${elapsedMs.toFixed(1)}ms`);
  });

  it("B: latest matching version far behind thousands of unrelated rows", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 5, 'preference', 'user', 'favorite_drink', 'target', 'important', 'target drink', '{}')`
    ).run();
    insertFillerFacts(db, 1, 6, 3000);

    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 3010 }, productionRecallEnv);
    assert.ok(scope);
    const candidate = db
      .prepare("SELECT * FROM episodic_memory_facts WHERE source_turn=5")
      .get() as Record<string, unknown>;

    const recallStart = performance.now();
    const { stats } = reconcileGlobalStateLikeFacts(db, scope!, [candidate] as never[]);
    const recallMs = performance.now() - recallStart;
    const plan = explainStateLookupPlan(db, scope!);

    assert.equal(stats.rowsFetched, 1);
    assert.ok(recallMs < 5000, `reconciliation ${recallMs.toFixed(1)}ms`);
    assert.ok(plan.length > 0);
  });

  it("C: 25 keys × multiple versions — capped reconciliation", () => {
    const db = createDb();
    const insert = db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, ?, 'preference', ?, 'favorite_drink', ?, 'important', ?, '{}')`
    );
    const candidates = [];
    for (let i = 1; i <= 25; i++) {
      for (let v = 0; v < 5; v++) {
        const turn = i * 10 + v;
        insert.run(
          turn,
          `user_${i}`,
          `drink_${i}_v${v}`,
          `사용자 ${i}는 음료 선호 버전 ${turn}번을 꾸준히 마신다.`
        );
      }
      candidates.push(
        db.prepare("SELECT * FROM episodic_memory_facts WHERE subject=? ORDER BY source_turn ASC LIMIT 1").get(
          `user_${i}`
        )
      );
    }

    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 400 }, productionRecallEnv);
    assert.ok(scope);

    const reconcileStart = performance.now();
    const { stats } = reconcileGlobalStateLikeFacts(db, scope!, candidates as never[]);
    const reconcileMs = performance.now() - reconcileStart;

    const recallStart = performance.now();
    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 400, currentUserMessage: "음료" },
      productionRecallEnv
    );
    const recallMs = performance.now() - recallStart;

    assert.equal(stats.keysDiscovered, 25);
    assert.equal(stats.keysReconciled, 25);
    assert.equal(stats.queryCount, 25);
    assert.equal(stats.rowsFetched, 25);
    assert.ok(reconcileMs < 5000);
    assert.ok(recallMs < 5000);
    assert.ok(recall.facts.length <= 8);
  });
});

describe("recent-memory behavior unchanged", () => {
  it("recent important facts still recall without long-gap filler", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 15,
      facts: [
        {
          category: "location",
          subject: "cafe",
          attribute: "meeting_place",
          value: "gangnam",
          importance: "important",
          fact_text: "둘은 강남 카페에서 만났다.",
        },
      ],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 18,
      facts: [
        {
          category: "location",
          subject: "park",
          attribute: "meeting_place",
          value: "hangang",
          importance: "normal",
          fact_text: "한강 공원으로 이동했다.",
        },
      ],
    });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 20, currentUserMessage: "그때 강남 카페였지?" },
      recallEnv
    );

    assert.match(recall.promptBlock, /강남 카페/);
  });
});
