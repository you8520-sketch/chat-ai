/**
 * Read-only final-wire probe against an existing isolated DB (DATA_DIR) — prints the memory sections the
 * next Main RP prompt would receive (same builder as POST /api/chat). Optionally appends turns and seals
 * them first (stubbed summarizer, no provider call): ADD_TURNS_THROUGH=<n>.
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

if (!process.env.DATA_DIR) throw new Error("DATA_DIR required");
process.env.MEMORY_FEATURE_ENABLED = "1";
const CHAT_ID = Number(process.env.CHAT_ID ?? 880101);
const USER_ID = 880001;
const CHARACTER_ID = 2;

const { getDb } = await import("@/lib/db");
const { MEMORY_CAPACITY_FIXED } = await import("@/lib/memory/memory-capacity-shared");
const { updateChatMemory, getChatMemoryRow } = await import("@/lib/memory/memory-db");
const { buildMemoryContextForChat } = await import("@/lib/memory/memory-manager");
const {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
} = await import("@/lib/memory/memory-rolling-summary");
const { estimateTokens } = await import("@/lib/tokenEstimate");

const db = getDb();
const addThrough = Number(process.env.ADD_TURNS_THROUGH ?? 0);
if (addThrough > 0) {
  __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
    const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(history[0]!.content);
    const start = Number(m![1]);
    const end = Number(m![2]);
    let body = `[T${start}–${end} 자동 기록] 주인공과 히유는 편의점에서 ${start}~${end}턴 동안 새 대화를 이어 갔다. `;
    while (body.length < 430) body += `두 사람은 일상 이야기를 나누며 관계를 조금씩 쌓아 갔다. `;
    return { text: body.trim().slice(0, 590) };
  });
  __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));
  const played = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM messages WHERE chat_id=? AND role='assistant' AND generation_status='completed'`
      )
      .get(CHAT_ID) as { n: number }
  ).n;
  for (let t = played + 1; t <= addThrough; t++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(CHAT_ID, "user", `(${t}번째) 히유에게 말을 건다.`).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(CHAT_ID, "assistant", `히유가 대답했다. (${t})`, "test", userMsgId);
  }
  updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, { message_count: addThrough });
  await catchUpRollingSummaries({
    chatId: CHAT_ID,
    userId: USER_ID,
    characterId: CHARACTER_ID,
    charName: "캐릭터",
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    maxRounds: 12,
  });
}

const injection = await buildMemoryContextForChat({
  chatId: CHAT_ID,
  userId: USER_ID,
  characterId: CHARACTER_ID,
  tier: "free",
  memoryCapacity: MEMORY_CAPACITY_FIXED,
  userMessage: "이어서 진행해줘",
});
const row = getChatMemoryRow(CHAT_ID)!;
console.log(
  JSON.stringify({
    storedKind: row.global_projection_kind,
    storedBoundary: row.global_covered_through_turn,
    globalHead: injection.text.slice(0, 70),
    globalChars: injection.text.length,
    mediumBlocks: [...injection.mediumTermText.matchAll(/\[최근 기억 · T(\d+)–(\d+)\]/g)].map(
      (m) => `T${m[1]}-${m[2]}`
    ),
    mediumChars: injection.mediumTermText.length,
    wireMemoryTokensEst: estimateTokens(`${injection.text}\n${injection.mediumTermText}`),
    globalContainsManualMarker: injection.text.includes("[직접 정리한 장기기억]"),
  })
);
__setSummarizeTurnBatchCallerForTests(null);
__setCompactCurrentMemoryTestOverride(null);
