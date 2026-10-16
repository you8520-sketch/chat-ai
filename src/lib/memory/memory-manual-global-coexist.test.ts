/**
 * User-saved Global memory (manual_global) must survive normal RP progress while the
 * automatic 5-turn records keep accumulating and stay visible to the next prompt.
 * Zero provider calls — the summary caller and compaction are stubbed.
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
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { getChatMemoryRow, getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { prepareMemoryPanelView } from "./memory-backfill";
import { executeGlobalLorebookCompaction } from "./memory-global-compaction-execution";
import {
  commitExactGlobalMirrorCore,
  commitGlobalCompactCheckpointCore,
  readGlobalCheckpointSnapshot,
} from "./memory-global-checkpoint";
import { refreshGlobalMemoryMirrorFromRecords } from "./memory-global-projection";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import {
  buildMemoryContextForChat,
  buildMemoryContextForPreview,
  updateLorebookForChat,
} from "./memory-manager";
import { measureMediumGlobalLiteralDuplicateChars } from "./memory-medium-term";
import {
  reconcileMemoryAfterRecordDelete,
  reconcileMemoryAfterTurnDelete,
} from "./memory-reconcile";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";
import { getMemorySourceBoundary } from "./memory-source-boundary";
import {
  adoptPostManualEditToMain,
  promotePostManualEditToBranch,
} from "./memory-summary-scope";
import {
  closeActiveBranchCanon,
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  markMemoryRecordInactive,
  promoteRecordsToBranchCanon,
  resolveManualGlobalMediumDelivery,
  updateMemoryRecordById,
  type MemoryRecordView,
} from "./memory-turn-summary";
import { reconcileMemoryAfterVariantSwitchCore } from "./memory-variant-switch-reconcile";

const CHAT = 997101;
const USER = 997102;
const CHAR = 997103;
const MANUAL_TEXT =
  "USER_MANUAL_GLOBAL — 직접 확정: 한강 약속은 취소되었고 지금은 유효하지 않다.";
const ENV_MEMORY = "MEMORY_FEATURE_ENABLED";
let savedEnv: string | undefined;
let summaryCalls = 0;
let failSummaryRange: string | null = null;
let onSummaryRange: ((range: string) => Promise<void>) | null = null;
let nextTurn = 1;
let pendingUserMessageId: number | null = null;

const sealOpts = {
  chatId: CHAT,
  userId: USER,
  characterId: CHAR,
  charName: "CoexistChar",
  tier: "free" as const,
  memoryCapacity: MEMORY_CAPACITY_FIXED,
  maxRounds: 12,
};

function padBody(marker: string, chars = 420): string {
  let body = `${marker} → event → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
}

function seedChat(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `coexist-${USER}@test.local`,
    "coexist-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "CoexistChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  nextTurn = 1;
  pendingUserMessageId = null;
}

function insertUserMessage(turn: number): number {
  return getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(CHAT, "user", `본편 턴 ${turn}`).lastInsertRowid as number;
}

function playTurnsThrough(lastTurn: number): void {
  const db = getDb();
  for (; nextTurn <= lastTurn; nextTurn++) {
    const userMsgId = pendingUserMessageId ?? insertUserMessage(nextTurn);
    pendingUserMessageId = null;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(CHAT, "assistant", `응답 ${nextTurn} 대사`, "test", userMsgId);
  }
  const count = nextTurn - 1;
  updateChatMemory(CHAT, USER, CHAR, { message_count: count });
}

/**
 * Completed turns through `lastTurn`, then the user's next message is already stored (request start)
 * with its reply still pending — the state in which a catch-up seal of the batch ending at `lastTurn`
 * runs, and in which the user can save a manual Global that covers exactly `lastTurn` turns.
 */
function playThroughWithPending(lastTurn: number): void {
  playTurnsThrough(lastTurn);
  pendingUserMessageId = insertUserMessage(nextTurn);
}

async function seal(): Promise<void> {
  while ((await catchUpRollingSummaries(sealOpts)) >= sealOpts.maxRounds) {
    // keep sealing until the backlog is drained
  }
}

async function saveManual(text = MANUAL_TEXT): Promise<void> {
  await updateLorebookForChat(CHAT, USER, CHAR, text, "free", MEMORY_CAPACITY_FIXED);
}

function memoryRow() {
  return getChatMemoryRow(CHAT)!;
}

function assertManualKept(): void {
  const row = memoryRow();
  assert.equal(row.recent_summary, MANUAL_TEXT, "manual text must be unchanged");
  assert.equal(row.global_projection_kind, "manual_global", "manual kind must stay");
}

async function injection() {
  return buildMemoryContextForChat({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: "이어서 진행해줘",
  });
}

function activeRecordStarts(): number[] {
  return listMemoryRecordsForChat(CHAT)
    .filter((r) => !r.inactive)
    .map((r) => r.turnStart);
}

before(() => installIsolatedTestDatabase());
after(() => {
  cleanup();
  uninstallIsolatedTestDatabase();
});

beforeEach(() => {
  savedEnv = process.env[ENV_MEMORY];
  process.env[ENV_MEMORY] = "1";
  summaryCalls = 0;
  seedChat();
  __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
    summaryCalls += 1;
    const content = history[0]!.content;
    const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(content);
    const start = Number(m![1]);
    const end = Number(m![2]);
    const range = `${start}~${end}`;
    if (failSummaryRange === range) throw new Error(`stub summary failure ${range}`);
    await onSummaryRange?.(range);
    const tag = start === 1 ? "OLD_PROMISE_FACT_HANGANG_ACTIVE " : "";
    const preEditFact = content.includes("[12턴]") ? " PRE_EDIT_FACT_T12" : "";
    return { text: padBody(`${tag}AUTO_T${start}_${end}${preEditFact}`) };
  });
  __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));
});

afterEach(() => {
  failSummaryRange = null;
  onSummaryRange = null;
  __setSummarizeTurnBatchCallerForTests(null);
  __setCompactCurrentMemoryTestOverride(null);
  if (savedEnv === undefined) delete process.env[ENV_MEMORY];
  else process.env[ENV_MEMORY] = savedEnv;
});

describe("A — normal 5-turn seal keeps the user's manual Global", () => {
  it("T10 manual save → T15 automatic seal: manual text, kind and new record all survive", async () => {
    playThroughWithPending(10);
    await seal();
    assert.deepEqual(activeRecordStarts(), [1, 6]);

    await saveManual();
    assertManualKept();

    playTurnsThrough(16);
    await seal();

    assertManualKept();
    assert.deepEqual(activeRecordStarts(), [1, 6, 11]);
    assert.equal(memoryRow().summarized_turn_count, 15);
  });
});

describe("B — RP keeps going: manual stays, automatic records keep reaching the prompt", () => {
  it("T10 manual → T15/T20/T25 seals: every new record is stored and injected, older ones are not re-injected", async () => {
    playThroughWithPending(10);
    await seal();
    await saveManual();

    playTurnsThrough(16);
    await seal();
    playTurnsThrough(21);
    await seal();
    playTurnsThrough(26);
    await seal();

    assertManualKept();
    assert.deepEqual(activeRecordStarts(), [1, 6, 11, 16, 21]);

    const wire = await injection();
    assert.match(wire.text, /USER_MANUAL_GLOBAL/);
    assert.match(wire.mediumTermText, /AUTO_T11_15/);
    assert.match(wire.mediumTermText, /AUTO_T16_20/);
    assert.match(wire.mediumTermText, /AUTO_T21_25/);
    assert.equal(wire.mediumTermText.includes("AUTO_T1_5"), false);
    assert.equal(wire.mediumTermText.includes("AUTO_T6_10"), false);
    assert.equal(wire.text.includes("AUTO_T"), false, "Global must stay the user's text only");
    assert.equal(measureMediumGlobalLiteralDuplicateChars(wire.mediumTermText, wire.text), 0);
  });

  it("model preview and the real RP assemble the same final memory", async () => {
    playThroughWithPending(10);
    await seal();
    await saveManual();
    playTurnsThrough(21);
    await seal();

    const real = await injection();
    const preview = await buildMemoryContextForPreview({
      chatId: CHAT,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "이어서 진행해줘",
    });
    assert.equal(preview.text, real.text);
    assert.equal(preview.mediumTermText, real.mediumTermText);
    assert.match(real.mediumTermText, /AUTO_T11_15/);
  });

  it("without records after the save the Medium stays empty (no extra tokens)", async () => {
    playThroughWithPending(10);
    await seal();
    await saveManual();
    const wire = await injection();
    assert.equal(wire.mediumTermText, "");
    assert.match(wire.text, /USER_MANUAL_GLOBAL/);
  });
});

describe("C — user correction wins over older automatic records", () => {
  it("a corrected promise in the manual text is not contradicted by the old automatic record", async () => {
    playThroughWithPending(10);
    await seal();
    assert.ok(
      listMemoryRecordsForChat(CHAT).some((r) => r.summary.includes("OLD_PROMISE_FACT_HANGANG_ACTIVE"))
    );
    await saveManual();
    playTurnsThrough(21);
    await seal();

    const wire = await injection();
    const all = `${wire.text}\n${wire.mediumTermText}`;
    assert.equal(all.includes("OLD_PROMISE_FACT_HANGANG_ACTIVE"), false);
    assert.match(all, /한강 약속은 취소되었고/);

    const visible = listVisibleMemoryRecordsForChat(CHAT);
    assert.ok(
      visible.some((r) => r.summary.includes("OLD_PROMISE_FACT_HANGANG_ACTIVE")),
      "older automatic records are never deleted or hidden — only not re-injected"
    );
    assert.ok(visible.every((r) => !r.inactive));
  });
});

describe("D — deleting the manual memory returns to automatic memory", () => {
  it("saving an empty text releases manual mode and rebuilds Global from the 5-turn records", async () => {
    playThroughWithPending(10);
    await seal();
    await saveManual();
    playTurnsThrough(16);
    await seal();

    await saveManual("");
    const row = memoryRow();
    assert.equal(row.global_projection_kind, null);
    assert.equal(row.global_covered_through_turn, null);
    assert.match(row.recent_summary, /AUTO_T1_5/);
    assert.match(row.recent_summary, /AUTO_T11_15/);
    assert.equal(row.recent_summary.includes("USER_MANUAL_GLOBAL"), false);

    const wire = await injection();
    assert.match(wire.text, /AUTO_T11_15/);
    assert.equal(wire.mediumTermText, "");

    playTurnsThrough(21);
    await seal();
    assert.match(memoryRow().recent_summary, /AUTO_T16_20/, "automatic mirror resumes after release");
  });
});

describe("E — alternate paths never discard the manual Global", () => {
  async function seedManualWithPostRecords(): Promise<void> {
    playThroughWithPending(10);
    await seal();
    await saveManual();
    playTurnsThrough(26);
    await seal();
    assert.deepEqual(activeRecordStarts(), [1, 6, 11, 16, 21]);
  }

  it("editing a 5-turn record", async () => {
    await seedManualWithPostRecords();
    const target = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 16)!;
    updateMemoryRecordById(CHAT, target.id, padBody("USER_EDITED_RECORD"));
    assertManualKept();
    const wire = await injection();
    assert.match(wire.mediumTermText, /USER_EDITED_RECORD/);
  });

  it("deleting a 5-turn record then reconciling", async () => {
    await seedManualWithPostRecords();
    const target = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 21)!;
    assert.ok(markMemoryRecordInactive(CHAT, target.id));
    reconcileMemoryAfterRecordDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "CoexistChar",
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });
    assertManualKept();
    const wire = await injection();
    assert.equal(wire.mediumTermText.includes("AUTO_T21_25"), false, "inactive record is not injected");
  });

  it("deleting the last turns", async () => {
    await seedManualWithPostRecords();
    const db = getDb();
    const lastIds = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 12`)
      .all(CHAT) as { id: number }[];
    for (const { id } of lastIds) db.prepare(`DELETE FROM messages WHERE id=?`).run(id);
    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "CoexistChar",
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });
    assertManualKept();
  });

  it("variant switch / source message edit invalidating a post-save record", async () => {
    await seedManualWithPostRecords();
    reconcileMemoryAfterVariantSwitchCore(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      memoryTurnNumber: 12,
      sourceTurn: 12,
    });
    assertManualKept();
    const wire = await injection();
    assert.equal(wire.mediumTermText.includes("AUTO_T11_15"), false, "invalidated record is not injected");
    assert.match(wire.mediumTermText, /AUTO_T16_20/);
  });

  it("branch promotion / close and the route's generic Global refresh", async () => {
    await seedManualWithPostRecords();
    const target = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 21)!;
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [target.id],
      branchId: "branch-coexist",
      promotedBy: "test",
    });
    assertManualKept();
    closeActiveBranchCanon(CHAT, { source: "ui" });
    assertManualKept();
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: "REBUILT_BY_ROUTE", membership_tier: "free" });
    assertManualKept();
  });

  it("regenerating a post-save 5-turn record", async () => {
    await seedManualWithPostRecords();
    const ok = await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "CoexistChar",
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      turnStart: 16,
    });
    assert.equal(ok, true);
    assertManualKept();
  });

  it("panel open / reconnect (GET path) repairs counts only", async () => {
    await seedManualWithPostRecords();
    updateChatMemory(CHAT, USER, CHAR, { message_count: 0, summarized_turn_count: 0 });
    prepareMemoryPanelView(sealOpts);
    assertManualKept();
    const wire = await injection();
    assert.match(wire.mediumTermText, /AUTO_T21_25/);
  });

  it("global compaction never overwrites or even calls the provider for a manual row", async () => {
    let compactCalls = 0;
    __setCompactCurrentMemoryTestOverride(async (input, max) => {
      compactCalls += 1;
      return input.slice(0, max);
    });
    await seedManualWithPostRecords();
    const memory = memoryRow();
    const result = await executeGlobalLorebookCompaction({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 200,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist: readGlobalCheckpointSnapshot(memory),
      trigger: "background",
    });
    assert.equal(result.committed, false);
    assert.equal(compactCalls, 0);
    assertManualKept();
  });

  it("a manual save that lands while an automatic compaction is in flight wins", async () => {
    playThroughWithPending(10);
    await seal();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    __setCompactCurrentMemoryTestOverride(async (input, max) => {
      await gate;
      return `RACED_COMPACT_${input.length}`.slice(0, max);
    });
    const inFlight = executeGlobalLorebookCompaction({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 200,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist: readGlobalCheckpointSnapshot(memoryRow()),
      trigger: "background",
    });
    await saveManual();
    release();
    await inFlight;
    assertManualKept();
  });
});

describe("F — existing data", () => {
  it("legacy manual_global without a recorded boundary: reads keep it, the next seal adopts the boundary", async () => {
    playTurnsThrough(16);
    await seal();
    assert.deepEqual(activeRecordStarts(), [1, 6, 11]);
    getDb()
      .prepare(
        `UPDATE chat_memories SET recent_summary=?, global_projection_kind='manual_global',
           global_source_fingerprint=NULL, global_covered_through_turn=NULL WHERE chat_id=?`
      )
      .run(MANUAL_TEXT, CHAT);

    prepareMemoryPanelView(sealOpts);
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, null, "reads never invent a boundary");
    const before = await injection();
    assert.equal(before.mediumTermText, "", "unknown boundary injects nothing old");
    assert.match(before.text, /USER_MANUAL_GLOBAL/);

    playTurnsThrough(21);
    await seal();
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 15);
    const after = await injection();
    assert.match(after.mediumTermText, /AUTO_T16_20/);
    assert.equal(after.mediumTermText.includes("AUTO_T11_15"), false);
  });

  it("automatic (non-manual) chats keep the exact mirror and never inject Medium", async () => {
    playTurnsThrough(16);
    await seal();
    const row = memoryRow();
    assert.equal(row.global_projection_kind, null);
    assert.match(row.recent_summary, /AUTO_T11_15/);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "exact");
    const wire = await injection();
    assert.equal(wire.mediumTermText, "");
  });

  it("no extra provider calls: one summary call per sealed batch, none for manual save/read", async () => {
    playTurnsThrough(16);
    await seal();
    const sealedCalls = summaryCalls;
    assert.equal(sealedCalls, 3);
    await saveManual();
    await injection();
    prepareMemoryPanelView(sealOpts);
    assert.equal(summaryCalls, sealedCalls);
  });
});

describe("G — structural guard and long histories", () => {
  it("a manual Global stays authoritative after the sealed history outgrows the Global budget", async () => {
    playThroughWithPending(100);
    await seal();
    await saveManual();
    const savedBoundary = memoryRow().global_covered_through_turn;
    assert.equal(savedBoundary, 100);

    playTurnsThrough(131);
    await seal();
    assertManualKept();
    assert.ok(
      listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length >= 26,
      "history must be longer than the Global budget can hold"
    );
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.ok(resolved.rebuiltChars > MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "manual_global");
    assert.equal(resolved.manualBoundaryTurn, 100);
    assert.equal(resolved.needsBackgroundCompact, false);

    const wire = await injection();
    assert.equal(wire.text.includes("AUTO_T"), false);
    assert.match(wire.mediumTermText, /AUTO_T101_105/);
    assert.match(wire.mediumTermText, /AUTO_T126_130/);
    assert.equal(wire.mediumTermText.includes("AUTO_T96_100"), false);
    assert.equal(wire.mediumTermText.includes("AUTO_T1_5"), false);
  });

  it("derived-projection writers still write non-manual rows and refuse manual ones", async () => {
    playTurnsThrough(11);
    await seal();
    const db = getDb();
    const archive = memoryRow().archive_summary ?? "";

    commitExactGlobalMirrorCore(db, { chatId: CHAT, exactText: "AUTO_MIRROR_A", archiveSummary: archive });
    assert.equal(memoryRow().recent_summary, "AUTO_MIRROR_A", "kind NULL row is writable");
    commitGlobalCompactCheckpointCore(db, {
      chatId: CHAT,
      compactText: "AUTO_COMPACT_B",
      archiveSummary: archive,
      coveredThroughTurn: 5,
      sourceFingerprint: "fp",
    });
    assert.equal(memoryRow().recent_summary, "AUTO_COMPACT_B", "global_compact row is writable");
    refreshGlobalMemoryMirrorFromRecords(CHAT);
    assert.match(memoryRow().recent_summary, /AUTO_T6_10/);

    await saveManual();
    commitExactGlobalMirrorCore(db, { chatId: CHAT, exactText: "AUTO_MIRROR_C", archiveSummary: archive });
    commitGlobalCompactCheckpointCore(db, {
      chatId: CHAT,
      compactText: "AUTO_COMPACT_D",
      archiveSummary: archive,
      coveredThroughTurn: 5,
      sourceFingerprint: "fp",
    });
    refreshGlobalMemoryMirrorFromRecords(CHAT);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: "AUTO_PATCH_E" });
    assertManualKept();
  });

  it("an emptied legacy manual row (no user text) is not protected and rebuilds normally", async () => {
    playTurnsThrough(11);
    await seal();
    getDb()
      .prepare(
        `UPDATE chat_memories SET recent_summary='', global_projection_kind='manual_global',
           global_covered_through_turn=NULL WHERE chat_id=?`
      )
      .run(CHAT);
    refreshGlobalMemoryMirrorFromRecords(CHAT);
    assert.equal(memoryRow().global_projection_kind, null);
    assert.match(memoryRow().recent_summary, /AUTO_T6_10/);
  });
});

function recordAt(turnStart: number): MemoryRecordView | undefined {
  return listMemoryRecordsForChat(CHAT).find((r) => !r.inactive && r.turnStart === turnStart);
}

describe("H — a manual save in the middle of a 5-turn block", () => {
  async function saveManualAtT12(): Promise<void> {
    playTurnsThrough(12);
    await seal();
    assert.deepEqual(activeRecordStarts(), [1, 6]);
    await saveManual();
  }

  it("T12 save: the boundary is the last completed turn; T16/T21 never re-inject the pre-save block", async () => {
    await saveManualAtT12();
    assert.equal(memoryRow().global_covered_through_turn, 12);
    const callsBeforeBlock = summaryCalls;

    playTurnsThrough(16);
    await seal();
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 12, "a seal never lowers the exact boundary");
    assert.equal(summaryCalls - callsBeforeBlock, 2, "full batch + one post-save slice");

    const record = recordAt(11)!;
    assert.match(record.summary, /PRE_EDIT_FACT_T12/, "the stored record keeps the whole block");
    assert.equal(record.postManualEdit?.fromTurn, 13);
    assert.match(record.postManualEdit!.scopes.main_canon!, /AUTO_T13_15/);
    assert.equal(record.postManualEdit!.scopes.main_canon!.includes("PRE_EDIT_FACT_T12"), false);

    for (const through of [16, 21]) {
      if (through === 21) {
        playTurnsThrough(21);
        await seal();
      }
      const wire = await injection();
      assert.match(wire.text, /USER_MANUAL_GLOBAL/);
      assert.match(wire.mediumTermText, /\[최근 기억 · T13–15\]\nAUTO_T13_15/, `T${through}`);
      assert.equal(wire.mediumTermText.includes("AUTO_T11_15"), false, `T${through}`);
      assert.equal(wire.mediumTermText.includes("PRE_EDIT_FACT_T12"), false, `T${through}`);
      assert.equal(wire.text.includes("PRE_EDIT_FACT_T12"), false, `T${through}`);
    }
    assert.match((await injection()).mediumTermText, /AUTO_T16_20/);
  });

  for (const scenario of [
    { boundary: 10, setup: () => playThroughWithPending(10), delivered: "T11–15", extraCalls: 1 },
    { boundary: 12, setup: () => playTurnsThrough(12), delivered: "T13–15", extraCalls: 2 },
    { boundary: 15, setup: () => playTurnsThrough(15), delivered: null, extraCalls: 1 },
  ]) {
    it(`T${scenario.boundary} save: delivery and summary calls follow the exact boundary`, async () => {
      scenario.setup();
      await seal();
      await saveManual();
      assert.equal(memoryRow().global_covered_through_turn, scenario.boundary);
      const callsBefore = summaryCalls;

      playTurnsThrough(16);
      await seal();
      assertManualKept();
      assert.equal(memoryRow().global_covered_through_turn, scenario.boundary);
      assert.equal(summaryCalls - callsBefore, scenario.extraCalls);
      assert.equal(
        recordAt(11)?.postManualEdit != null,
        scenario.boundary === 12,
        "only a record the boundary falls inside carries a slice"
      );

      const wire = await injection();
      if (scenario.delivered == null) {
        assert.equal(wire.mediumTermText, "", "a fully covered record adds nothing");
      } else {
        assert.match(wire.mediumTermText, new RegExp(`\\[최근 기억 · ${scenario.delivered}\\]`));
      }
    });
  }

  it("releasing the manual memory lets the full T11–15 record rebuild Global again", async () => {
    await saveManualAtT12();
    playTurnsThrough(16);
    await seal();
    const callsBeforeRelease = summaryCalls;

    await saveManual("");
    const row = memoryRow();
    assert.equal(row.global_projection_kind, null);
    assert.equal(row.global_covered_through_turn, null);
    assert.match(row.recent_summary, /AUTO_T11_15/);
    assert.match(row.recent_summary, /PRE_EDIT_FACT_T12/);
    const wire = await injection();
    assert.match(wire.text, /AUTO_T11_15/);
    assert.equal(wire.mediumTermText, "");
    assert.equal(summaryCalls, callsBeforeRelease, "release never calls the summarizer");
  });

  it("save + re-edit inside one block: the later boundary decides the slice", async () => {
    await saveManualAtT12();
    playTurnsThrough(14);
    await updateLorebookForChat(CHAT, USER, CHAR, `${MANUAL_TEXT} 재수정`, "free", MEMORY_CAPACITY_FIXED);
    assert.equal(memoryRow().global_covered_through_turn, 14);

    playTurnsThrough(16);
    await seal();
    assert.equal(recordAt(11)!.postManualEdit?.fromTurn, 15);
    const wire = await injection();
    assert.match(wire.mediumTermText, /\[최근 기억 · T15–15\]\nAUTO_T15_15/);
    assert.equal(wire.mediumTermText.includes("AUTO_T13_15"), false);
    assert.equal(wire.mediumTermText.includes("AUTO_T11_15"), false);
  });

  it("an already user-edited 5-turn record is delivered as the user wrote it", async () => {
    await saveManualAtT12();
    playTurnsThrough(16);
    await seal();
    const callsBefore = summaryCalls;
    updateMemoryRecordById(CHAT, recordAt(11)!.id, padBody("USER_EDITED_RECORD"));
    assertManualKept();
    assert.equal(summaryCalls, callsBefore, "a user edit never calls the summarizer");
    const wire = await injection();
    assert.match(wire.mediumTermText, /\[최근 기억 · T11–15\]\nUSER_EDITED_RECORD/);
    assert.equal(wire.mediumTermText.includes("AUTO_T13_15"), false);
  });

  it("regenerating the straddling record rebuilds its slice and keeps the manual text", async () => {
    await saveManualAtT12();
    playTurnsThrough(16);
    await seal();
    const callsBefore = summaryCalls;
    const ok = await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "CoexistChar",
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      turnStart: 11,
    });
    assert.equal(ok, true);
    assert.equal(summaryCalls - callsBefore, 2);
    assertManualKept();
    assert.equal(recordAt(11)!.postManualEdit?.fromTurn, 13);
    assert.match((await injection()).mediumTermText, /\[최근 기억 · T13–15\]\nAUTO_T13_15/);
  });

  it("a failing slice summary leaves the batch unsealed — the conflicting block is never injected", async () => {
    await saveManualAtT12();
    failSummaryRange = "13~15";
    playTurnsThrough(16);
    await seal();

    assert.equal(recordAt(11), undefined, "the batch stays pending for the existing retry owner");
    assert.equal(memoryRow().summarized_turn_count, 10);
    assertManualKept();
    const failedWire = await injection();
    assert.equal(failedWire.mediumTermText.includes("PRE_EDIT_FACT_T12"), false);
    assert.equal(failedWire.mediumTermText.includes("AUTO_T11_15"), false);

    failSummaryRange = null;
    await seal();
    assert.equal(recordAt(11)!.postManualEdit?.fromTurn, 13);
    assert.match((await injection()).mediumTermText, /\[최근 기억 · T13–15\]/);
  });

  it("source edit before the boundary re-seals the block without lowering the boundary", async () => {
    await saveManualAtT12();
    playTurnsThrough(21);
    await seal();
    reconcileMemoryAfterVariantSwitchCore(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      memoryTurnNumber: 11,
      sourceTurn: 11,
    });
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 12, "an edit on a covered turn is not new memory");
    const invalidated = await injection();
    assert.equal(invalidated.mediumTermText.includes("PRE_EDIT_FACT_T12"), false);

    await seal();
    assert.equal(memoryRow().global_covered_through_turn, 12);
    const wire = await injection();
    assert.match(wire.mediumTermText, /\[최근 기억 · T13–15\]\nAUTO_T13_15/);
    assert.equal(wire.mediumTermText.includes("PRE_EDIT_FACT_T12"), false);
  });

  it("deleting the last turns lowers the boundary; replayed turns count as new memory", async () => {
    await saveManualAtT12();
    const db = getDb();
    const lastTwo = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 2`)
      .all(CHAT) as { id: number }[];
    for (const { id } of lastTwo) db.prepare(`DELETE FROM messages WHERE id=?`).run(id);
    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "CoexistChar",
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 11);

    nextTurn = 12;
    playTurnsThrough(16);
    await seal();
    assert.equal(recordAt(11)!.postManualEdit?.fromTurn, 12);
    assert.match((await injection()).mediumTermText, /\[최근 기억 · T12–15\]/);
  });

  it("a manual save that lands while a seal is summarizing keeps its exact boundary", async () => {
    playTurnsThrough(16);
    let saved = false;
    onSummaryRange = async (range) => {
      if (range === "11~15" && !saved) {
        saved = true;
        await saveManual();
      }
    };
    await seal();

    assert.equal(saved, true);
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 16);
    assert.deepEqual(activeRecordStarts(), [1, 6], "the in-flight seal is rejected by the epoch guard");

    await seal();
    assertManualKept();
    assert.equal(memoryRow().global_covered_through_turn, 16, "the retry must not pull it back to the sealed frontier");
    assert.deepEqual(activeRecordStarts(), [1, 6, 11]);
    assert.equal(recordAt(11)!.postManualEdit, null);
    assert.equal((await injection()).mediumTermText, "", "T11–15 is covered by the save at T16");
  });

  it("automatic chats and edge-aligned saves never pay the extra call or store a slice", async () => {
    playTurnsThrough(21);
    await seal();
    assert.equal(summaryCalls, 4);
    const rows = getDb()
      .prepare(`SELECT scope_payload FROM chat_turn_summaries WHERE chat_id=?`)
      .all(CHAT) as { scope_payload: string | null }[];
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => !(row.scope_payload ?? "").includes("postManualEdit")));
    assert.equal(memoryRow().global_projection_kind, null);
  });
});

describe("I — post-save slice contract", () => {
  function record(over: Partial<MemoryRecordView>): MemoryRecordView {
    return {
      id: 1,
      turnStart: 11,
      turnEnd: 15,
      turnRangeLabel: "11~15턴",
      summary: "FULL_BLOCK",
      summaryKind: "main_canon",
      scopeLabel: "main_canon",
      scopes: { main_canon: "FULL_BLOCK" },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
      inactive: false,
      userEdited: false,
      charCount: 10,
      assistantMessageId: null,
      ...over,
    };
  }

  it("delivers nothing for covered records, the full body after the boundary, the slice in between", () => {
    assert.equal(resolveManualGlobalMediumDelivery(record({}), 15), null);
    assert.deepEqual(resolveManualGlobalMediumDelivery(record({}), 10), {
      deliveredFromTurn: 11,
      body: "FULL_BLOCK",
    });
    const sliced = record({ postManualEdit: { fromTurn: 13, scopes: { main_canon: "POST_SLICE" } } });
    assert.deepEqual(resolveManualGlobalMediumDelivery(sliced, 12), {
      deliveredFromTurn: 13,
      body: "POST_SLICE",
    });
  });

  it("fails closed when a straddling record has no usable slice, and honors a user-edited record", () => {
    assert.equal(resolveManualGlobalMediumDelivery(record({}), 12), null);
    const stale = record({ postManualEdit: { fromTurn: 12, scopes: { main_canon: "STALE" } } });
    assert.equal(resolveManualGlobalMediumDelivery(stale, 12), null);
    const empty = record({ postManualEdit: { fromTurn: 13, scopes: {} } });
    assert.equal(resolveManualGlobalMediumDelivery(empty, 12), null);
    const edited = record({ userEdited: true, summary: "USER_TEXT", scopes: { main_canon: "USER_TEXT" } });
    assert.deepEqual(resolveManualGlobalMediumDelivery(edited, 12), {
      deliveredFromTurn: 11,
      body: "USER_TEXT",
    });
  });

  it("branch lifecycle moves the slice the same way it moves the record", () => {
    assert.deepEqual(
      promotePostManualEditToBranch({ fromTurn: 13, scopes: { noncanon: "IF_BEAT" } }),
      { fromTurn: 13, scopes: { branch_canon: "IF_BEAT" } }
    );
    assert.deepEqual(
      adoptPostManualEditToMain({ fromTurn: 13, scopes: { branch_canon: "IF_BEAT" } }),
      { fromTurn: 13, scopes: { main_canon: "IF_BEAT" } }
    );
    assert.deepEqual(
      adoptPostManualEditToMain({ fromTurn: 13, scopes: { main_canon: "MAIN", branch_canon: "IF_BEAT" } }),
      { fromTurn: 13, scopes: { main_canon: "MAIN" } }
    );
  });
});
