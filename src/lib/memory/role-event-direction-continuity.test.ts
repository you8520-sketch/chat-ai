import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  formatEpisodicMemoryPromptSection,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
  ensureEpisodicMemoryFactsTable,
} from "@/lib/episodicMemoryFacts";
import {
  classifyEpisodicFactTemporalNature,
  COMPLETED_SCENE_EVENT_ATTRIBUTES,
} from "@/lib/episodicMemoryTemporal";
import { buildRollingSummarySystemPrompt } from "@/lib/memory/memory-rolling-summary";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "@/lib/memory/memory-episodic-prompt";
import { HISTORICAL_TRUTH_POLICY_BLOCK } from "@/lib/historicalTruthPolicy";
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

/** REC-01 / REC-02 / REC-09 fixture: directional completed scene event at T10. */
const ROLE_EVENT_T10: ExtractedStatusFact = {
  category: "relationship",
  subject: "char_a_char_b",
  attribute: "scene_event",
  value: "a_receptive_b_insertive",
  importance: "important",
  fact_text: "그 장면에서 A는 받는 역할로, B는 주도하는 역할로 친밀 행위가 완료되었다.",
  evidence_type: "explicit_scene_event",
};

/** REC-02 / REC-09: opposite direction at T20 — both must remain valid history. */
const ROLE_EVENT_T20: ExtractedStatusFact = {
  category: "relationship",
  subject: "char_a_char_b",
  attribute: "scene_event",
  value: "a_insertive_b_receptive",
  importance: "important",
  fact_text: "그 장면에서 A는 주도하는 역할로, B는 받는 역할로 친밀 행위가 완료되었다.",
  evidence_type: "explicit_scene_event",
};

/** REC-15: non-sexual directional event — same preservation principle. */
const DIRECTION_EVENT_T5: ExtractedStatusFact = {
  category: "relationship",
  subject: "char_a_char_b",
  attribute: "scene_event",
  value: "a_instructed_b",
  importance: "important",
  fact_text: "그 장면에서 A가 B에게 구체적인 지시를 내렸고 B가 이를 따랐다.",
  evidence_type: "explicit_scene_event",
};

const DIRECTION_EVENT_T15: ExtractedStatusFact = {
  category: "relationship",
  subject: "char_a_char_b",
  attribute: "scene_event",
  value: "b_instructed_a",
  importance: "important",
  fact_text: "그 장면에서 B가 A에게 구체적인 지시를 내렸고 A가 이를 따랐다.",
  evidence_type: "explicit_scene_event",
};

describe("role-event direction continuity — owner map (static)", () => {
  it("documents canonical owners without duplicate subsystems", () => {
    assert.match(buildRollingSummarySystemPrompt(5), /참가자·행위 방향·역할 방향/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /scene_event/);
    assert.match(HISTORICAL_TRUTH_POLICY_BLOCK, /처음이었다/);
    assert.ok(COMPLETED_SCENE_EVENT_ATTRIBUTES.has("scene_event"));
  });
});

describe("REC-09 latest-key collision — historical events", () => {
  it("preserves both opposite-direction scene events at the same logical key", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 10,
      facts: [ROLE_EVENT_T10],
      metadata: { memory_evidence_type: "explicit_scene_event" },
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [ROLE_EVENT_T20],
      metadata: { memory_evidence_type: "explicit_scene_event" },
    });

    const dbRows = db
      .prepare("SELECT source_turn, value FROM episodic_memory_facts ORDER BY source_turn")
      .all() as Array<{ source_turn: number; value: string }>;
    assert.equal(dbRows.length, 2, "DB CORRECT: both rows persisted");

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 25 },
      recallEnv
    );

    assert.equal(recall.facts.length, 2, "RETRIEVAL CORRECT: both events survive latest-key pass");
    assert.match(recall.promptBlock, /T10/);
    assert.match(recall.promptBlock, /T20/);
    assert.match(recall.promptBlock, /받는 역할/);
    assert.match(recall.promptBlock, /주도하는 역할/);
    assert.match(
      recall.promptBlock,
      /Distinct completed events at different turns are all valid history/
    );
    assert.doesNotMatch(recall.promptBlock, /Do not claim 'the first time'/);
  });

  it("classifies explicit_scene_event scene_event facts as historical_event", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "relationship",
        attribute: "scene_event",
        value: ROLE_EVENT_T10.value,
        fact_text: ROLE_EVENT_T10.fact_text,
        evidence_type: "explicit_scene_event",
      }),
      "historical_event"
    );
  });
});

describe("REC-01 single direction continuity", () => {
  it("preserves single directional event after RAW handoff age", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [ROLE_EVENT_T10],
    });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 10 },
      recallEnv
    );

    assert.match(recall.promptBlock, /T1/);
    assert.match(recall.promptBlock, /A는 받는 역할/);
    assert.match(recall.promptBlock, /B는 주도하는 역할/);
    assert.doesNotMatch(recall.promptBlock, /A는 주도하는 역할로, B는 받는/);
  });
});

describe("REC-02 reversible couple — both directions valid", () => {
  it("keeps T10 and T20 as distinct canonical history", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 10, facts: [ROLE_EVENT_T10] });
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 20, facts: [ROLE_EVENT_T20] });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 25 },
      recallEnv
    );

    const turns = recall.facts.map((f) => f.source_turn).sort((a, b) => a - b);
    assert.deepEqual(turns, [10, 20]);
    assert.match(recall.promptBlock, /a_receptive_b_insertive|받는 역할/);
    assert.match(recall.promptBlock, /a_insertive_b_receptive|주도하는 역할로, B는 받는/);
  });
});

describe("REC-03 last occurrence vs history", () => {
  it("ranks T20 latest while T10 remains in prompt", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 10, facts: [ROLE_EVENT_T10] });
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 20, facts: [ROLE_EVENT_T20] });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 25 },
      recallEnv
    );

    assert.equal(recall.facts[0]?.source_turn, 20, "latest event ranks first in sorted recall");
    assert.ok(recall.facts.some((f) => f.source_turn === 10), "older T10 not rewritten away");
  });
});

describe("REC-04 / REC-14 false-first truth contract", () => {
  it("episodic header is retrieved-event interpretation only (not full truth owner)", () => {
    const block = formatEpisodicMemoryPromptSection([
      {
        id: 1,
        chat_id: 1,
        character_id: null,
        user_id: null,
        source_turn: 4,
        source_user_message_id: null,
        created_at: "now",
        metadata: "{}",
        ...ROLE_EVENT_T10,
      },
    ]);

    assert.match(block, /Distinct completed events at different turns are all valid history/);
    assert.doesNotMatch(block, /Absence of a matching retrieved memory is NOT proof/);
    assert.doesNotMatch(block, /Do not claim 'the first time'/);
    assert.match(HISTORICAL_TRUTH_POLICY_BLOCK, /matching event가 보이지 않는다는 사실만으로/);
  });

  it("empty episodic recall returns no header (miss path needs common owner)", () => {
    assert.equal(formatEpisodicMemoryPromptSection([]), "");
  });
});

describe("REC-07 rolling summary handoff wording", () => {
  it("RS-2 compression rule preserves distinct actor/direction events", () => {
    const prompt = buildRollingSummarySystemPrompt(5);
    assert.match(prompt, /참가자·행위 방향·역할 방향이 사건 의미를 바꾸면/);
    assert.match(prompt, /참가자 역할·방향이 다른 사건은 중복이 아니다/);
    assert.doesNotMatch(
      prompt,
      /같은 관계 역학의 반복은 최초 또는 가장 강한 전환점 한 번만 보존/
    );
    assert.match(prompt, /공수 포지션/);
  });
});

describe("REC-08 episodic extraction handoff semantics", () => {
  it("allows generic completed scene_event without dominance inference", () => {
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /a_led_b_followed/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /dominance/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Do NOT infer persistent personality/);
  });
});

describe("REC-15 general nonsexual direction event", () => {
  it("preserves both instruction-direction events at same logical key", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 5, facts: [DIRECTION_EVENT_T5] });
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 15, facts: [DIRECTION_EVENT_T15] });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 20 },
      recallEnv
    );

    assert.equal(recall.facts.length, 2);
    assert.match(recall.promptBlock, /A가 B에게 구체적인 지시/);
    assert.match(recall.promptBlock, /B가 A에게 구체적인 지시/);
  });
});

/** REC-20: same turn, same logical key, different direction/value. */
const SAME_TURN_A_TO_B: ExtractedStatusFact = {
  category: "relationship",
  subject: "a_b",
  attribute: "scene_event",
  value: "a_to_b",
  importance: "important",
  fact_text: "그 장면에서 A가 B에게 주도적으로 다가갔다.",
  evidence_type: "explicit_scene_event",
};

const SAME_TURN_B_TO_A: ExtractedStatusFact = {
  category: "relationship",
  subject: "a_b",
  attribute: "scene_event",
  value: "b_to_a",
  importance: "important",
  fact_text: "그 장면에서 B가 A에게 주도적으로 다가갔다.",
  evidence_type: "explicit_scene_event",
};

describe("REC-20 same-turn distinct historical events", () => {
  it("preserves both distinct scene_event values at the same source turn", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [SAME_TURN_A_TO_B, SAME_TURN_B_TO_A],
    });

    const dbRows = db
      .prepare("SELECT value FROM episodic_memory_facts WHERE source_turn = 20 ORDER BY id")
      .all() as Array<{ value: string }>;
    assert.equal(dbRows.length, 2, "DB CORRECT: both rows persisted");

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 25 },
      recallEnv
    );

    assert.equal(recall.facts.length, 2, "RETRIEVAL CORRECT: no same-turn collapse");
    assert.match(recall.promptBlock, /A가 B에게 주도적으로/);
    assert.match(recall.promptBlock, /B가 A에게 주도적으로/);
  });
});

describe("REC-21 same-turn exact duplicate control", () => {
  it("persist dedupe prevents exact duplicate multiplication", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [SAME_TURN_A_TO_B, SAME_TURN_A_TO_B],
    });

    assert.equal(inserted, 1);
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE source_turn = 20")
      .get() as { c: number };
    assert.equal(count.c, 1);
  });
});

describe("temporal classifier — state vs historical regressions", () => {
  it("preference remains durable; relationship_status past tense stays state-like", () => {
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "preference",
        attribute: "drink_preference",
        value: "tea",
        fact_text: "사용자는 차를 선호한다.",
      }),
      "durable"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "relationship",
        attribute: "relationship_status",
        value: "lovers",
        fact_text: "두 사람은 연인 관계였다.",
      }),
      "unknown"
    );
    assert.equal(
      classifyEpisodicFactTemporalNature({
        category: "character",
        attribute: "emotional_state",
        value: "calm",
        fact_text: "캐릭터는 지금 차분하다.",
      }),
      "clearly_temporary"
    );
  });
});

describe("state latest-wins regression — preference unchanged", () => {
  it("still collapses durable preference to latest turn only", () => {
    const db = createDb();
    const base: ExtractedStatusFact = {
      category: "preference",
      subject: "user",
      attribute: "drink_preference",
      value: "black_coffee",
      importance: "important",
      fact_text: "사용자는 예전에는 블랙커피를 선호했다.",
    };
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 12, facts: [base] });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 84,
      facts: [
        {
          ...base,
          value: "syrup_coffee",
          fact_text: "사용자는 지금은 시럽커피를 선호한다.",
        },
      ],
    });

    const recall = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 85, minAgeTurns: 0 },
      recallEnv
    );

    assert.equal(recall.facts.length, 1);
    assert.match(recall.promptBlock, /T84/);
    assert.doesNotMatch(recall.promptBlock, /T12/);
  });
});
