import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  episodicMemoryDebugApiEnabled,
  episodicMemoryRecallDisabledInProduction,
  episodicMemoryRecallEnabled,
  ensureEpisodicMemoryFactsTable,
  formatEpisodicMemoryPromptSection,
  getEpisodicMemoryForPrompt,
  inspectEpisodicMemoryFactsForDebug,
  listEpisodicMemoryFactsForDebug,
  persistEpisodicMemoryFactsBestEffort,
  warnEpisodicMemoryRecallDisabledInProduction,
} from "@/lib/episodicMemoryFacts";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  return db;
}

const validFact: ExtractedStatusFact = {
  category: "preference",
  subject: "user",
  attribute: "favorite_drink",
  value: "syrup_coffee",
  importance: "important",
  fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
};

const recallOnNoMinAge = {
  NODE_ENV: "development",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "0",
} as NodeJS.ProcessEnv;

describe("persistEpisodicMemoryFactsBestEffort", () => {
  it("saves valid extracted_facts", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 10,
      characterId: 20,
      userId: 30,
      sourceTurn: 4,
      facts: [validFact],
      metadata: { assistant_message_id: 99 },
    });

    assert.equal(inserted, 1);
    const row = db.prepare("SELECT * FROM episodic_memory_facts").get() as {
      chat_id: number;
      character_id: number;
      user_id: number;
      source_turn: number;
      category: string;
      subject: string;
      attribute: string;
      value: string;
      importance: string;
      fact_text: string;
      metadata: string;
    };
    assert.equal(row.chat_id, 10);
    assert.equal(row.character_id, 20);
    assert.equal(row.user_id, 30);
    assert.equal(row.source_turn, 4);
    assert.equal(row.category, "preference");
    assert.equal(row.subject, "user");
    assert.equal(row.attribute, "favorite_drink");
    assert.equal(row.value, "syrup_coffee");
    assert.equal(row.importance, "important");
    assert.equal(row.fact_text, validFact.fact_text);
    assert.equal(JSON.parse(row.metadata).assistant_message_id, 99);
  });

  it("ignores invalid facts", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        {
          ...validFact,
          category: "invalid",
        },
      ] as unknown as ExtractedStatusFact[],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("discards structurally polluted facts", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        { ...validFact, fact_text: "그는 좋다." },
        { ...validFact, value: "x".repeat(81) },
        { ...validFact, fact_text: "짧다." },
        { ...validFact, subject: "User Name" },
        { ...validFact, attribute: "favorite food" },
        { ...validFact, value: "사용자는 커피를 좋아한다." },
        { ...validFact, source_turn: 1 } as unknown as ExtractedStatusFact,
      ],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("rejects facts containing speech register control terms at save time", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        { ...validFact, value: "haeyoche_rule", fact_text: "사용자는 해요체 말투 규칙을 기억해야 한다." },
        { ...validFact, value: "danakka_rule", fact_text: "캐릭터는 다나까체 대사 규칙을 사용해야 한다." },
      ],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("rejects facts containing D-DAY, death date, or countdown mechanics at save time", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        { ...validFact, value: "d_day_zero", fact_text: "캐릭터는 D-DAY가 끝나면 사망일을 맞는다." },
        { ...validFact, value: "countdown", fact_text: "세계에는 죽는 날까지 카운트다운이 표시된다." },
      ],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("rejects facts containing trigger metadata keys at save time", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        { ...validFact, value: "trigger_id", fact_text: "시스템은 trigger_id 조건을 저장해야 한다." },
        { ...validFact, value: "status_key", fact_text: "상태창은 status_key 값을 기준으로 작동한다." },
        { ...validFact, value: "event_key", fact_text: "이벤트는 event_key 값이 맞으면 발생한다." },
      ],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("missing extracted_facts does not crash", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
    });

    assert.equal(inserted, 0);
  });

  it("empty extracted_facts does nothing", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [],
    });

    assert.equal(inserted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 0);
  });

  it("dedupes duplicate facts within the same response by category subject attribute value", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [
        validFact,
        {
          ...validFact,
          fact_text: "사용자는 커피에 시럽을 추가해 마신다.",
        },
      ],
    });

    assert.equal(inserted, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get().c, 1);
  });

  it("DB insert failure does not break chat response path", () => {
    const failingDb = {
      prepare() {
        throw new Error("insert failed");
      },
    } as unknown as Database.Database;

    assert.doesNotThrow(() => {
      const inserted = persistEpisodicMemoryFactsBestEffort(failingDb, {
        chatId: 1,
        sourceTurn: 1,
        facts: [validFact],
      });
      assert.equal(inserted, 0);
    });
  });

  it("regeneration replaces facts for the same source_turn only", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 18,
      userId: 4,
      sourceTurn: 12,
      facts: [validFact],
      metadata: { assistant_message_id: 908, request_id: "req-a", regenerated: false },
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 18,
      userId: 4,
      sourceTurn: 11,
      facts: [
        {
          ...validFact,
          attribute: "other_pref",
          value: "tea",
          fact_text: "사용자는 차를 좋아한다.",
        },
      ],
      metadata: { assistant_message_id: 900, request_id: "req-old" },
    });

    const regenFact: ExtractedStatusFact = {
      ...validFact,
      value: "black_coffee",
      fact_text: "사용자는 블랙커피를 선호한다.",
    };
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 18,
      userId: 4,
      sourceTurn: 12,
      facts: [regenFact],
      replaceSourceTurn: true,
      metadata: {
        assistant_message_id: 908,
        request_id: "req-b",
        regenerated: true,
      },
    });

    assert.equal(inserted, 1);
    const turn12 = db
      .prepare("SELECT value, fact_text FROM episodic_memory_facts WHERE source_turn=12")
      .all() as Array<{ value: string; fact_text: string }>;
    assert.equal(turn12.length, 1);
    assert.equal(turn12[0]!.value, "black_coffee");
    const turn11 = db
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE source_turn=11")
      .get() as { c: number };
    assert.equal(turn11.c, 1);
  });

  it("repeated regeneration does not duplicate rows for the same request", () => {
    const db = createDb();
    const meta = {
      assistant_message_id: 908,
      request_id: "req-regen-1",
      regenerated: true,
    };
    const first = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 18,
      userId: 4,
      sourceTurn: 12,
      facts: [validFact],
      replaceSourceTurn: true,
      metadata: meta,
    });
    const second = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 18,
      userId: 4,
      sourceTurn: 12,
      facts: [validFact],
      replaceSourceTurn: true,
      metadata: meta,
    });
    assert.equal(first, 1);
    assert.equal(second, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts").get() as { c: number }).c,
      1
    );
  });

  it("idempotent finalize with same request_id does not duplicate", () => {
    const db = createDb();
    const meta = { assistant_message_id: 55, request_id: "req-same" };
    assert.equal(
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 2,
        sourceTurn: 3,
        facts: [validFact],
        metadata: meta,
      }),
      1
    );
    assert.equal(
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 2,
        sourceTurn: 3,
        facts: [validFact],
        metadata: meta,
      }),
      0
    );
  });
});

describe("episodicMemoryRecallEnabled production warning", () => {
  it("detects production without EPISODIC_MEMORY_RECALL_ENABLED", () => {
    assert.equal(
      episodicMemoryRecallDisabledInProduction({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      episodicMemoryRecallDisabledInProduction({
        NODE_ENV: "production",
        EPISODIC_MEMORY_RECALL_ENABLED: "1",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      episodicMemoryRecallEnabled({
        NODE_ENV: "production",
        EPISODIC_MEMORY_RECALL_ENABLED: "1",
      } as NodeJS.ProcessEnv),
      true
    );
  });

  it("warnEpisodicMemoryRecallDisabledInProduction returns true when disabled", () => {
    const warned = warnEpisodicMemoryRecallDisabledInProduction({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    assert.equal(warned, true);
  });
});

describe("getEpisodicMemoryForPrompt", () => {
  it("latest fact wins for the same category subject attribute", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 12,
      facts: [{ ...validFact, attribute: "drink_preference", value: "black_coffee", fact_text: "사용자는 예전에는 블랙커피를 선호했다." }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 84,
      facts: [{ ...validFact, attribute: "drink_preference", value: "syrup_coffee", fact_text: "사용자는 지금은 시럽커피를 선호한다." }],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 85,
    }, recallOnNoMinAge);

    assert.match(result.promptBlock, /T84/);
    assert.match(result.promptBlock, /시럽커피/);
    assert.doesNotMatch(result.promptBlock, /T12/);
    assert.doesNotMatch(result.promptBlock, /블랙커피/);
  });

  it("never retrieves facts from other chats", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 2, sourceTurn: 1, facts: [validFact] });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.deepEqual(result.facts, []);
  });

  it("blocks contaminated existing DB facts at recall time", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
       (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      1,
      null,
      null,
      1,
      "setting",
      "world",
      "countdown_rule",
      "d_day",
      "important",
      "세계에는 D-DAY 카운트다운 규칙이 존재한다.",
      "{}"
    );

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.deepEqual(result.facts, []);
  });

  it("clean fact is still saved and recalled", () => {
    const db = createDb();
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [validFact],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, recallOnNoMinAge);

    assert.equal(inserted, 1);
    assert.match(result.promptBlock, /T1/);
    assert.equal(result.facts.length, 1);
  });

  it("episodic fact duplicated in recent raw chat is not injected", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 1, facts: [validFact] });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      recentChatText: validFact.fact_text,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.equal(result.debug[0]?.duplicate_reason, "duplicate_recent_chat");
  });

  it("episodic fact duplicated in long-term memory is not injected", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 1, facts: [validFact] });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      longTermMemoryText: validFact.fact_text,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.equal(result.debug[0]?.duplicate_reason, "duplicate_long_term_memory");
  });

  it("episodic fact duplicated in relationship or lorebook memory is not injected", () => {
    const db = createDb();
    const loreFact = {
      ...validFact,
      attribute: "lore_note",
      value: "guild_rule",
      fact_text: "?ъ슜?먮뒗 길드 규칙을 오래 기억해야 한다.",
    };
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [{ ...validFact, attribute: "relationship_note", value: "close_friend" }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 2,
      facts: [loreFact],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      relationshipMemoryText: validFact.fact_text,
      lorebookText: loreFact.fact_text,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.ok(result.debug.some((fact) => fact.duplicate_reason === "duplicate_relationship_memory"));
    assert.ok(result.debug.some((fact) => fact.duplicate_reason === "duplicate_lorebook"));
  });

  it("missing or empty facts do not crash prompt building", () => {
    const db = createDb();
    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
  });

  it("ranking prefers critical over important over normal", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 10,
      facts: [
        { ...validFact, attribute: "normal_fact", value: "normal_value", importance: "normal", fact_text: "사용자는 평소 차분한 대화를 선호한다." },
        { ...validFact, attribute: "critical_fact", value: "critical_value", importance: "critical", fact_text: "사용자는 안전 규칙을 최우선으로 지켜야 한다." },
        { ...validFact, attribute: "important_fact", value: "important_value", importance: "important", fact_text: "사용자는 커피 취향을 중요하게 여긴다." },
      ],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 11,
    }, recallOnNoMinAge);

    assert.ok(result.promptBlock.indexOf("안전 규칙") < result.promptBlock.indexOf("커피 취향"));
    assert.ok(result.promptBlock.indexOf("커피 취향") < result.promptBlock.indexOf("차분한 대화"));
  });

  it("critical non-duplicated fact is preserved under fact budget pressure", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [{ ...validFact, attribute: "normal_budget_fact", value: "normal_budget", importance: "normal", fact_text: "?ъ슜?먮뒗 일반 예산 기억을 참고해야 한다." }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 2,
      facts: [{ ...validFact, attribute: "critical_budget_fact", value: "critical_budget", importance: "critical", fact_text: "?ъ슜?먮뒗 핵심 예산 기억을 반드시 참고해야 한다." }],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      maxFacts: 1,
    }, recallOnNoMinAge);

    assert.match(result.promptBlock, /핵심 예산/);
    assert.doesNotMatch(result.promptBlock, /일반 예산/);
    assert.equal(result.facts[0]?.importance, "critical");
  });

  it("normal low-priority facts are dropped first under budget pressure", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [{ ...validFact, attribute: "normal_drop_fact", value: "normal_drop", importance: "normal", fact_text: "?ъ슜?먮뒗 보통 예산 기억을 참고해야 한다." }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 2,
      facts: [{ ...validFact, attribute: "important_keep_fact", value: "important_keep", importance: "important", fact_text: "?ъ슜?먮뒗 중요한 예산 기억을 참고해야 한다." }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 3,
      facts: [{ ...validFact, attribute: "critical_keep_fact", value: "critical_keep", importance: "critical", fact_text: "?ъ슜?먮뒗 치명적 예산 기억을 참고해야 한다." }],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      maxFacts: 2,
    }, recallOnNoMinAge);

    assert.match(result.promptBlock, /치명적 예산/);
    assert.match(result.promptBlock, /중요한 예산/);
    assert.doesNotMatch(result.promptBlock, /보통 예산/);
    assert.equal(
      result.debug.find((fact) => fact.value === "normal_drop")?.budget_reason,
      "max_facts"
    );
  });

  it("max 8 facts limit is enforced", () => {
    const db = createDb();
    for (let i = 0; i < 10; i++) {
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        sourceTurn: i + 1,
        facts: [{ ...validFact, attribute: `fact_${i}`, value: `value_${i}`, fact_text: `사용자는 장기 사실 ${i}번을 기억해야 한다.` }],
      });
    }

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 20,
    }, recallOnNoMinAge);

    assert.equal((result.promptBlock.match(/^- \[T/gm) ?? []).length, 8);
  });

  it("max character budget is enforced", () => {
    const db = createDb();
    for (let i = 0; i < 3; i++) {
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        sourceTurn: i + 1,
        facts: [{
          ...validFact,
          attribute: `long_fact_${i}`,
          value: `long_value_${i}`,
          fact_text: `사용자는 매우 긴 장기 기억 ${i}번을 앞으로의 대화에서 안정적으로 참고해야 한다.`,
        }],
      });
    }

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      maxChars: 100,
    }, recallOnNoMinAge);

    assert.ok((result.promptBlock.match(/^- \[T/gm) ?? []).length < 3);
    const totalFactChars = result.facts.reduce((sum, fact) => sum + fact.fact_text.length, 0);
    assert.ok(totalFactChars <= 100);
  });

  it("prompt section is omitted when no facts are available", () => {
    assert.equal(formatEpisodicMemoryPromptSection([]), "");
  });

  it("prompt block is omitted when all facts are skipped as duplicates", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 1, facts: [validFact] });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
      recentChatText: validFact.fact_text,
    }, recallOnNoMinAge);

    assert.equal(result.promptBlock, "");
    assert.deepEqual(result.facts, []);
  });

  it("prompt block format remains stable", () => {
    const block = formatEpisodicMemoryPromptSection([
      {
        id: 1,
        chat_id: 1,
        character_id: null,
        user_id: null,
        source_turn: 84,
        created_at: "now",
        metadata: "{}",
        ...validFact,
        fact_text: "사용자는 앞으로 반말을 원한다.",
      },
    ]);

    assert.match(block, /^\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(block, /historical or durable facts from earlier turns/);
    assert.match(block, /Do not treat time-sensitive facts as the current state/);
    assert.match(block, /prefer the recent raw conversation/);
    assert.match(block, /Do not mention this memory section to the user\./);
    assert.match(block, /^- \[T84\] 사용자는 앞으로 반말을 원한다\.$/m);
  });

  it("skips whole facts instead of truncating fact_text when over char budget", () => {
    const longText = "사용자는 매우 긴 장기 기억 문장을 안정적으로 참고해야 한다.";
    const block = formatEpisodicMemoryPromptSection(
      [
        {
          id: 1,
          chat_id: 1,
          character_id: null,
          user_id: null,
          source_turn: 1,
          created_at: "now",
          metadata: "{}",
          ...validFact,
          fact_text: longText,
        },
      ],
      8,
      10
    );
    assert.equal(block, "");
    assert.ok(longText.length > 10);
  });

  it("skips an oversized first fact and still injects a later shorter fact", () => {
    const longText = "사용자는 매우 긴 장기 기억 문장을 안정적으로 참고해야 한다.";
    const shortText = "사용자는 차를 선호한다.";
    assert.ok(longText.length > 20);
    assert.ok(shortText.length <= 20);
    const block = formatEpisodicMemoryPromptSection(
      [
        {
          id: 1,
          chat_id: 1,
          character_id: null,
          user_id: null,
          source_turn: 1,
          created_at: "now",
          metadata: "{}",
          ...validFact,
          attribute: "long_budget_fact",
          value: "long",
          fact_text: longText,
        },
        {
          id: 2,
          chat_id: 1,
          character_id: null,
          user_id: null,
          source_turn: 2,
          created_at: "now",
          metadata: "{}",
          ...validFact,
          attribute: "short_budget_fact",
          value: "short",
          fact_text: shortText,
        },
      ],
      8,
      20
    );
    assert.doesNotMatch(block, /매우 긴 장기/);
    assert.match(block, /T2/);
    assert.match(block, /차를 선호한다/);
  });

  it("prompt block does not include raw JSON or internal metadata", () => {
    const block = formatEpisodicMemoryPromptSection([
      {
        id: 1,
        chat_id: 1,
        character_id: null,
        user_id: null,
        source_turn: 12,
        created_at: "now",
        metadata: JSON.stringify({ assistant_message_id: 99 }),
        ...validFact,
      },
    ]);

    assert.doesNotMatch(block, /\{|\}/);
    assert.doesNotMatch(block, /\bcategory\b|\bsubject\b|\battribute\b|\bvalue\b|extracted_facts|source_turn/);
    assert.match(block, /^- \[T12\] /m);
  });

  it("recent facts are excluded by EPISODIC_MEMORY_MIN_AGE_TURNS", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 9,
      facts: [validFact],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, { NODE_ENV: "development", EPISODIC_MEMORY_RECALL_ENABLED: "1", EPISODIC_MEMORY_MIN_AGE_TURNS: "3" } as NodeJS.ProcessEnv);

    assert.equal(result.promptBlock, "");
  });

  it("older facts are injected when old enough", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 7,
      facts: [validFact],
    });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 10,
    }, { NODE_ENV: "development", EPISODIC_MEMORY_RECALL_ENABLED: "1", EPISODIC_MEMORY_MIN_AGE_TURNS: "3" } as NodeJS.ProcessEnv);

    assert.match(result.promptBlock, /T7/);
  });

  it("feature flag disables recall completely", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 1, facts: [validFact] });

    const result = getEpisodicMemoryForPrompt(db, {
      chatId: 1,
      currentTurn: 2,
    }, { NODE_ENV: "development", EPISODIC_MEMORY_RECALL_ENABLED: "0" } as NodeJS.ProcessEnv);

    assert.equal(result.promptBlock, "");
    assert.deepEqual(result.facts, []);
  });
});

describe("episodic memory debug helpers", () => {
  it("debug utility returns only facts for the requested chat", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 1, sourceTurn: 1, facts: [validFact] });
    persistEpisodicMemoryFactsBestEffort(db, { chatId: 2, sourceTurn: 1, facts: [{ ...validFact, value: "tea" }] });

    const facts = listEpisodicMemoryFactsForDebug(db, { chatId: 1 });

    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.chat_id, 1);
    assert.equal(facts[0]!.value, "syrup_coffee");
  });

  it("debug inspection reports blocked reason", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
       (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      1,
      null,
      null,
      1,
      "setting",
      "world",
      "countdown_rule",
      "d_day",
      "important",
      "세계에는 D-DAY 카운트다운 규칙이 존재한다.",
      "{}"
    );

    const facts = inspectEpisodicMemoryFactsForDebug(db, {
      chatId: 1,
      currentTurn: 10,
    }, recallOnNoMinAge);

    assert.equal(facts.length, 1);
    assert.equal(facts[0]?.would_inject, false);
    assert.equal(facts[0]?.blocked_reason, "status_or_countdown_mechanic");
  });

  it("debug inspection reports duplicate and budget reasons", () => {
    const db = createDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      facts: [{ ...validFact, attribute: "duplicate_fact", value: "duplicate_value" }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 2,
      facts: [{ ...validFact, attribute: "selected_fact", value: "selected_value", importance: "critical", fact_text: "?ъ슜?먮뒗 선택된 디버그 기억을 참고해야 한다." }],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 3,
      facts: [{ ...validFact, attribute: "budget_fact", value: "budget_value", importance: "normal", fact_text: "?ъ슜?먮뒗 예산초과 디버그 기억을 참고해야 한다." }],
    });

    const facts = inspectEpisodicMemoryFactsForDebug(db, {
      chatId: 1,
      currentTurn: 10,
      recentChatText: validFact.fact_text,
      maxFacts: 1,
    }, recallOnNoMinAge);

    assert.equal(
      facts.find((fact) => fact.value === "duplicate_value")?.duplicate_reason,
      "duplicate_recent_chat"
    );
    assert.equal(
      facts.find((fact) => fact.value === "selected_value")?.would_inject,
      true
    );
    assert.equal(
      facts.find((fact) => fact.value === "budget_value")?.budget_reason,
      "max_facts"
    );
  });

  it("production/debug-disabled mode blocks the debug endpoint flag", () => {
    assert.equal(
      episodicMemoryDebugApiEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      episodicMemoryDebugApiEnabled({
        NODE_ENV: "production",
        EPISODIC_MEMORY_DEBUG_API_ENABLED: "1",
      } as NodeJS.ProcessEnv),
      true
    );
  });
});

describe("episodic temporary-state recall filter", () => {
  function persistTemp(
    db: Database.Database,
    opts: {
      chatId?: number;
      sourceTurn: number;
      attribute: string;
      value: string;
      fact_text: string;
      category?: ExtractedStatusFact["category"];
      subject?: string;
      importance?: ExtractedStatusFact["importance"];
    }
  ) {
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: opts.chatId ?? 1,
      sourceTurn: opts.sourceTurn,
      facts: [
        {
          category: opts.category ?? "character",
          subject: opts.subject ?? "npc_a",
          attribute: opts.attribute,
          value: opts.value,
          importance: opts.importance ?? "normal",
          fact_text: opts.fact_text,
        },
      ],
    });
    assert.equal(inserted, 1, `persist failed for ${opts.attribute}`);
  }

  it("excludes emotional_state / current_action / posture / expression / sensation from long-term recall", () => {
    const db = createDb();
    persistTemp(db, {
      sourceTurn: 10,
      attribute: "emotional_state",
      value: "anxious",
      fact_text: "캐릭터는 현재 불안해하고 있다.",
    });
    persistTemp(db, {
      sourceTurn: 11,
      attribute: "current_action",
      value: "standing",
      fact_text: "캐릭터는 지금 복도에 서 있다.",
    });
    persistTemp(db, {
      sourceTurn: 12,
      attribute: "current_posture",
      value: "leaning",
      fact_text: "캐릭터는 벽에 기대어 있는 자세를 취한다.",
    });
    persistTemp(db, {
      sourceTurn: 13,
      attribute: "current_expression",
      value: "flushed",
      fact_text: "캐릭터는 얼굴이 붉어진 상태다.",
    });
    persistTemp(db, {
      sourceTurn: 14,
      attribute: "current_sensation",
      value: "cold",
      fact_text: "캐릭터는 손에 차가운 감각을 느끼고 있다.",
    });

    const result = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 80 },
      recallOnNoMinAge
    );
    assert.equal(result.promptBlock, "");
    assert.equal(result.facts.length, 0);
  });

  it("clearly temporary facts do not consume the 8-fact limit or char budget", () => {
    const db = createDb();
    for (let i = 0; i < 8; i++) {
      persistTemp(db, {
        sourceTurn: i + 1,
        attribute: "emotional_state",
        value: `mood_${i}`,
        subject: `npc_${i}`,
        fact_text: `캐릭터는 순간적인 감정 상태 ${i}번을 지금 느끼고 있다.`,
      });
    }
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 20,
      facts: [validFact],
    });

    const byCount = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 50, maxFacts: 8 },
      recallOnNoMinAge
    );
    assert.equal(byCount.facts.length, 1);
    assert.match(byCount.promptBlock, /시럽/);
    assert.doesNotMatch(byCount.promptBlock, /순간적인 감정/);

    const byChars = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 50, maxChars: 80 },
      recallOnNoMinAge
    );
    assert.equal(byChars.facts.length, 1);
    assert.ok(byChars.facts[0]!.fact_text.length <= 80);
  });

  it("latest-wins still works for durable facts alongside temporary rows", () => {
    const db = createDb();
    persistTemp(db, {
      sourceTurn: 10,
      attribute: "emotional_state",
      value: "angry",
      fact_text: "캐릭터는 현재 화가 난 상태다.",
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 12,
      facts: [
        {
          ...validFact,
          attribute: "drink_preference",
          value: "black_coffee",
          fact_text: "사용자는 예전에는 블랙커피를 선호했다.",
        },
      ],
    });
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 30,
      facts: [
        {
          ...validFact,
          attribute: "drink_preference",
          value: "syrup_coffee",
          fact_text: "사용자는 지금은 시럽커피를 선호한다.",
        },
      ],
    });

    const result = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 40 },
      recallOnNoMinAge
    );
    assert.match(result.promptBlock, /T30/);
    assert.match(result.promptBlock, /시럽커피/);
    assert.doesNotMatch(result.promptBlock, /블랙커피/);
    assert.doesNotMatch(result.promptBlock, /화가 난/);
  });

  it("historical injury-and-recovery and location-transition events remain recallable", () => {
    const db = createDb();
    persistTemp(db, {
      sourceTurn: 10,
      attribute: "emotional_state",
      value: "recovered",
      importance: "important",
      fact_text: "캐릭터는 전투 중 부상을 입었으나 치료 후 회복했다.",
    });
    persistTemp(db, {
      sourceTurn: 11,
      category: "location",
      attribute: "current_action",
      value: "relocated",
      importance: "important",
      fact_text: "캐릭터는 특정 장소에서 단서를 발견한 뒤 다른 장소로 이동했다.",
    });

    const result = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 40 },
      recallOnNoMinAge
    );
    assert.match(result.promptBlock, /회복했다/);
    assert.match(result.promptBlock, /이동했다/);
  });

  it("durable physical_condition and relationship facts are not removed", () => {
    const db = createDb();
    persistTemp(db, {
      sourceTurn: 10,
      attribute: "physical_condition",
      value: "permanently_blind",
      importance: "critical",
      fact_text: "캐릭터는 영구적인 시력 상실 상태를 유지한다.",
    });
    persistTemp(db, {
      sourceTurn: 11,
      category: "relationship",
      subject: "npc_a_user",
      attribute: "trust_status",
      value: "allied",
      importance: "important",
      fact_text: "두 사람은 서로를 신뢰하는 관계를 유지한다.",
    });

    const result = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 40 },
      recallOnNoMinAge
    );
    assert.match(result.promptBlock, /시력 상실/);
    assert.match(result.promptBlock, /신뢰하는 관계/);
  });

  it("unknown attributes remain eligible; other-chat and min-age/flag unchanged", () => {
    const db = createDb();
    persistTemp(db, {
      chatId: 1,
      sourceTurn: 10,
      attribute: "secret_identity",
      value: "revealed",
      importance: "important",
      fact_text: "캐릭터의 정체가 상대에게 밝혀진 사실이 있다.",
    });
    persistTemp(db, {
      chatId: 2,
      sourceTurn: 10,
      attribute: "secret_identity",
      value: "other_chat",
      fact_text: "다른 채팅의 비밀 정체 사실이 여기 있으면 안 된다.",
    });
    persistTemp(db, {
      chatId: 1,
      sourceTurn: 48,
      attribute: "emotional_state",
      value: "angry",
      fact_text: "캐릭터는 현재 분노를 느끼고 있다.",
    });

    const recalled = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 50 },
      {
        NODE_ENV: "development",
        EPISODIC_MEMORY_RECALL_ENABLED: "1",
        EPISODIC_MEMORY_MIN_AGE_TURNS: "3",
      } as NodeJS.ProcessEnv
    );
    assert.match(recalled.promptBlock, /정체가/);
    assert.doesNotMatch(recalled.promptBlock, /다른 채팅/);
    assert.doesNotMatch(recalled.promptBlock, /분노/);

    const flaggedOff = getEpisodicMemoryForPrompt(
      db,
      { chatId: 1, currentTurn: 50 },
      {
        NODE_ENV: "production",
        EPISODIC_MEMORY_RECALL_ENABLED: "0",
      } as NodeJS.ProcessEnv
    );
    assert.equal(flaggedOff.promptBlock, "");
    assert.equal(flaggedOff.facts.length, 0);
  });

  it("debug inspection reports clearly_temporary blocked reason", () => {
    const db = createDb();
    persistTemp(db, {
      sourceTurn: 10,
      attribute: "emotional_state",
      value: "sad",
      fact_text: "캐릭터는 지금 슬픈 감정을 느끼고 있다.",
    });
    const inspected = inspectEpisodicMemoryFactsForDebug(
      db,
      { chatId: 1, currentTurn: 40, minAgeTurns: 0 },
      recallOnNoMinAge
    );
    assert.equal(inspected[0]?.blocked_reason, "clearly_temporary");
    assert.equal(inspected[0]?.would_inject, false);
  });
});
