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
  closeActiveBranchCanon,
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  markMemoryRecordInactive,
  promoteRecordsToBranchCanon,
  updateMemoryRecordById,
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
let nextTurn = 1;

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
}

function playTurnsThrough(lastTurn: number): void {
  const db = getDb();
  for (; nextTurn <= lastTurn; nextTurn++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(CHAT, "user", `본편 턴 ${nextTurn}`).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(CHAT, "assistant", `응답 ${nextTurn} 대사`, "test", userMsgId);
  }
  const count = nextTurn - 1;
  updateChatMemory(CHAT, USER, CHAR, { message_count: count });
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
    const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(history[0]!.content);
    const start = Number(m![1]);
    const end = Number(m![2]);
    const tag = start === 1 ? "OLD_PROMISE_FACT_HANGANG_ACTIVE " : "";
    return { text: padBody(`${tag}AUTO_T${start}_${end}`) };
  });
  __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __setCompactCurrentMemoryTestOverride(null);
  if (savedEnv === undefined) delete process.env[ENV_MEMORY];
  else process.env[ENV_MEMORY] = savedEnv;
});

describe("A — normal 5-turn seal keeps the user's manual Global", () => {
  it("T10 manual save → T15 automatic seal: manual text, kind and new record all survive", async () => {
    playTurnsThrough(11);
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
    playTurnsThrough(11);
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
    playTurnsThrough(11);
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
    playTurnsThrough(11);
    await seal();
    await saveManual();
    const wire = await injection();
    assert.equal(wire.mediumTermText, "");
    assert.match(wire.text, /USER_MANUAL_GLOBAL/);
  });
});

describe("C — user correction wins over older automatic records", () => {
  it("a corrected promise in the manual text is not contradicted by the old automatic record", async () => {
    playTurnsThrough(11);
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
    playTurnsThrough(11);
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
    playTurnsThrough(11);
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
    playTurnsThrough(11);
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
    playTurnsThrough(101);
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
