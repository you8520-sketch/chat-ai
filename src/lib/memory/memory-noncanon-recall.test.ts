import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory } from "./memory-db";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import { adoptBranchToMainCanon, rebuildLorebookFromRecords } from "./memory-turn-summary";
import { composeBatchScopePayload } from "./memory-rolling-summary";
import { buildMemoryContextForPreview, buildMemoryContextForChat, updateLorebookForChat } from "./memory-manager";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { buildContext } from "@/services/contextBuilder";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { GEMINI_38_FLASH_MODEL } from "@/lib/chatModels";

const USER = 93911, CHAR = 93912, CHAT = 93913;
const query = "예전에 IF에서 광장 청혼 기억해?";
const MAIN = "MAIN_ONLY: 본편에서 백작은 광장의 청혼을 정중히 거절했다.";
const IF_EVENT = "IF_ONLY: 다른 시간선에서 백작이 광장에서 공개 청혼했다. 기록관은 반지를 거절했다고 말했다.";
const CLOSED = "CLOSED_ONLY: 번외의 탑에서 여왕이 봉인을 해제했다.";
const ACTIVE = "ACTIVE_ONLY: 현재 분기의 항구에서 선장이 출항을 준비한다.";

const preview = (userMessage: string, cutoff = 97) => buildMemoryContextForPreview({
  chatId: CHAT, tier: "free", memoryCapacity: MEMORY_CAPACITY_FIXED, userMessage,
  modelId: GEMINI_38_FLASH_MODEL, provider: "openrouter", excludeSummaryTurnStartGte: cutoff,
});

describe("B41 factual and canon-adoption questions about stored IF events", () => {
  const followup = "그럼 IF에서 있었던 청혼이 본편에서도 확정된 거지?";
  const firstQuestion = "예전에 IF에서 광장 청혼 사건이 어떻게 됐지?";

  for (const user of [
    followup,
    "IF에서 있었던 청혼이 사실이야?",
    "그럼 외전에서 했던 청혼도 본편에 편입된 거야?",
    "지난 IF의 청혼은 정사에 반영됐나요?",
    "비정사에서 있었던 청혼이 실제로 확인된 건가요?",
    "예전 IF 청혼이 본편에서 유효한지 확인해줘.",
    "IF에서 있었던 청혼이 본편에 확정된 건지 알려줘.",
    "그럼 IF 청혼은 본편에서도 인정된 건가?",
    "IF에서 있었던 청혼은 사실인 거야",
    "그럼 IF에서 있었던 청혼도 본편인 거야?",
    "지난 외전 청혼은 정사였던 거지?",
  ]) {
    it(`reads a historical assertion without requiring a recall verb: ${user}`, async () => {
      const before = totalChanges();
      const memory = await preview(user);
      assert.match(memory.mediumTermText, /IF_ONLY/);
      assert.match(memory.mediumTermText, /비정사 · 원본 6–10턴/);
      assert.match(memory.mediumTermText, /본편 사건·현재 관계·약속·소유·NPC 인지의 확정 근거가 아니다/);
      assert.doesNotMatch(memory.text, /IF_ONLY/);
      assert.equal(totalChanges(), before);
    });
  }

  for (const user of [
    "새 IF에서 청혼이 본편에 확정된 장면을 써줘.",
    "그럼 IF에서 있었던 청혼이 본편에서도 확정된 새 장면을 써줄래?",
    "예전 IF 청혼을 기억해 두고 새 에피소드를 만들어줘.",
    "지난 IF 청혼을 본편에 반영한 장면을 묘사해줘.",
    "지난 IF 이야기는 접고 오늘의 광장을 걷자.",
    "만약 IF 청혼이 본편에서도 확정된다면 어떻게 될까?",
    "예전에 IF에서 있었던 청혼이 본편에서도 확정됐다고 가정하면 어떻게 될까?",
    "지난 IF의 청혼이 본편에 편입됐다면 어떻게 돼?",
    "그럼 있었던 청혼이 본편에서도 확정된 거지?",
    "IF에서 언젠가 청혼이 일어나면 어떻게 될까?",
    "IF가 본편과 다른 설정이라는 뜻이야?",
    "지난 IF의 청혼 확정 장면은 아름다웠다.",
    "IF에서 청혼을 본편에 반영해줘.",
    "지난 IF의 청혼을 소재로 새 이야기를 만들어줄래?",
    "예전 IF 청혼을 기억하고 새 장면을 써볼까?",
    "지난 IF 청혼을 기억해서 새 이야기를 만들어줄 수 있어?",
    "지난 IF에서 있었던 청혼이 본편에 반영된다고 치면 어떻게 될까?",
  ]) {
    it(`keeps creation, hypotheticals, and non-recall turns isolated: ${user}`, async () => {
      const memory = await preview(user);
      assert.doesNotMatch(memory.text + memory.mediumTermText + memory.archiveText, /IF_ONLY|CLOSED_ONLY|NONCANON PAST RECALL/);
    });
  }

  it("does not fill an unsupported factual assertion with a different IF event", async () => {
    const memory = await preview("그럼 IF에서 있었던 용의 대관식이 본편에서도 확정된 거지?");
    assert.match(memory.mediumTermText, /검색 결과: 0개/);
    assert.doesNotMatch(memory.mediumTermText, /IF_ONLY|CLOSED_ONLY/);
  });

  it("uses the existing closed-branch reader and label for a canon-check question", async () => {
    const before = totalChanges();
    const memory = await preview("그럼 외전에서 있었던 탑의 봉인이 본편에 반영된 거지?");
    assert.match(memory.mediumTermText, /CLOSED_ONLY/);
    assert.match(memory.mediumTermText, /종료된 별도 분기 · 원본 11–15턴/);
    assert.doesNotMatch(memory.mediumTermText, /IF_ONLY|ACTIVE_ONLY/);
    assert.doesNotMatch(memory.text, /CLOSED_ONLY/);
    assert.equal(totalChanges(), before);
  });

  async function request(userMessage: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
    const memory = await buildMemoryContextForChat({ chatId: CHAT, userId: USER, characterId: CHAR,
      tier: "free", memoryCapacity: MEMORY_CAPACITY_FIXED, userMessage, excludeSummaryTurnStartGte: 97,
      modelId: GEMINI_38_FLASH_MODEL, provider: "openrouter" });
    const built = buildContext({ charName: "백작", chunks: [], userNickname: "기록관", shortTermHistory: history,
      currentUserMessage: userMessage, nsfw: false, provider: "openrouter", modelId: GEMINI_38_FLASH_MODEL,
      longTermMemory: memory.text, mediumTermMemoryBlock: memory.mediumTermText });
    const assembled = assemblePrimaryRpRequest({ system: built.systemPrompt, history: built.history,
      modelId: GEMINI_38_FLASH_MODEL, messageOpts: { systemSplit: built.openRouterSystemSplit }, stream: true });
    return { memory, wire: JSON.stringify(assembled.requestBody), inputTokens: built.meta.estimatedInputTokens };
  }

  for (const sequential of [false, true]) {
    it(`delivers the selected record once: ${sequential ? "B1 then B2 with synthetic RAW" : "B2 standalone with empty RAW"}`, async (t) => {
      const before = totalChanges();
      const history: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (sequential) {
        const first = await request(firstQuestion, []);
        assert.match(first.wire, /IF_ONLY/);
        // No actual B1 model answer exists. This is a synthetic history fixture,
        // phrased differently from the selected record so RAW is not a second copy.
        history.push({ role: "user", content: firstQuestion }, { role: "assistant",
          content: "그것은 본편과 분리된 IF 시간선이었어. 광장 청혼을 받아들이지 않았다고 했지." });
      }
      const { memory, wire, inputTokens } = await request(followup, history);
      const receipt = { receipt: "B41_FINAL_REQUEST", historyKind: sequential ? "synthetic_B1_answer" : "empty",
        actualModelAnswer: false, recallBlockCount: (wire.match(/NONCANON PAST RECALL/g) ?? []).length,
        selectedRecordOccurrences: wire.split(IF_EVENT).length - 1,
        sourceLabelOccurrences: wire.split("비정사 · 원본 6–10턴").length - 1,
        mainCurrentMemoryHasNoncanon: memory.text.includes("IF_ONLY"),
        sqlWrites: totalChanges() - before, inputTokenEstimate: inputTokens, providerCalls: 0 };
      t.diagnostic(JSON.stringify(receipt));
      assert.equal(receipt.recallBlockCount, 1);
      assert.equal(receipt.selectedRecordOccurrences, 1);
      assert.equal(receipt.sourceLabelOccurrences, 1);
      assert.equal(receipt.mainCurrentMemoryHasNoncanon, false);
      assert.equal(receipt.sqlWrites, 0, "query must not write Global, Episodic, or Ledger");
      assert.doesNotMatch(memory.mediumTermText, /MAIN_ONLY|ACTIVE_ONLY|CLOSED_ONLY/);
      if (sequential) assert.ok(wire.includes(history[1]!.content), "synthetic RAW must actually reach the request");
    });
  }
});
const totalChanges = () => (getDb().prepare("SELECT total_changes() AS n").get() as { n: number }).n;

function record(start: number, kind: "main_canon" | "noncanon" | "branch_canon", text: string, status?: "active" | "closed") {
  upsertSummaryRowCore({ chatId: CHAT, turnStart: start, turnEnd: start + 4,
    assistantMessageId: null, summary: text, summaryKind: kind, userEdited: false,
    scopePayload: { v: 1, scopes: { [kind]: text } }, branchStatus: status, branchId: status ? `b${start}` : null });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  const db = getDb();
  db.exec(`DELETE FROM chat_turn_summaries; DELETE FROM chat_memories; DELETE FROM chats; DELETE FROM characters;
    DELETE FROM users WHERE id=93911;`);
  db.prepare("INSERT INTO users (id,email,nickname,pw_hash) VALUES (?,'b39@test.local','검증','x')").run(USER);
  db.prepare("INSERT INTO characters (id,name) VALUES (?,'백작')").run(CHAR);
  db.prepare("INSERT INTO chats (id,user_id,character_id,mode) VALUES (?,?,?,'safe')").run(CHAT,USER,CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  record(1, "main_canon", MAIN);
  record(6, "noncanon", IF_EVENT);
  record(11, "branch_canon", CLOSED, "closed");
  record(16, "branch_canon", ACTIVE, "active");
  db.prepare("UPDATE chat_memories SET recent_summary=? WHERE chat_id=?").run(rebuildLorebookFromRecords(CHAT), CHAT);
});

describe("explicit historical noncanon recall from existing stored scopes", () => {
  for (const user of ["오늘 광장의 임무를 계속하자.", "본편에서 백작은 무슨 일을 했어?", "새로운 IF 청혼 장면을 써줘.", "예전 IF처럼 새 에피소드를 써줄래?"]) {
    it(`does not inject noncanon into ordinary RP: ${user}`, async () => {
      const memory = await preview(user);
      assert.doesNotMatch(memory.text + memory.mediumTermText + memory.archiveText, /IF_ONLY|CLOSED_ONLY|NONCANON PAST RECALL/);
      assert.match(memory.text, /MAIN_ONLY/);
    });
  }

  it("recalls matching noncanon with source scope, without copying main/active branches", async () => {
    const before = totalChanges();
    const memory = await preview(query);
    assert.match(memory.mediumTermText, /NONCANON PAST RECALL/);
    assert.match(memory.mediumTermText, /비정사 · 원본 6–10턴/);
    assert.match(memory.mediumTermText, /IF_ONLY/);
    assert.doesNotMatch(memory.mediumTermText, /MAIN_ONLY|ACTIVE_ONLY|CLOSED_ONLY/);
    assert.doesNotMatch(memory.text, /IF_ONLY/);
    assert.equal(totalChanges(), before, "query path must not write or promote");
  });

  for (const user of ["예전에 IF에서 무슨 일이 있었지?", "지난번 번외 에피소드 기억해?", "본편과 별개로 진행했던 사건에서 누가 무엇을 했지?"]) {
    it(`supports an explicit scope-only past question: ${user}`, async () => {
      const memory = await preview(user);
      assert.match(memory.mediumTermText, /NONCANON PAST RECALL/);
      assert.match(memory.mediumTermText, /종료된 별도 분기 · 원본 11–15턴/);
      assert.match(memory.mediumTermText, /CLOSED_ONLY/);
      assert.doesNotMatch(memory.mediumTermText, /ACTIVE_ONLY/);
    });
  }

  it("does not substitute an unrelated IF for a nonexistent event", async () => {
    const memory = await preview("예전에 IF에서 용의 대관식이 있었어?");
    assert.match(memory.mediumTermText, /검색 결과: 0개/);
    assert.doesNotMatch(memory.mediumTermText, /IF_ONLY|CLOSED_ONLY/);
  });

  for (const user of [
    "예전에 외전으로 진행했던 공개 청혼이 있었는지 기억나는 기록만으로 답해줘. 기록이 없으면 없다고 해도 돼.",
    "예전에 외전으로 진행했던 공개 청혼이 있었는지 기억나는 기록만으로 답해줘 기록이 없으면 없다고 해도 돼",
    "예전에 외전으로 진행했던 공개 청혼이 있었는지 기억나는 기록만으로 답해줘, 기록이 없으면 없다고 해도 돼",
  ]) {
    it(`keeps an explicit recall when absence is permitted: ${user}`, async () => {
      const memory = await preview(user);
      assert.match(memory.mediumTermText, /NONCANON PAST RECALL/);
      assert.match(memory.mediumTermText, /IF_ONLY/);
      assert.match(memory.mediumTermText, /비정사 · 원본 6–10턴/);
      const built = buildContext({
        charName: "백작",
        chunks: [],
        userNickname: "기록관",
        shortTermHistory: [],
        currentUserMessage: user,
        nsfw: false,
        provider: "openrouter",
        modelId: GEMINI_38_FLASH_MODEL,
        longTermMemory: memory.text,
        mediumTermMemoryBlock: memory.mediumTermText,
      });
      const request = assemblePrimaryRpRequest({
        system: built.systemPrompt,
        history: built.history,
        modelId: GEMINI_38_FLASH_MODEL,
        messageOpts: { systemSplit: built.openRouterSystemSplit },
        stream: true,
      });
      const wire = JSON.stringify(request.requestBody);
      assert.equal((wire.match(/NONCANON PAST RECALL/g) ?? []).length, 1);
      assert.equal((wire.match(/비정사 · 원본 6–10턴/g) ?? []).length, 1);
      assert.match(wire, /IF_ONLY/);
      assert.doesNotMatch(memory.text, /IF_ONLY/);
    });
  }

  for (const user of [
    "예전에 외전이 없으면 어떻게 될까?",
    "예전에 외전이 없으면 어떻게 될까? 기록이 없으면 없다고 해도 돼.",
    "예전에 외전이 없으면 어떻게 될까 기록이 없으면 없다고 해도 돼",
  ]) {
    it(`keeps a leading what-if closed when absence is also permitted: ${user}`, async () => {
      const memory = await preview(user);
      assert.doesNotMatch(memory.mediumTermText, /NONCANON PAST RECALL|IF_ONLY|CLOSED_ONLY/);
    });
  }

  it("labels the source even when the question tries to promote its relationship into main", async () => {
    const memory = await preview("지난번 비정사 외전의 청혼이 본편에서도 유효하지?");
    assert.match(memory.mediumTermText, /IF_ONLY/);
    assert.match(memory.mediumTermText, /본편 사건·현재 관계·약속·소유·NPC 인지의 확정 근거가 아니다/);
    assert.doesNotMatch(memory.text, /IF_ONLY/);
  });

  it("supports a mixed stored record by reading only its noncanon slice", async () => {
    upsertSummaryRowCore({ chatId: CHAT, turnStart: 21, turnEnd: 25, assistantMessageId: null,
      summary: "MIXED_MAIN_ONLY", summaryKind: "main_canon", userEdited: false,
      scopePayload: { v: 1, scopes: { main_canon: "MIXED_MAIN_ONLY", noncanon: "MIXED_IF_ONLY: 번외의 광장 청혼은 취소되었다." } } });
    const memory = await preview(query);
    assert.match(memory.mediumTermText, /MIXED_IF_ONLY/);
    assert.doesNotMatch(memory.mediumTermText, /MIXED_MAIN_ONLY/);
  });

  it("excludes inactive, RAW-overlapping, and adopted records", async () => {
    getDb().prepare("UPDATE chat_turn_summaries SET inactive=1 WHERE chat_id=? AND turn_number=6").run(CHAT);
    assert.doesNotMatch((await preview(query)).mediumTermText, /IF_ONLY/);
    getDb().prepare("UPDATE chat_turn_summaries SET inactive=0 WHERE chat_id=? AND turn_number=6").run(CHAT);
    assert.doesNotMatch((await preview(query, 9)).mediumTermText, /IF_ONLY/);
    const r = getDb().prepare("SELECT id FROM chat_turn_summaries WHERE chat_id=? AND turn_number=6").get(CHAT) as { id: number };
    assert.equal(adoptBranchToMainCanon({ chatId: CHAT, recordId: r.id, promotedBy: "user" }), true);
    const memory = await preview(query);
    assert.doesNotMatch(memory.mediumTermText, /IF_ONLY/);
    assert.match(memory.text, /IF_ONLY/);
  });

  it("searches each historical scope in a mixed closed-branch record independently", async () => {
    upsertSummaryRowCore({ chatId: CHAT, turnStart: 21, turnEnd: 25, assistantMessageId: null,
      summary: "MIXED_DISPLAY", summaryKind: "branch_canon", userEdited: false,
      branchId: "old-branch", branchStatus: "closed",
      scopePayload: { v: 1, scopes: { noncanon: "UNRELATED_IF: 항구의 축제가 끝났다.",
        branch_canon: "MIXED_CLOSED: 망루의 봉인이 깨졌다." } } });
    const memory = await preview("예전에 외전에서 망루 봉인 기억해?");
    assert.match(memory.mediumTermText, /MIXED_CLOSED/);
    assert.match(memory.mediumTermText, /종료된 별도 분기 · 원본 21–25턴/);
    assert.doesNotMatch(memory.mediumTermText, /UNRELATED_IF|MIXED_DISPLAY/);
  });

  it("preserves manual Global 10,000 chars and preview/chat/retry assembly parity", async () => {
    const manual = "수동기억".repeat(2500);
    await updateLorebookForChat(CHAT, USER, CHAR, manual, "free", MEMORY_CAPACITY_FIXED);
    const before = getDb().prepare("SELECT * FROM chat_memories WHERE chat_id=?").get(CHAT);
    const p = await preview(query);
    const chat = await buildMemoryContextForChat({ chatId: CHAT, userId: USER, characterId: CHAR, tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED, userMessage: query, excludeSummaryTurnStartGte: 97 });
    assert.ok(p.text.includes(manual));
    assert.equal(p.mediumTermText, chat.mediumTermText);
    assert.equal((await preview(query)).mediumTermText, p.mediumTermText);
    assert.deepEqual(getDb().prepare("SELECT * FROM chat_memories WHERE chat_id=?").get(CHAT), before);
    assert.match(p.mediumTermText, /IF_ONLY/);
  });

  it("reuses the existing noncanon composer and stored scope writer", async () => {
    const composed = await composeBatchScopePayload({ chatId: CHAT, batchStart: 26, endTurn: 30,
      allEntries: [26,27,28,29,30].map((turnIndex) => ({ turnIndex, turn: {
        user: "IF 항구 축제의 번외를 진행해.", assistant: "WRITER_IF_ONLY: 선장은 항구의 축제를 끝내고 돌아갔다.",
      } })), charName: "선장", mode: "seal", previousWasNoncanonOrBranch: false, priorRecords: [] });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    assert.equal(composed.mainModelCalls, 0);
    upsertSummaryRowCore({ chatId: CHAT, turnStart: 26, turnEnd: 30, assistantMessageId: null,
      summary: composed.displaySummary, summaryKind: composed.summaryKind, userEdited: false,
      scopePayload: { v: 1, scopes: composed.scopes } });
    const memory = await preview("예전에 IF에서 항구 축제 기억해?");
    assert.match(memory.mediumTermText, /WRITER_IF_ONLY/);
    assert.doesNotMatch(memory.text, /WRITER_IF_ONLY/);
  });

  it("delivers one labelled block with manual Global through the final Main RP request adapter", async (t) => {
    const manual = "수동기억".repeat(2500);
    await updateLorebookForChat(CHAT, USER, CHAR, manual, "free", MEMORY_CAPACITY_FIXED);
    const memory = await preview(query);
    const built = buildContext({ charName: "백작", chunks: [], userNickname: "기록관", shortTermHistory: [],
      currentUserMessage: query, nsfw: false, provider: "openrouter", modelId: GEMINI_38_FLASH_MODEL,
      longTermMemory: memory.text, mediumTermMemoryBlock: memory.mediumTermText });
    const request = assemblePrimaryRpRequest({ system: built.systemPrompt, history: built.history,
      modelId: GEMINI_38_FLASH_MODEL, messageOpts: { systemSplit: built.openRouterSystemSplit }, stream: true });
    const wire = JSON.stringify(request.requestBody);
    assert.equal((wire.match(/NONCANON PAST RECALL/g) ?? []).length, 1);
    assert.match(wire, /비정사 · 원본 6–10턴/);
    assert.match(wire, /IF_ONLY/);
    assert.match(wire, /확정 근거가 아니다/);
    assert.ok(wire.includes(manual));
    t.diagnostic(JSON.stringify({ receipt: "B39_FINAL_REQUEST", storedScope: "noncanon", sourceRange: [6, 10],
      sourceLabelPreserved: true, recallBlockCount: 1, manualGlobalChars: manual.length,
      recallBlockChars: memory.mediumTermChars, inputTokenEstimate: built.meta.estimatedInputTokens,
      providerCalls: 0, modelAnswer: null }));
  });

  it("does not turn discarded OOC/UI summaries into historical noncanon", async () => {
    upsertSummaryRowCore({ chatId: CHAT, turnStart: 21, turnEnd: 25, assistantMessageId: null,
      summary: "SAMPLE_ONLY: IF 목업 화면.", summaryKind: "empty_ooc", userEdited: false });
    const before = totalChanges();
    const memory = await preview("예전에 IF에서 SAMPLE_ONLY 기억해?");
    assert.match(memory.mediumTermText, /검색 결과: 0개/);
    assert.doesNotMatch(memory.mediumTermText, /SAMPLE_ONLY/);
    assert.equal(totalChanges(), before);
  });

  it("packs whole records within the existing three-record character budget", async () => {
    record(21, "noncanon", "OVERSIZED: 광장 청혼 이야기. ".repeat(200));
    record(26, "noncanon", "SHORT_IF: 광장 청혼을 준비했다.");
    const memory = await preview(query);
    assert.ok(memory.mediumTermText.length <= 1800);
    assert.match(memory.mediumTermText, /SHORT_IF/);
    assert.match(memory.mediumTermText, /IF_ONLY/);
    assert.doesNotMatch(memory.mediumTermText, /OVERSIZED/);
  });

  it("reads a legacy noncanon row without a scope_payload", async () => {
    upsertSummaryRowCore({ chatId: CHAT, turnStart: 21, turnEnd: 25, assistantMessageId: null,
      summary: "LEGACY_IF: 번외의 망루에서 봉인을 풀었다.", summaryKind: "noncanon", userEdited: false });
    const memory = await preview("예전에 IF에서 망루 봉인 기억해?");
    assert.match(memory.mediumTermText, /LEGACY_IF/);
    assert.match(memory.mediumTermText, /비정사 · 원본 21–25턴/);
  });

  it("respects memory OFF", async () => {
    const previous = process.env.MEMORY_FEATURE_ENABLED;
    process.env.MEMORY_FEATURE_ENABLED = "0";
    try {
      const memory = await preview(query);
      assert.equal(memory.text + memory.mediumTermText + memory.archiveText, "");
    } finally {
      if (previous === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
      else process.env.MEMORY_FEATURE_ENABLED = previous;
    }
  });
});
