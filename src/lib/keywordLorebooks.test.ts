import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  LOREBOOK_ACTIVATION_MAX_CHARS,
  LOREBOOK_ACTIVATION_RECENT_TURNS,
  LOREBOOK_ACTIVE_ENTRY_TTL_TURNS,
  buildKeywordLorebookPromptBlock,
  buildLorebookActivationText,
  ensureLorebookActiveEntriesTable,
  loadKeywordLorebookPromptBlockFromActivation,
  matchKeywordLorebookEntries,
  matchKeywordLorebookEntryDetails,
  serializeLorebookEntries,
  stripLorebookActivationInternalContent,
  type KeywordLorebookEntry,
  type LorebookActivationMessage,
  type LorebookActivationTurn,
} from "@/lib/keywordLorebooks";

const entries: KeywordLorebookEntry[] = [
  {
    keywords: ["레온", "Leon"],
    content: "레온은 렌의 오래된 조력자다.",
  },
  {
    keywords: ["칼리안"],
    content: "칼리안은 북부 기사단 소속이다.",
  },
  {
    keywords: ["브로치"],
    content: "브로치는 왕가의 문장을 담은 물건이다.",
  },
  {
    keywords: ["에카르트"],
    content: "에카르트 가문 문장은 달리는 늑대다.",
  },
];

function activation(input: {
  currentUserMessage?: string;
  recentMessages?: LorebookActivationMessage[];
  recentTurns?: LorebookActivationTurn[];
  recentTurnLimit?: number;
  recentMessageLimit?: number;
  maxChars?: number;
}) {
  return buildLorebookActivationText({
    currentUserMessage: input.currentUserMessage ?? "",
    recentMessages: input.recentMessages,
    recentTurns: input.recentTurns,
    recentTurnLimit: input.recentTurnLimit,
    recentMessageLimit: input.recentMessageLimit,
    maxChars: input.maxChars,
  });
}

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE keyword_lorebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL DEFAULT '테스트',
      summary TEXT NOT NULL DEFAULT '',
      entries_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureLorebookActiveEntriesTable(db);
  const info = db.prepare("INSERT INTO keyword_lorebooks (entries_json) VALUES (?)").run(serializeLorebookEntries(entries));
  return { db, lorebookId: Number(info.lastInsertRowid) };
}

describe("buildLorebookActivationText", () => {
  it("defaults to four visible raw turns, which can include up to eight messages", () => {
    const turns: LorebookActivationTurn[] = Array.from({ length: 5 }, (_, index) => ({
      user: index === 0 ? "레온은 오래된 턴에만 있다." : `유저 ${index}`,
      assistant: index === 1 ? "칼리안은 최근 4턴 안에 있다." : `어시스턴트 ${index}`,
    }));
    const built = activation({ currentUserMessage: "지금 입력", recentTurns: turns });

    assert.equal(LOREBOOK_ACTIVATION_RECENT_TURNS, 4);
    assert.equal(built.recentRawTurnCount, 4);
    assert.equal(built.recentRawCount, 8);
    assert.doesNotMatch(built.activationText, /오래된 턴/);
    assert.match(built.activationText, /칼리안/);
  });

  it("falls back to eight recent messages when turns are unavailable", () => {
    const messages: LorebookActivationMessage[] = Array.from({ length: 9 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index === 0 ? "레온은 오래된 메시지에만 있다." : `메시지 ${index}`,
    }));
    const built = activation({ currentUserMessage: "", recentMessages: messages });

    assert.equal(built.recentRawTurnCount, 0);
    assert.equal(built.recentRawCount, 8);
    assert.doesNotMatch(built.activationText, /레온은 오래된/);
  });

  it("uses 12000 chars as the keyword matching cap and preserves full current user message", () => {
    const longCurrent = `브로치 ${"가".repeat(13_000)}`;
    const built = activation({
      currentUserMessage: longCurrent,
      recentTurns: [{ user: "레온", assistant: "칼리안" }],
    });

    assert.equal(LOREBOOK_ACTIVATION_MAX_CHARS, 12_000);
    assert.equal(built.currentUserText, longCurrent);
    assert.ok(built.activationText.startsWith("브로치"));
    assert.equal(built.recentRawText, "");
    assert.equal(built.truncated, true);
  });

  it("preserves head and tail of a long assistant message for keyword matching", () => {
    const longAssistant = `레온이 장면 시작에 등장했다. ${"중간문장 ".repeat(1800)} 끝부분에는 에카르트 문장이 보였다.`;
    const built = activation({
      currentUserMessage: "",
      maxChars: 2500,
      recentTurns: [{ user: "본다.", assistant: longAssistant }],
    });

    assert.match(built.recentRawText, /레온이 장면 시작/);
    assert.match(built.recentRawText, /에카르트 문장/);
    assert.equal(built.truncated, true);
  });

  it("strips status JSON, extracted facts, runtime events, and internal keys before matching", () => {
    const raw = [
      "보이는 본문에는 키워드가 없다.",
      "<<<STATUS_VALUES>>>",
      '{"current_location":"레온","extracted_facts":[{"fact_text":"브로치"}],"runtime_events":["칼리안"]}',
      "<<<END_STATUS>>>",
      "trigger_id: leon_event",
      "source_turn: 12",
      "<div data-status-key=\"브로치\">브로치</div>",
    ].join("\n");
    const stripped = stripLorebookActivationInternalContent(raw);

    assert.doesNotMatch(stripped, /레온/);
    assert.doesNotMatch(stripped, /브로치/);
    assert.doesNotMatch(stripped, /칼리안/);
    assert.doesNotMatch(stripped, /trigger/);
  });
});

describe("matchKeywordLorebookEntryDetails", () => {
  it("keyword in current user message activates lorebook and reports current_user", () => {
    const built = activation({
      currentUserMessage: "브로치를 레온에게 건넨다.",
      recentTurns: [],
    });
    const matched = matchKeywordLorebookEntryDetails(entries, built);

    assert.deepEqual(
      matched.map((m) => [m.content, m.keyword, m.source]),
      [
        ["레온은 렌의 오래된 조력자다.", "레온", "current_user"],
        ["브로치는 왕가의 문장을 담은 물건이다.", "브로치", "current_user"],
      ]
    );
  });

  it("keyword in recent raw visible four-turn window activates lorebook", () => {
    const built = activation({
      currentUserMessage: "그 사람에 대해 말해줘.",
      recentTurns: [
        { user: "1", assistant: "1" },
        { user: "2", assistant: "2" },
        { user: "3", assistant: "칼리안이 잠시 이름만 남겼다." },
        { user: "4", assistant: "4" },
      ],
    });
    const matched = matchKeywordLorebookEntryDetails(entries, built);

    assert.deepEqual(
      matched.map((m) => [m.content, m.keyword, m.source]),
      [["칼리안은 북부 기사단 소속이다.", "칼리안", "recent_raw"]]
    );
  });

  it("keyword outside activation window does not activate unless carried over", () => {
    const built = activation({
      currentUserMessage: "다른 이야기를 한다.",
      recentTurns: [
        { user: "레온 얘기는 오래전 턴이다.", assistant: "오래전" },
        { user: "1", assistant: "1" },
        { user: "2", assistant: "2" },
        { user: "3", assistant: "3" },
        { user: "4", assistant: "4" },
      ],
    });

    assert.doesNotMatch(built.activationText, /레온/);
    assert.deepEqual(matchKeywordLorebookEntryDetails(entries, built), []);
  });

  it("keywords only in summary, LTM, or episodic memory are not scanned", () => {
    const built = activation({
      currentUserMessage: "요약과 기억에는 접근하지 않는다.",
      recentTurns: [{ user: "평범한 대화", assistant: "visible 대화만 있다." }],
    });
    const memoryOnlyText = [
      "[Memory] 레온은 기억에만 있다.",
      "[EPISODIC MEMORY - RETRIEVED FACTS]\n- [T12] 칼리안은 기억에만 있다.",
      "장기기억: 브로치는 기억에만 있다.",
    ].join("\n");

    assert.doesNotMatch(built.activationText, /레온|칼리안|브로치/);
    assert.deepEqual(matchKeywordLorebookEntryDetails(entries, built), []);
    assert.ok(memoryOnlyText.includes("레온"));
  });

  it("keyword inside status values or extracted facts does not activate lorebook", () => {
    const built = activation({
      currentUserMessage: "",
      recentTurns: [
        {
          user: "",
          assistant:
            '본문.\n<<<STATUS_VALUES>>>\n{"status":"레온","extracted_facts":[{"fact_text":"브로치"}],"runtime_events":["칼리안"]}\n<<<END_STATUS>>>',
        },
      ],
    });

    assert.deepEqual(matchKeywordLorebookEntryDetails(entries, built), []);
  });

  it("legacy scan API still matches case-insensitive text after internal stripping", () => {
    assert.deepEqual(matchKeywordLorebookEntries(entries, "leon mentioned the old gate"), [
      "레온은 렌의 오래된 조력자다.",
    ]);
  });
});

describe("active lorebook carryover", () => {
  it("carries over active lorebook entries for configured TTL", () => {
    const { db, lorebookId } = makeDb();
    const first = activation({ currentUserMessage: "레온 얘기로 돌아가자.", recentTurns: [] });
    const firstMatches: Array<[string, string | undefined, number | undefined]> = [];
    const firstBlock = loadKeywordLorebookPromptBlockFromActivation(db, lorebookId, first, {
      chatId: 10,
      currentTurn: 5,
      onMatch: (match) => firstMatches.push([match.source, match.keyword, match.carryoverTurnsRemaining]),
    });

    assert.match(firstBlock, /레온은 렌의 오래된 조력자다/);
    assert.deepEqual(firstMatches, [["current_user", "레온", undefined]]);
    assert.equal(LOREBOOK_ACTIVE_ENTRY_TTL_TURNS, 3);

    const second = activation({ currentUserMessage: "그는 고개를 돌린다.", recentTurns: [] });
    const carried: Array<[string, string | undefined, number | undefined]> = [];
    const secondBlock = loadKeywordLorebookPromptBlockFromActivation(db, lorebookId, second, {
      chatId: 10,
      currentTurn: 7,
      onMatch: (match) => carried.push([match.source, match.keyword, match.carryoverTurnsRemaining]),
    });

    assert.match(secondBlock, /레온은 렌의 오래된 조력자다/);
    assert.deepEqual(carried, [["carryover", "레온", 2]]);
  });

  it("carryover expires after TTL", () => {
    const { db, lorebookId } = makeDb();
    const first = activation({ currentUserMessage: "칼리안 얘기를 한다.", recentTurns: [] });
    loadKeywordLorebookPromptBlockFromActivation(db, lorebookId, first, {
      chatId: 20,
      currentTurn: 5,
    });

    const later = activation({ currentUserMessage: "이제 다른 이야기.", recentTurns: [] });
    const block = loadKeywordLorebookPromptBlockFromActivation(db, lorebookId, later, {
      chatId: 20,
      currentTurn: 9,
    });

    assert.equal(block, "");
  });
});

describe("buildKeywordLorebookPromptBlock", () => {
  it("labels keyword lorebook as recent visible dialogue/current input matching", () => {
    const block = buildKeywordLorebookPromptBlock(["내용"]);

    assert.match(block, /최근 visible 대화\/현재 입력 키워드 매칭/);
  });
});
