/**
 * User-edited memory must read identically on screen (MemoryRecordView) and on the final wire
 * (Global current memory, Medium, buildContext). Zero provider calls.
 */
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
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { getOrCreateChatMemory } from "./memory-db";
import { copyForkTurnSummaries } from "./memory-fork-snapshot";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import { buildMediumTermMemoryBlock } from "./memory-medium-term";
import { type ScopePayloadV1 } from "./memory-summary-scope";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  updateMemoryRecordById,
} from "./memory-turn-summary";

const CHAT = 995001;
const FORK_CHAT = 995004;
const USER = 995002;
const CHAR = 995003;

const FILL = " 이후 두 사람은 오래 걷다가 같은 결론에 닿았고 그 결정은 이후 장면의 전제가 되었다.";

const OLD_MAIN = "OLD_MAIN_CANON_스토리는 카페에서 시작되었고 두 사람은 처음으로 서로의 이름을 불렀다 그리고 약속을 남겼다";
const EDIT_1 = "EDIT_ONE_사용자가 직접 고친 기억: 두 사람은 카페가 아니라 옥상에서 처음 이름을 불렀고 우산을 나눠 썼다" + FILL;
const EDIT_2 = "EDIT_TWO_두 번째 수정: 옥상 약속은 취소되었고 대신 다음 주 도서관에서 다시 만나기로 했다 두 사람 모두 동의했다" + FILL;
const NONCANON = "NONCANON_가정 장면: 만약 그날 비가 왔다면 어땠을까 하는 농담 섞인 상상 대화";
const PREFERENCE = "PREFERENCE_사용자는 느린 호흡의 장면 전개와 짧은 대사를 선호한다고 직접 말했다";
const BRANCH = "BRANCH_CANON_활성 분기: 두 사람은 별도의 여행 분기에서 해변에 도착했고 모래성을 쌓기 시작했다";
const OTHER_TURN = "OTHER_TURN_MEMORY_다른 구간 기억: 주인공은 도서관에서 오래된 지도를 발견했고 비밀 통로를 찾았다";

function cleanup(): void {
  const db = getDb();
  for (const id of [CHAT, FORK_CHAT]) {
    db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chats WHERE id=?").run(id);
  }
}

function seedChat(): void {
  const db = getDb();
  cleanup();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `edit-wire-${USER}@test.local`,
    "edit-wire-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EditWireChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function seedSealedRow(opts: {
  turnStart: number;
  turnEnd: number;
  summary: string;
  summaryKind?: "main_canon" | "noncanon" | "branch_canon";
  scopes: ScopePayloadV1["scopes"];
  userEdited?: boolean;
  branchId?: string | null;
  branchStatus?: "active" | "closed" | null;
}): number {
  upsertSummaryRowCore({
    chatId: CHAT,
    turnStart: opts.turnStart,
    turnEnd: opts.turnEnd,
    assistantMessageId: null,
    summary: opts.summary,
    summaryKind: opts.summaryKind ?? "main_canon",
    userEdited: opts.userEdited ?? false,
    scopePayload: {
      v: 1,
      scopes: opts.scopes,
      branchId: opts.branchId ?? null,
      branchStatus: opts.branchStatus ?? null,
    },
    branchId: opts.branchId ?? null,
    branchStatus: opts.branchStatus ?? null,
  });
  const row = getDb()
    .prepare("SELECT id FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(CHAT, opts.turnStart) as { id: number };
  return row.id;
}

function recordOf(chatId: number, id: number) {
  const record = listMemoryRecordsForChat(chatId).find((r) => r.id === id);
  assert.ok(record, `record ${id} visible`);
  return record;
}

async function finalWire(chatId: number): Promise<{
  global: string;
  injection: string;
  currentMemorySection: string;
}> {
  const global = resolveGlobalCurrentMemory(chatId, MEMORY_CAPACITY_FIXED).text;
  const injection = await buildMemoryContextForChat({
    chatId,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: "다음 장면을 이어가 줘",
  });
  const built = buildContext({
    charName: "EditWireChar",
    chunks: [],
    userNickname: "edit-wire-owner",
    longTermMemory: injection.text,
    mediumTermMemoryBlock: injection.mediumTermText,
    archiveMemory: injection.archiveText,
    shortTermHistory: [],
    currentUserMessage: "다음 장면을 이어가 줘",
    nsfw: false,
    provider: "openrouter",
    modelId: "deepseek/deepseek-v4-flash",
    completedTurns: 10,
    summarizedTurnCount: 10,
    chatId,
    userId: USER,
  });
  const section = (built.meta.trackedSections ?? []).find((s) => s.id === "current-memory");
  return { global, injection: injection.text, currentMemorySection: section?.text ?? "" };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("USER-EDITED MEMORY FINAL WIRE", () => {
  beforeEach(seedChat);

  it("sealed main_canon row: edit is identical on screen and on the final wire; old text is gone", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN },
    });
    const otherId = seedSealedRow({
      turnStart: 6,
      turnEnd: 10,
      summary: OTHER_TURN,
      scopes: { main_canon: OTHER_TURN },
    });

    const before = await finalWire(CHAT);
    assert.ok(before.currentMemorySection.includes(OLD_MAIN));

    const view = updateMemoryRecordById(CHAT, id, EDIT_1);
    assert.ok(view);
    assert.equal(view.summary, EDIT_1);
    assert.equal(view.userEdited, true);
    assert.equal(recordOf(CHAT, id).scopes.main_canon, EDIT_1);

    const dbRow = getDb()
      .prepare("SELECT summary, scope_payload FROM chat_turn_summaries WHERE id=?")
      .get(id) as { summary: string; scope_payload: string };
    assert.equal(dbRow.summary, EDIT_1);
    assert.equal((JSON.parse(dbRow.scope_payload) as ScopePayloadV1).scopes.main_canon, EDIT_1);

    const rebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuilt.includes(EDIT_1));
    assert.equal(rebuilt.includes(OLD_MAIN), false);

    const wire = await finalWire(CHAT);
    for (const text of [wire.global, wire.injection, wire.currentMemorySection]) {
      assert.ok(text.includes(EDIT_1), "edited text on wire");
      assert.equal(text.includes(OLD_MAIN), false, "old text must not reappear on wire");
      assert.ok(text.includes(OTHER_TURN), "unrelated memory preserved");
    }

    const mirror = getDb()
      .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
      .get(CHAT) as { recent_summary: string };
    assert.ok(mirror.recent_summary.includes(EDIT_1));
    assert.equal(mirror.recent_summary.includes(OLD_MAIN), false);

    assert.equal(recordOf(CHAT, otherId).summary, OTHER_TURN);
    assert.equal(recordOf(CHAT, otherId).userEdited, false);
  });

  it("medium memory block uses the edited body", () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN },
    });
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_1));
    const medium = buildMediumTermMemoryBlock({ chatId: CHAT, blockCount: 3 });
    assert.ok(medium.text.includes(EDIT_1));
    assert.equal(medium.text.includes(OLD_MAIN), false);
  });

  it("repeated edits: only the latest edit is on the wire", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN },
    });
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_1));
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_2));
    const wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_2));
    assert.equal(wire.currentMemorySection.includes(EDIT_1), false);
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);
    assert.equal(recordOf(CHAT, id).summary, EDIT_2);
  });

  it("noncanon and preference scopes stay separated: noncanon never injected, preference kept", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN, noncanon: NONCANON, preference: PREFERENCE },
    });
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_1));
    const payload = JSON.parse(
      (
        getDb().prepare("SELECT scope_payload FROM chat_turn_summaries WHERE id=?").get(id) as {
          scope_payload: string;
        }
      ).scope_payload
    ) as ScopePayloadV1;
    assert.equal(payload.scopes.noncanon, NONCANON);
    assert.equal(payload.scopes.preference, PREFERENCE);
    assert.equal(payload.scopes.main_canon, EDIT_1);

    const wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.ok(wire.currentMemorySection.includes(PREFERENCE));
    assert.equal(wire.currentMemorySection.includes(NONCANON), false);
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);
  });

  it("active branch_canon alongside main_canon is preserved; closed branch stays out of the wire", async () => {
    const activeId = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN, branch_canon: BRANCH },
      branchId: "br-active",
      branchStatus: "active",
    });
    assert.ok(updateMemoryRecordById(CHAT, activeId, EDIT_1));
    const activePayload = JSON.parse(
      (
        getDb()
          .prepare("SELECT scope_payload FROM chat_turn_summaries WHERE id=?")
          .get(activeId) as { scope_payload: string }
      ).scope_payload
    ) as ScopePayloadV1;
    assert.equal(activePayload.scopes.branch_canon, BRANCH);
    assert.equal(activePayload.branchId, "br-active");
    assert.equal(activePayload.branchStatus, "active");
    let wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.ok(wire.currentMemorySection.includes(BRANCH));
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);

    getDb().prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
    const closedId = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN, branch_canon: BRANCH },
      branchId: "br-closed",
      branchStatus: "closed",
    });
    assert.ok(updateMemoryRecordById(CHAT, closedId, EDIT_1));
    wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.equal(wire.currentMemorySection.includes(BRANCH), false);
  });

  it("noncanon-primary row: edit promotes to main_canon without leaking the old noncanon text", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: NONCANON,
      summaryKind: "noncanon",
      scopes: { noncanon: NONCANON },
    });
    const before = await finalWire(CHAT);
    assert.equal(before.currentMemorySection.includes(NONCANON), false);
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_1));
    const wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.equal(wire.currentMemorySection.includes(NONCANON), false);
  });

  it("inactive records stay out of the wire after an edit", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN },
    });
    seedSealedRow({
      turnStart: 6,
      turnEnd: 10,
      summary: OTHER_TURN,
      scopes: { main_canon: OTHER_TURN },
    });
    getDb().prepare("UPDATE chat_turn_summaries SET inactive=1 WHERE id=?").run(id);
    updateMemoryRecordById(CHAT, id, EDIT_1);
    const wire = await finalWire(CHAT);
    assert.equal(wire.currentMemorySection.includes(EDIT_1), false);
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);
    assert.ok(wire.currentMemorySection.includes(OTHER_TURN));
  });

  it("already-stored user_edited=1 row with stale scope_payload reads as the edit (screen == wire)", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: EDIT_1,
      scopes: { main_canon: OLD_MAIN, preference: PREFERENCE },
      userEdited: true,
    });
    assert.equal(recordOf(CHAT, id).scopes.main_canon, EDIT_1);
    assert.equal(recordOf(CHAT, id).scopes.preference, PREFERENCE);
    const wire = await finalWire(CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.ok(wire.currentMemorySection.includes(PREFERENCE));
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);
    const medium = buildMediumTermMemoryBlock({ chatId: CHAT, blockCount: 3 });
    assert.ok(medium.text.includes(EDIT_1));
    assert.equal(medium.text.includes(OLD_MAIN), false);
  });

  it("non-edited rows keep the payload as the scope authority (no behavior change)", () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: "DISPLAY_ONLY_SUMMARY_COLUMN_NOT_EDITED_본문과 다른 표시용 문자열이 summary 컬럼에 있다 충분히 길게 작성한다",
      scopes: { main_canon: OLD_MAIN },
      userEdited: false,
    });
    assert.equal(recordOf(CHAT, id).scopes.main_canon, OLD_MAIN);
  });

  it("fork copy of an edited record carries the edit to the new chat's wire", async () => {
    const id = seedSealedRow({
      turnStart: 1,
      turnEnd: 5,
      summary: OLD_MAIN,
      scopes: { main_canon: OLD_MAIN },
    });
    assert.ok(updateMemoryRecordById(CHAT, id, EDIT_1));

    getDb()
      .prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`)
      .run(FORK_CHAT, USER, CHAR);
    getOrCreateChatMemory(FORK_CHAT, USER, CHAR, "free");
    const copied = copyForkTurnSummaries(getDb(), {
      sourceChatId: CHAT,
      newChatId: FORK_CHAT,
      forkTurnCount: 10,
      forkMessageId: 1_000_000,
      messageIdMap: new Map(),
    });
    assert.equal(copied, 1);
    const forked = listMemoryRecordsForChat(FORK_CHAT)[0]!;
    assert.equal(forked.userEdited, true);
    assert.equal(forked.scopes.main_canon, EDIT_1);
    const wire = await finalWire(FORK_CHAT);
    assert.ok(wire.currentMemorySection.includes(EDIT_1));
    assert.equal(wire.currentMemorySection.includes(OLD_MAIN), false);
  });
});
