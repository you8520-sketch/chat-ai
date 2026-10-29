import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  buildEpisodicCandidateScope,
  inspectLexicalRelevanceForDebug,
} from "@/lib/episodicMemoryFacts";
import { buildHistoricalTruthCurrentUserRecencyRef } from "@/lib/historicalTruthPolicy";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { reconcileSummaryItemRoles } from "./memory-summary-integrity";
import {
  planPromptSummaryItemRoleRewrite,
  reconcilePromptMemoryRecordBody,
  reconcilePromptVisibleSummaryText,
} from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";

const SOURCE = [
  "[80턴]",
  "유저: 공개 프러포즈를 성대하게 서술해.",
  "제이: 제이가 천천히 손을 뻗어, 오스카가 들고 있던 수류탄 핀 반지를 집어 들었다. 제이는 여유로운 동작으로 자신의 왼쪽 네 번째 손가락에 반지를 끼워 넣었다. 다음 날 아침, 메디컬 베이로 기어가다시피 출근한 오스카의 손가락에는, 그가 직접 만든 수류탄 핀 반지가 자랑스럽게 끼워져 있었다.",
].join("\n");

const STORED_76_80 =
  "이후 공개 프러포즈 미신을 믿은 오스카가 격납고에서 폭약 연막으로 청혼하고, 수류탄 핀 반지를 건넴. 제이는 반지를 끼워 약혼을 받아들이는 듯 응답했으나 폭약 낭비와 공개 소동은 처벌하겠다고 선언함. 오스카는 이를 기쁘게 받아들였고, 반지는 오스카가 계속 소유한 채 공식 약혼자라는 기쁨을 드러냄.";

const T80_QUESTION =
  "기억만 말해. 사람들 앞에서 우리 관계를 확정하려고 한 일이 있으면, 누가 누구에게 어떤 물건을 건넸는지, 그 일이 지금 장면인지 예전 장면인지 말해. 그 물건이 예전에 설치한 폭약과 같은 물건인지도 구분해. 없으면 없다고 해.";

const T100_QUESTION =
  "기억만 말해. 본편과 방금 시작된 외전이 있으면 둘을 구분해. 사람들 앞에서 관계를 확정하려고 물건을 주고받은 일은 어느 쪽의 과거인지, 누가 누구에게 무엇을 건넸는지 말해. 그 뒤에 호칭이나 명령이나 소유에 대한 말이 바뀐 것이 있으면 아직 유효한 것과 철회된 것을 구분해. 없으면 없다고 해.";

function dialogue(turn: number, assistant: string): string {
  return [`[${turn}턴]`, "유저: 소지품을 확인해.", `제이: ${assistant}`].join("\n");
}

describe("B48 summary item roles", () => {
  it("replaces continued ownership when the source shows self-wear and leaves the later ring uncertain", () => {
    const first = reconcileSummaryItemRoles(STORED_76_80, SOURCE);
    assert.equal(first.reason, "continued_owner_contradicts_self_wear");
    assert.equal(first.changed, true);
    assert.doesNotMatch(first.text, /계속 소유/);
    assert.match(first.text, /제이는 반지를 자신의 몸에 끼워/);
    assert.match(first.text, /제이가 자신의 몸에 착용함/);
    assert.match(first.text, /오스카의 직접 만든 착용분이 같은 물건인지는 원문이 확정하지 않음/);
    assert.match(first.text, /수류탄 핀 반지를 건넴/);
    assert.doesNotMatch(first.text, /같은 물건이다|같은 반지다/);
    const second = reconcileSummaryItemRoles(first.text, SOURCE);
    assert.equal(second.changed, false);
    assert.equal(second.text, first.text);
  });

  it("leaves an unrelated continued owner and a wearer-owned item unchanged", () => {
    const unrelated = reconcileSummaryItemRoles(
      "열쇠는 렌이 계속 소유한 채 보관함. 다른 사건은 없음.",
      SOURCE
    );
    assert.equal(unrelated.changed, false);
    assert.match(unrelated.text, /렌이 계속 소유/);

    const sameOwner = reconcileSummaryItemRoles(
      "반지는 제이가 계속 소유한 채 보관함.",
      SOURCE
    );
    assert.equal(sameOwner.changed, false);
    assert.match(sameOwner.text, /제이가 계속 소유/);
  });

  it("does not invent a proposal into a summary that never mentioned the item", () => {
    const early = "골목에서 우산을 같이 쓴 뒤 하숙집으로 돌아옴.";
    const result = reconcileSummaryItemRoles(early, "유저: 안녕.\n제이: 제이가 고개를 끄덕였다.");
    assert.equal(result.changed, false);
    assert.equal(result.text, early);
  });

  it("skips a user-edited record", () => {
    const body = reconcilePromptMemoryRecordBody(
      { userEdited: true, inactive: false, turnStart: 76, turnEnd: 80 },
      STORED_76_80,
      [{ turnNumber: 80, user: "공개 프러포즈", assistant: SOURCE }]
    );
    assert.equal(body, STORED_76_80);
  });

  it("corrects a grounded batch at seal time", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: STORED_76_80 }));
    try {
      const summary = await summarizeTurnBatch({
        dialogue: SOURCE,
        charName: "제이",
        startTurn: 76,
        endTurn: 80,
      });
      assert.match(summary, /제이가 자신의 몸에 착용함/);
      assert.match(summary, /원문이 확정하지 않음/);
      assert.doesNotMatch(summary, /계속 소유/);
      assert.ok(summary.length >= 80);
      assert.ok(summary.length <= 600);
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
  });
});

describe("B48 multi-event item role safety", () => {
  it("keeps two different rings on their own wearers", () => {
    const result = reconcileSummaryItemRoles(
      "수류탄 핀 반지는 오스카가 계속 소유한 채 보관함.",
      dialogue(
        10,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 렌이 자신의 손가락에 가문 반지를 끼웠다."
      )
    );
    assert.equal(result.reason, "continued_owner_contradicts_self_wear");
    assert.match(result.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(result.text, /렌/);
    assert.doesNotMatch(result.text, /계속 소유/);

    const topic = reconcileSummaryItemRoles(
      "수류탄 핀 반지는 오스카가 계속 소유한 채 보관함.",
      dialogue(
        10,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 렌은 자신의 손가락에 가문 반지를 끼웠다."
      )
    );
    assert.match(topic.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(topic.text, /렌/);
  });

  it("does not let one person's later item rewrite a different item", () => {
    const result = reconcileSummaryItemRoles(
      "수류탄 핀 반지는 오스카가 계속 소유한 채. 은시계는 렌이 계속 소유한 채.",
      dialogue(
        12,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 제이는 자신의 손목에 은시계를 착용했다."
      )
    );
    assert.match(result.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.match(result.text, /은시계는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(result.text, /계속 소유/);
  });

  it("does not give a ring clause to the later wearer of a different item", () => {
    const result = reconcileSummaryItemRoles(
      "수류탄 핀 반지는 오스카가 계속 소유한 채.",
      dialogue(
        12,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 렌이 자신의 손목에 은시계를 착용했다."
      )
    );
    assert.match(result.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(result.text, /렌/);
  });

  it("does not pick a later wearer when the same item is worn again", () => {
    const summary = "수류탄 핀 반지는 제이가 계속 소유한 채 보관함.";
    const result = reconcileSummaryItemRoles(
      summary,
      dialogue(
        14,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 오스카는 자신의 손가락에 그 수류탄 핀 반지를 끼웠다."
      )
    );
    assert.equal(result.changed, false);
    assert.equal(result.text, summary);
    assert.equal(result.reason, "ambiguous_multiple_wears");
  });

  it("keeps a source recipient when the wearer and the current owner differ", () => {
    const summary = "반지는 오스카가 계속 소유한 채 보관함.";
    const result = reconcileSummaryItemRoles(
      summary,
      dialogue(16, "제이는 자신의 손가락에 반지를 끼웠다가 오스카에게 건넸다.")
    );
    assert.equal(result.changed, false);
    assert.equal(result.text, summary);
    assert.equal(result.reason, "source_assigns_other_owner");
  });

  it("ignores quoted, speculative, and hallucinated wears", () => {
    const summary = "반지는 오스카가 계속 소유한 채.";
    const hallucination = reconcileSummaryItemRoles(
      summary,
      dialogue(18, "환각 속에서 제이는 자신의 손가락에 반지를 끼웠다.")
    );
    assert.equal(hallucination.changed, false);
    assert.equal(hallucination.text, summary);
    assert.equal(hallucination.reason, "non_factual_wear");

    const quoted = reconcileSummaryItemRoles(
      summary,
      dialogue(18, "렌이 말했다. 「제이는 자신의 손가락에 반지를 끼웠어.」")
    );
    assert.equal(quoted.changed, false);
    assert.equal(quoted.text, summary);

    const guessed = reconcileSummaryItemRoles(
      summary,
      dialogue(18, "제이는 자신의 손가락에 반지를 끼웠을 것 같다.")
    );
    assert.equal(guessed.changed, false);
    assert.equal(guessed.text, summary);

    const real = reconcileSummaryItemRoles(
      "수류탄 핀 반지는 오스카가 계속 소유한 채.",
      dialogue(
        18,
        "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다. 환각 속에서 렌은 자신의 손가락에 수류탄 핀 반지를 끼웠다."
      )
    );
    assert.match(real.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(real.text, /렌가 자신의|렌이 자신의 몸에/);
  });

  it("does not let an automatic item correction overwrite a mixed user edit", () => {
    const mixed = reconcileSummaryItemRoles(
      "가문 반지는 렌이 계속 소유한 채. 수류탄 핀 반지는 오스카가 계속 소유한 채.",
      dialogue(20, "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다.")
    );
    assert.match(mixed.text, /가문 반지는 렌이 계속 소유/);
    assert.match(mixed.text, /수류탄 핀 반지는 제이가 자신의 몸에 착용함/);
    assert.doesNotMatch(mixed.text, /오스카가 계속 소유/);

    const edited = "가문 반지는 렌이 계속 소유한 채.";
    assert.equal(
      reconcilePromptMemoryRecordBody(
        { userEdited: true, inactive: false, turnStart: 1, turnEnd: 5 },
        edited,
        [{ turnNumber: 3, user: "수정", assistant: "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다." }]
      ),
      edited
    );

    const outside = reconcilePromptMemoryRecordBody(
      { userEdited: false, inactive: false, turnStart: 6, turnEnd: 10 },
      "수류탄 핀 반지는 오스카가 계속 소유한 채.",
      [
        { turnNumber: 3, user: "이전", assistant: "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다." },
        { turnNumber: 8, user: "이후", assistant: "제이가 고개를 끄덕였다." },
      ]
    );
    assert.equal(outside, "수류탄 핀 반지는 오스카가 계속 소유한 채.");
  });

  it("does not promote a completed wear into the current scene", () => {
    const pointer = buildHistoricalTruthCurrentUserRecencyRef(T80_QUESTION);
    assert.match(pointer, /\[HISTORICAL TRUTH CHECK\]/);
    assert.match(pointer, /장면 기록/);
    assert.doesNotMatch(pointer, /현재 장면이다|지금 일어나고|착용 중/);
    const sealed = reconcileSummaryItemRoles(STORED_76_80, SOURCE);
    assert.match(sealed.text, /착용함/);
    assert.doesNotMatch(sealed.text, /착용 중|지금 장면/);
  });
});

describe("B48 read-time item role load", { concurrency: 1 }, () => {
  it("keeps headerless global text and still corrects one headed block", () => {
    installIsolatedTestDatabase();
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
      ).run(948001, "b48-headerless@test.local", "b48", "x");
      db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(948002, "제이");
      db.prepare(
        `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
      ).run(948003, 948001, 948002);
      const userInsert = db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'user', ?, '')`
        )
        .run(948003, "소지품을 확인해.");
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?, 'assistant', ?, 'm', ?)`
      ).run(948003, "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다.", Number(userInsert.lastInsertRowid));
      const headerless =
        "격납고 소동 이후의 긴 압축. 반지는 오스카가 계속 소유한 채 공식 약혼을 이어감. 다른 약속과 시간선은 원문 그대로 둔다.";
      assert.deepEqual(planPromptSummaryItemRoleRewrite(headerless), {
        action: "keep",
        reason: "headerless_global",
      });
      assert.equal(reconcilePromptVisibleSummaryText(948003, headerless), headerless);

      const headed = "[1~1턴] 반지는 오스카가 계속 소유한 채.";
      const corrected = reconcilePromptVisibleSummaryText(948003, headed);
      assert.match(corrected, /\[1~1턴\] 반지는 제이가 자신의 몸에 착용함/);
      assert.doesNotMatch(corrected, /계속 소유/);

      db.prepare(
        `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind, user_edited)
         VALUES (?,?,?,?,?,1)`
      ).run(948003, 1, 1, "반지는 오스카가 계속 소유한 채.", "main_canon");
      assert.equal(reconcilePromptVisibleSummaryText(948003, headed), headed);
    } finally {
      uninstallIsolatedTestDatabase();
    }
  });

  it("loads assistant text only for the hinted summary range at 500 and 1000 turns", async () => {
    installIsolatedTestDatabase();
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
      ).run(948011, "b48-read@test.local", "b48", "x");
      db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(948012, "제이");
      const pad = "가".repeat(2000);
      const wearTail = "제이는 자신의 손가락에 수류탄 핀 반지를 끼웠다.";
      const wearBody = `${"가".repeat(2000 - wearTail.length)}${wearTail}`;
      assert.equal(wearBody.length, 2000);
      const insertChat = db.prepare(
        `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
      );
      const insertUser = db.prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'user', '안녕', '')`
      );
      const insertAssistant = db.prepare(
        `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?, 'assistant', ?, 'm', ?)`
      );
      const seed = db.transaction((chatId: number, turns: number) => {
        insertChat.run(chatId, 948011, 948012);
        for (let turn = 0; turn < turns; turn += 1) {
          const user = insertUser.run(chatId);
          const body = turn === 79 ? wearBody : pad;
          insertAssistant.run(chatId, body, Number(user.lastInsertRowid));
        }
      });
      seed(948501, 500);
      seed(948100, 1000);

      const stats: { sql: string; chars: number }[] = [];
      const originalPrepare = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        const stmt = originalPrepare(sql);
        const all = stmt.all.bind(stmt);
        const get = stmt.get.bind(stmt);
        stmt.all = (...args: unknown[]) => {
          const rows = all(...args);
          stats.push({ sql, chars: contentChars(rows) });
          return rows;
        };
        stmt.get = (...args: unknown[]) => {
          const row = get(...args);
          stats.push({ sql, chars: contentChars(row == null ? [] : [row]) });
          return row;
        };
        return stmt;
      }) as typeof db.prepare;

      const block = "[76~80턴] 수류탄 핀 반지는 오스카가 계속 소유한 채.";
      const measured: Record<string, unknown>[] = [];
      for (const [label, chatId, turns] of [
        ["500", 948501, 500],
        ["1000", 948100, 1000],
      ] as const) {
        stats.length = 0;
        const headerless = "긴 압축문. 반지는 오스카가 계속 소유한 채 이어감.";
        assert.equal(reconcilePromptVisibleSummaryText(chatId, headerless), headerless);
        assert.equal(stats.filter((row) => /from messages/i.test(row.sql)).length, 0);

        stats.length = 0;
        const started = performance.now();
        const visible = reconcilePromptVisibleSummaryText(chatId, block);
        const onceMs = performance.now() - started;
        assert.match(visible, /제이가 자신의 몸에 착용함/);
        assert.doesNotMatch(visible, /계속 소유/);
        const firstStats = stats.splice(0, stats.length);
        reconcilePromptVisibleSummaryText(chatId, block);
        const secondStats = stats.splice(0, stats.length);
        const firstMessages = firstStats.filter((row) => /from messages/i.test(row.sql));
        const secondMessages = secondStats.filter((row) => /from messages/i.test(row.sql));
        const firstIndex = firstMessages.filter((row) => /case when role/i.test(row.sql));
        const firstContent = firstMessages.filter((row) => /id in \(/i.test(row.sql));
        const secondIndex = secondMessages.filter((row) => /case when role/i.test(row.sql));
        const secondContent = secondMessages.filter((row) => /id in \(/i.test(row.sql));
        assert.equal(firstIndex.length, 1);
        assert.equal(firstContent.length, 1);
        assert.equal(secondIndex.length, 0);
        assert.equal(secondContent.length, 1);
        assert.equal(firstContent[0]?.chars, 5 * pad.length);
        assert.ok((firstContent[0]?.chars ?? 0) < turns * pad.length);
        measured.push({
          label,
          turns,
          headerlessMessageQueries: 0,
          singleCallMs: Math.round(onceMs * 100) / 100,
          singleCallIndexQueries: firstIndex.length,
          singleCallIndexChars: firstIndex.reduce((sum, row) => sum + row.chars, 0),
          singleCallContentQueries: firstContent.length,
          singleCallContentChars: firstContent[0]?.chars ?? 0,
          sameTurnRepeatIndexQueries: secondIndex.length,
          sameTurnRepeatContentQueries: secondContent.length,
          storedAssistantChars: turns * pad.length,
          singleCallSummaryRecordQueries: firstStats.filter((row) => /chat_turn_summaries/i.test(row.sql)).length,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
      fs.writeFileSync(
        "/opt/cursor/artifacts/b48-read-path.json",
        `${JSON.stringify({ measuredAt: new Date().toISOString(), runs: measured }, null, 2)}\n`
      );
    } finally {
      uninstallIsolatedTestDatabase();
    }
  });
});

function contentChars(rows: readonly unknown[]): number {
  let total = 0;
  for (const row of rows) {
    if (row && typeof row === "object" && "content" in row && typeof (row as { content?: unknown }).content === "string") {
      total += (row as { content: string }).content.length;
    }
  }
  return total;
}

describe("B48 episodic id 45 boundary", () => {
  const fact = {
    subject: "oscar_fitzroy",
    attribute: "proposal_ring",
    value: "grenade_pin_ring",
    fact_text: "오스카는 수류탄 안전 핀을 가공해 만든 은빛 반지를 프러포즈에 사용했다.",
  };

  it("scores the T100 paraphrase at zero and an overlapping query above zero", () => {
    const missed = inspectLexicalRelevanceForDebug(fact, T100_QUESTION);
    assert.equal(missed.relevanceScore, 0);
    const hit = inspectLexicalRelevanceForDebug(fact, "수류탄 핀 반지");
    assert.ok(hit.relevanceScore > 0);
  });

  it("keeps source turn 80 outside recall at current turn 81 with the default min age", () => {
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE chat_memories (
        chat_id INTEGER PRIMARY KEY,
        memory_reset_after_message_id INTEGER,
        memory_epoch INTEGER
      )`
    );
    const scope = buildEpisodicCandidateScope(db, { chatId: 1, currentTurn: 81 }, {});
    assert.equal(scope?.minAgeTurns, 5);
    assert.equal(scope?.recallCutoffTurn, 76);
    assert.equal(80 > (scope?.recallCutoffTurn ?? 0), true);
    db.close();
  });
});
