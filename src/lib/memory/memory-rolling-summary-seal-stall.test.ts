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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __getLastSummarizeTurnBatchError,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  summarizeTurnBatch,
} from "./memory-rolling-summary";
import {
  highestContiguousCompletedTurn,
  isLikelySummaryInstructionEcho,
  isRollingSummaryGroundedInDialogue,
  validateSummaryNarrative,
} from "./memory-summary-integrity";
import { looksLikePriorSharedHistoryClaim, looksLikePriorSharedUserHistory } from "@/lib/sharedHistoryEvidence";
import { EMPTY_OOC_SUMMARY_MARKER } from "./memory-summary-scope";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

type RealLunaWindow = {
  turnStart: number;
  turnEnd: number;
  turns: { user: string; assistant: string }[];
  lunaOutput: string;
};

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/lib/memory/fixtures/rolling-summary-seal-stall.real-luna.json"),
    "utf8"
  )
) as { charName: string; userName: string; windows: RealLunaWindow[] };

const CHAT = 920601;
const USER = 920602;
const CHAR = 920603;
const CHAR_NAME = fixture.charName;
const USER_NAME = fixture.userName;
const USER_PERSONA = `이름/호칭: ${USER_NAME}`;
const TOTAL_WINDOWS = fixture.windows.length;

const LONG_WINDOW_STARTS = [1, 6];

function dialogueOf(window: RealLunaWindow): string {
  return window.turns
    .map((t, i) => `[${window.turnStart + i}턴]\n유저: ${t.user}\n${CHAR_NAME}: ${t.assistant}`)
    .join("\n\n");
}

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedRealWindows(windowCount: number): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `seal-stall-${USER}@test.local`,
    USER_NAME,
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, CHAR_NAME);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "pro");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  for (const window of fixture.windows.slice(0, windowCount)) {
    for (const turn of window.turns) {
      const userId = Number(
        db
          .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
          .run(CHAT, "user", turn.user, "user").lastInsertRowid
      );
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?,?,?,?,?)`
      ).run(CHAT, "assistant", turn.assistant, "test", userId);
    }
  }
  updateChatMemory(CHAT, USER, CHAR, { message_count: windowCount * 5, membership_tier: "pro" });
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
  ).run(CHAT, "user", "다음 장면으로 넘어간다.");
}

function windowFromPrompt(userContent: string): RealLunaWindow {
  const match = userContent.match(/\[(\d+)~(\d+)턴 원본 대화\]/);
  assert.ok(match, "batch prompt carries the turn range");
  const start = Number(match[1]);
  const window = fixture.windows.find((w) => w.turnStart === start);
  assert.ok(window, `fixture window for turn ${start}`);
  return window;
}

async function sealAllWindows(
  userPersona?: string
): Promise<{ sealedRounds: number; callsPerStart: Map<number, number> }> {
  const callsPerStart = new Map<number, number>();
  __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
    const window = windowFromPrompt(history.map((message) => message.content).join("\n"));
    callsPerStart.set(window.turnStart, (callsPerStart.get(window.turnStart) ?? 0) + 1);
    return { text: window.lunaOutput };
  });
  let sealedRounds = 0;
  for (let round = 0; round < TOTAL_WINDOWS + 4; round++) {
    const sealed = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: CHAR_NAME,
      userPersona,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });
    if (!sealed) break;
    sealedRounds += 1;
  }
  return { sealedRounds, callsPerStart };
}

before(() => installIsolatedTestDatabase());
after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
  uninstallIsolatedTestDatabase();
});

describe("rolling summary seal stall on real Luna sparse windows", () => {
  it("fixture: real Luna outputs are 16 windows, most under 80 chars", () => {
    assert.equal(fixture.windows.length, 16);
    const short = fixture.windows.filter((w) => w.lunaOutput.length < 80);
    assert.ok(short.length >= 12, `short windows: ${short.length}`);
  });

  it("seals every real Luna window (same conditions as the #1571 80-turn run) and advances the contiguous frontier to turn 80", async () => {
    seedRealWindows(TOTAL_WINDOWS);
    const { sealedRounds, callsPerStart } = await sealAllWindows();
    const records = listMemoryRecordsForChat(CHAT).filter((record) => !record.inactive);
    const frontier = highestContiguousCompletedTurn(records, TOTAL_WINDOWS * 5);
    const stalledAt = fixture.windows.find(
      (w) => !records.some((r) => r.turnStart === w.turnStart)
    );
    assert.equal(
      frontier,
      TOTAL_WINDOWS * 5,
      `seal chain stalled at window ${stalledAt?.turnStart ?? "?"} (lastError=${__getLastSummarizeTurnBatchError()}, calls=${JSON.stringify([...callsPerStart])})`
    );
    assert.equal(sealedRounds, TOTAL_WINDOWS);
    for (const [start, calls] of callsPerStart) {
      assert.equal(calls, 1, `window ${start} sealed on the first Luna attempt`);
    }
    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "pro");
    assert.equal(memory.summarized_turn_count, TOTAL_WINDOWS * 5);
  });

  it("stores each real Luna summary verbatim (no padding, no rewriting)", async () => {
    const records = listMemoryRecordsForChat(CHAT).filter((record) => !record.inactive);
    for (const window of fixture.windows) {
      const record = records.find((r) => r.turnStart === window.turnStart);
      assert.ok(record, `record for ${window.turnStart}`);
      assert.equal(record.summary, window.lunaOutput.replace(/\s+/g, " ").trim());
    }
  });

  it("long summaries keep the same acceptance as before", () => {
    for (const start of LONG_WINDOW_STARTS) {
      const window = fixture.windows.find((w) => w.turnStart === start)!;
      assert.ok(window.lunaOutput.length >= 80);
      assert.equal(validateSummaryNarrative(window.lunaOutput, "main_canon").ok, true);
    }
  });

  it("summarizeTurnBatch returns the valid short real Luna summary on the first attempt", async () => {
    const window = fixture.windows.find((w) => w.turnStart === 11)!;
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      return { text: window.lunaOutput };
    });
    const sealed = await summarizeTurnBatch({
      dialogue: dialogueOf(window),
      charName: CHAR_NAME,
      startTurn: window.turnStart,
      endTurn: window.turnEnd,
    });
    assert.equal(sealed, window.lunaOutput);
    assert.equal(calls, 1);
  });
  it("length gate accepts every real Luna window, still rejects empty/placeholder/echo/too-short", () => {
    for (const window of fixture.windows) {
      assert.equal(
        validateSummaryNarrative(window.lunaOutput, "main_canon").ok,
        true,
        `window ${window.turnStart}`
      );
    }
    assert.equal(validateSummaryNarrative("", "main_canon").ok, false);
    assert.equal(validateSummaryNarrative("   ", "main_canon").ok, false);
    assert.equal(validateSummaryNarrative("짧음", "main_canon").ok, false);
    assert.equal(validateSummaryNarrative(EMPTY_OOC_SUMMARY_MARKER, "main_canon").ok, false);
    assert.equal(validateSummaryNarrative("null", "main_canon").ok, false);
    assert.equal(
      validateSummaryNarrative("5턴 배치의 사건을 발생 순서대로 요약해야 한다.", "main_canon").ok,
      false
    );
    assert.equal(isLikelySummaryInstructionEcho("요약 대상 source 턴을 검토함."), true);
  });

  it("sparse summaries must be anchored in the window's own content", () => {
    const promiseCancel = fixture.windows.find((w) => w.turnStart === 11)!;
    const dialogue = dialogueOf(promiseCancel);
    const grounded = (summary: string) =>
      isRollingSummaryGroundedInDialogue(summary, dialogue, USER_PERSONA, CHAR_NAME);

    assert.equal(grounded(promiseCancel.lunaOutput), true);
    assert.equal(grounded("렌이 약속을 취소하고 검을 직접 가지러 가겠다고 함."), true);

    assert.equal(grounded("아무 일도 일어나지 않음."), false);
    assert.equal(grounded("특별한 변화 없이 평온한 하루가 지남."), false);
    assert.equal(grounded("렌과 라이크가 오랜만에 재회하여 눈물을 흘림."), false);
    assert.equal(grounded("렌이 약속에 대해 이야기함."), false);
    assert.equal(grounded("요약 대상 source 턴을 검토함."), false);

    const longUnrelated = `${"렌과 라이크가 오랜만에 재회하여 서로의 안부를 길게 물었음. ".repeat(3)}`;
    assert.ok(longUnrelated.length >= 80);
    assert.equal(
      isRollingSummaryGroundedInDialogue(longUnrelated, dialogue, USER_PERSONA, CHAR_NAME),
      true,
      "the anchor requirement applies only below ROLLING_SUMMARY_MIN_CHARS"
    );
  });

  it("rejected sparse candidate still yields an empty seal (no padding) after 3 attempts", async () => {
    const window = fixture.windows.find((w) => w.turnStart === 11)!;
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      return { text: "아무 일도 일어나지 않음." };
    });
    const sealed = await summarizeTurnBatch({
      dialogue: dialogueOf(window),
      charName: CHAR_NAME,
      userPersona: USER_PERSONA,
      startTurn: window.turnStart,
      endTurn: window.turnEnd,
    });
    assert.equal(sealed, "");
    assert.equal(calls, 3);
    assert.equal(__getLastSummarizeTurnBatchError(), "SUMMARY_NOT_GROUNDED");
  });
});

describe("persona 이름/호칭: 렌 — real Luna windows 1 / 21 / 36 are not rejected by sequencing 이후", () => {
  const groundedWithPersona = (start: number, summary?: string) => {
    const window = fixture.windows.find((w) => w.turnStart === start)!;
    return isRollingSummaryGroundedInDialogue(
      summary ?? window.lunaOutput,
      dialogueOf(window),
      USER_PERSONA,
      CHAR_NAME
    );
  };

  it("every real Luna window is grounded with the production persona string", () => {
    for (const window of fixture.windows) {
      assert.equal(groundedWithPersona(window.turnStart), true, `window ${window.turnStart}`);
    }
  });

  it("seals all 16 real windows with the persona and keeps the NPC claim attributed", async () => {
    seedRealWindows(TOTAL_WINDOWS);
    const { sealedRounds, callsPerStart } = await sealAllWindows(USER_PERSONA);
    assert.equal(sealedRounds, TOTAL_WINDOWS, `lastError=${__getLastSummarizeTurnBatchError()}`);
    for (const [start, calls] of callsPerStart) {
      assert.equal(calls, 1, `window ${start} sealed on the first attempt`);
    }
    const records = listMemoryRecordsForChat(CHAT).filter((record) => !record.inactive);
    assert.equal(highestContiguousCompletedTurn(records, TOTAL_WINDOWS * 5), TOTAL_WINDOWS * 5);
    const friend = records.find((r) => r.turnStart === 21)!;
    assert.match(friend.summary, /아는 사이라고 말했다/);
    assert.equal(friend.summary.includes("서린") || friend.summary.includes("누나"), true);
    const npc = records.find((r) => r.turnStart === 16)!;
    assert.match(npc.summary, /서린이 들어와/);
  });

  it("window 1 and 36: the user's own promise and breakup stay accepted", () => {
    assert.equal(groundedWithPersona(1), true);
    assert.equal(groundedWithPersona(36), true);
    assert.equal(
      groundedWithPersona(
        36,
        "렌이 “미안, 우리 그만 헤어지자”고 이별을 통보하자 라이크는 말없이 시선을 떨굼."
      ),
      true,
      "a quoted comma must not make the clause need user authority"
    );
  });

  it("window 21: an unattributed false friendship is still rejected", () => {
    const tail =
      " 라이크는 장작을 차례로 쌓으며 렌의 잡담을 계속 받아 주었고 렌은 시장 이야기를 이어 감.";
    const control = `렌이 시장에 다녀왔다고 함. 이후 라이크는 장작을 쌓음.${tail}`;
    assert.ok(control.length >= 80);
    assert.equal(groundedWithPersona(21, control), true, "control without a friendship claim");

    const unattributed = [
      `이후 렌이 시장에 다녀왔다고 하자 누나가 렌과 예전부터 아는 사이였음을 확인함.${tail}`,
      `렌이 시장에 다녀옴. 이후 렌과 누나는 예전부터 아는 사이였음.${tail}`,
      `렌이 시장에 다녀옴. 그날 이후 렌과 누나는 친구가 되어 자주 만나게 됨.${tail}`,
    ];
    for (const summary of unattributed) {
      assert.ok(summary.length >= 80, summary);
      assert.equal(groundedWithPersona(21, summary), false, summary);
    }
  });

  it("claim-side cue ignores only a clause-initial 이후; evidence-side cue is unchanged", () => {
    assert.equal(looksLikePriorSharedHistoryClaim("이후 라이크는 장작을 쌓음"), false);
    assert.equal(looksLikePriorSharedHistoryClaim("렌이 웃음, 이후 라이크는 장작을 쌓음"), false);
    assert.equal(looksLikePriorSharedHistoryClaim("그날 이후 두 사람은 연인이 되었음"), true);
    assert.equal(looksLikePriorSharedHistoryClaim("두 사람이 만난 이후 친해짐"), true);
    assert.equal(looksLikePriorSharedHistoryClaim("이후 두 사람은 예전부터 아는 사이였음"), true);
    assert.equal(looksLikePriorSharedUserHistory("이후 라이크는 장작을 쌓음"), true);
  });

  it("a clause-initial 이후 does not hide a prior-history claim in the same clause", () => {
    assert.equal(
      groundedWithPersona(
        21,
        "렌이 시장에 다녀옴. 이후 렌과 누나가 예전부터 알던 사이임이 드러남. 라이크는 장작을 차례로 쌓으며 렌의 잡담을 계속 받아 줌."
      ),
      false
    );
  });
});

const WIRE_PERSONAS: { label: string; persona: string | undefined }[] = [
  { label: "no persona", persona: undefined },
  { label: "persona 이름/호칭: 렌", persona: USER_PERSONA },
];

for (const { label, persona } of WIRE_PERSONAS) {
describe(`real Luna sparse seals reach the final wire at 30 / 50 / 80 turns (${label})`, () => {
  const EVENT_SENTENCES: { start: number; needle: string }[] = [
    { start: 6, needle: "연인이 되자고 제안" },
    { start: 11, needle: "약속을 취소하고 검은 자신이 직접 가겠다고" },
    { start: 36, needle: "우리 그만 헤어지자" },
  ];
  const CHECKPOINTS = [6, 10, 16];

  for (const windowCount of CHECKPOINTS) {
    const turns = windowCount * 5;
    it(`${turns} turns: every sealed window is linked into current-memory on the final wire`, async () => {
      seedRealWindows(windowCount);
      const { sealedRounds } = await sealAllWindows(persona);
      assert.equal(sealedRounds, windowCount, `lastError=${__getLastSummarizeTurnBatchError()}`);
      const records = listMemoryRecordsForChat(CHAT).filter((record) => !record.inactive);
      const summarized = highestContiguousCompletedTurn(records, turns);
      assert.equal(summarized, turns);

      const rows = getDb()
        .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
        .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
      const allTurns = messagesToTurns(rows);
      const rawPool = resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: turns,
        summarizedTurnCount: summarized,
      });
      const rawHistory = rawRecentTurnsToHistory(allTurns, rawPool, {
        summarizedTurnCount: summarized,
        memoryFeatureEnabled: true,
      });
      const excludeTurnStartGte = resolveLorebookExcludeFromTrimmedHistory(allTurns, rawHistory);
      const injection = await buildMemoryContextForChat({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "pro",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        userMessage: "다음 장면으로 넘어간다.",
        excludeSummaryTurnStartGte: excludeTurnStartGte,
        modelId: "deepseek-v4.1-flash",
        provider: "cheaperinference",
      });
      const built = buildContext({
        charName: CHAR_NAME,
        chunks: [],
        userNickname: USER_NAME,
        longTermMemory: injection.text,
        mediumTermMemoryBlock: injection.mediumTermText,
        archiveMemory: injection.archiveText,
        shortTermHistory: rawHistory,
        currentUserMessage: "다음 장면으로 넘어간다.",
        nsfw: false,
        provider: "cheaperinference",
        modelId: "deepseek-v4.1-flash",
        completedTurns: turns,
        summarizedTurnCount: summarized,
        chatId: CHAT,
        userId: USER,
      });
      const current =
        (built.meta.trackedSections ?? []).find((section) => section.id === "current-memory")
          ?.text ?? "";

      for (const window of fixture.windows.slice(0, windowCount)) {
        const inRaw = window.turnStart >= excludeTurnStartGte;
        const sealedText = window.lunaOutput.replace(/\s+/g, " ").trim();
        assert.equal(
          current.includes(sealedText),
          !inRaw,
          `window ${window.turnStart} ${inRaw ? "is raw history" : "must be in current-memory"}`
        );
      }
      for (const event of EVENT_SENTENCES) {
        if (event.start + 4 > turns) continue;
        assert.equal(current.includes(event.needle), true, `event@${event.start} lost from wire`);
      }
    });
  }
});
}
