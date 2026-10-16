/**
 * Final-wire measurement for "user-saved Global + automatic 5-turn records".
 * Runs against an isolated SQLite DB with a stubbed summarizer (no provider call).
 *
 *   node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts \
 *     docs/pr-evidence/pr-manual-memory-coexist/wire-compare.mts <label>
 *
 * Prints one JSON document: per-step manual/auto/wire numbers for a manual chat and an
 * automatic (control) chat. The same script runs unchanged on main and on the PR branch.
 */
import Module from "module";
import { createHash } from "node:crypto";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

const MEMORY_FLAG = "MEMORY_FEATURE_ENABLED";
process.env[MEMORY_FLAG] = "1";

const { getDb } = await import("@/lib/db");
const { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } = await import(
  "@/lib/test/isolatedTestDatabase"
);
const { MEMORY_CAPACITY_FIXED } = await import("@/lib/memory/memory-capacity-shared");
const { getChatMemoryRow, getOrCreateChatMemory, updateChatMemory } = await import(
  "@/lib/memory/memory-db"
);
const { buildMemoryContextForChat, updateLorebookForChat } = await import(
  "@/lib/memory/memory-manager"
);
const { measureMediumGlobalLiteralDuplicateChars } = await import(
  "@/lib/memory/memory-medium-term"
);
const {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
} = await import(
  "@/lib/memory/memory-rolling-summary"
);
const { listMemoryRecordsForChat } = await import("@/lib/memory/memory-turn-summary");
const { estimateTokens } = await import("@/lib/tokenEstimate");

const label = process.argv[2] ?? "run";
const USER = 997201;
const CHAR = 997203;
const MANUAL_TEXT =
  "[직접 정리한 장기기억] 주인공(유저)은 편의점 알바생 히유와 단골 사이다. 금요일 한강 야경 약속은 히유의 사정으로 취소되었고, 지금은 유효하지 않다. 둘은 청동열쇠를 공동 보관함에 맡겨 두었다.";

installIsolatedTestDatabase();
const db = getDb();
db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
  USER,
  `wire-${USER}@test.local`,
  "wire-owner",
  "x"
);
db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "WireChar");

let summaryProviderCalls = 0;
__setSummarizeTurnBatchCallerForTests(async (_system, history) => {
  summaryProviderCalls += 1;
  const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(history[0]!.content);
  const start = Number(m![1]);
  const end = Number(m![2]);
  let body = `AUTO_T${start}_${end}: 두 사람은 편의점에서 ${start}~${end}턴 사이에 일상 대화를 이어 갔고 작은 사건이 하나 있었다`;
  while (body.length < 420) body += ` → AUTO_T${start}_${end}_detail`;
  return { text: body.slice(0, 420) };
});

let compactProviderCalls = 0;
__setCompactCurrentMemoryTestOverride(async (input, max) => {
  compactProviderCalls += 1;
  return input.slice(0, max);
});

type Chat = { id: number; played: number; summaryCalls: number; compactCalls: number };

function createChat(id: number): Chat {
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    id,
    USER,
    CHAR
  );
  getOrCreateChatMemory(id, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    id,
    "assistant",
    "인사.",
    "greeting"
  );
  return { id, played: 0, summaryCalls: 0, compactCalls: 0 };
}

function play(chat: Chat, lastTurn: number): void {
  for (let t = chat.played + 1; t <= lastTurn; t++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(chat.id, "user", `본편 턴 ${t}`).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(chat.id, "assistant", `응답 ${t} 대사`, "test", userMsgId);
  }
  chat.played = lastTurn;
  updateChatMemory(chat.id, USER, CHAR, { message_count: lastTurn });
}

async function seal(chat: Chat): Promise<void> {
  const opts = {
    chatId: chat.id,
    userId: USER,
    characterId: CHAR,
    charName: "WireChar",
    tier: "free" as const,
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    maxRounds: 12,
  };
  const summaryBefore = summaryProviderCalls;
  const compactBefore = compactProviderCalls;
  while ((await catchUpRollingSummaries(opts)) >= opts.maxRounds) {
    // drain backlog
  }
  chat.summaryCalls += summaryProviderCalls - summaryBefore;
  chat.compactCalls += compactProviderCalls - compactBefore;
}

async function assemble(chat: Chat) {
  return buildMemoryContextForChat({
    chatId: chat.id,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: "이어서 진행해줘",
  });
}

async function measure(chat: Chat, step: string, manualText: string | null) {
  const injection = await assemble(chat);
  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    await assemble(chat);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const row = getChatMemoryRow(chat.id)!;
  const records = listMemoryRecordsForChat(chat.id).filter((r) => !r.inactive);
  const mediumRanges = [...injection.mediumTermText.matchAll(/\[최근 기억 · T(\d+)–(\d+)\]/g)].map(
    (m) => `T${m[1]}-${m[2]}`
  );
  const wire = `${injection.text}\n--MEDIUM--\n${injection.mediumTermText}`;
  const manualKept =
    manualText != null &&
    row.recent_summary === manualText &&
    row.global_projection_kind === "manual_global";
  return {
    step,
    playedTurns: chat.played,
    storedKind: row.global_projection_kind,
    manualTextChars: manualText?.length ?? 0,
    manualKept,
    manualInWire: manualText != null && injection.text.includes(manualText),
    autoRecordsStored: records.length,
    globalChars: injection.text.length,
    mediumChars: injection.mediumTermText.length,
    mediumBlocks: mediumRanges,
    globalMediumDuplicateChars: measureMediumGlobalLiteralDuplicateChars(
      injection.mediumTermText,
      injection.text
    ),
    wireMemoryChars: injection.text.length + injection.mediumTermText.length,
    wireMemoryTokensEst: estimateTokens(wire),
    assemblyMsMedian: Number(samples[Math.floor(samples.length / 2)]!.toFixed(3)),
    summaryModelCallsThisChat: chat.summaryCalls,
    globalCompactModelCallsThisChat: chat.compactCalls,
    wireSha256: createHash("sha256").update(wire).digest("hex").slice(0, 16),
  };
}

const manualChat = createChat(997211);
const autoChat = createChat(997212);
const manualSteps: Awaited<ReturnType<typeof measure>>[] = [];
const autoSteps: Awaited<ReturnType<typeof measure>>[] = [];

play(manualChat, 11);
play(autoChat, 11);
await seal(manualChat);
await seal(autoChat);
manualSteps.push(await measure(manualChat, "T10 sealed (before manual save)", null));
await updateLorebookForChat(manualChat.id, USER, CHAR, MANUAL_TEXT, "free", MEMORY_CAPACITY_FIXED);
manualSteps.push(await measure(manualChat, "T10 manual save", MANUAL_TEXT));
autoSteps.push(await measure(autoChat, "T10 sealed", null));

for (const target of [16, 21, 26, 51, 101, 131]) {
  play(manualChat, target);
  play(autoChat, target);
  await seal(manualChat);
  await seal(autoChat);
  manualSteps.push(await measure(manualChat, `T${target - 1} normal seal`, MANUAL_TEXT));
  autoSteps.push(await measure(autoChat, `T${target - 1} normal seal`, null));
}

console.log(
  JSON.stringify(
    {
      label,
      node: process.version,
      providerCallsOutsideSummaryStub: 0,
      note: "summarizer and Global compaction stubbed (counted); no network, no provider keys",
      manualChat: manualSteps,
      automaticControlChat: autoSteps,
    },
    null,
    2
  )
);

__setSummarizeTurnBatchCallerForTests(null);
__setCompactCurrentMemoryTestOverride(null);
uninstallIsolatedTestDatabase();
