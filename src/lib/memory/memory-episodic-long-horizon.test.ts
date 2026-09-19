import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
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
        stages.lanes.includes("milestone") || stages.lanes.includes("relevance"),
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

  for (const size of sizes) {
    it(`size≈${size}: query count and merged candidates stay bounded`, () => {
      const db = createDb();
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        sourceTurn: 20,
        facts: [OLD_MILESTONE_T20],
      });
      insertFillerFacts(db, 1, 21, size - 20);

      const { stats } = fetchEpisodicMemoryCandidatesForDebug(
        db,
        {
          chatId: 1,
          currentTurn: size + 5,
          currentUserMessage: "우리 첫 밤 기억나",
        },
        recallEnv
      );

      const recall = getEpisodicMemoryForPrompt(
        db,
        {
          chatId: 1,
          currentTurn: size + 5,
          currentUserMessage: "우리 첫 밤 기억나",
        },
        recallEnv
      );

      assert.ok(stats.queryCount <= 4, `query count bounded (got ${stats.queryCount})`);
      assert.ok(stats.mergedCandidateCount <= 100, "merged candidates capped at 100");
      assert.ok(recall.facts.length <= 8, "final facts capped at 8");
      assert.ok(recall.promptBlock.length <= 2000, "prompt block stays within practical budget");
    });
  }
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
