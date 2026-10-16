/**
 * Seeds one synthetic chat into the SQLite DB under $DATA_DIR (isolated copy, never production):
 * a signed-in user, a chat with 25 completed turns, 5-turn records sealed through the real
 * rolling-summary path (stubbed summarizer, no provider call), and a user-saved Global at T10.
 *
 *   DATA_DIR=/tmp/x MEMORY_FEATURE_ENABLED=1 OPENROUTER_API_KEY= CHEAPER_INFERENCE_API_KEY= OPENAI_API_KEY= \
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-manual-memory-coexist/seed-synthetic-chat.mts
 *
 * Prints JSON { token, chatId, characterId }.
 */
import Module from "module";
import crypto from "node:crypto";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

if (!process.env.DATA_DIR) throw new Error("DATA_DIR must point at the isolated verification directory");
process.env.MEMORY_FEATURE_ENABLED = "1";

const { getDb } = await import("@/lib/db");
const { MEMORY_CAPACITY_FIXED } = await import("@/lib/memory/memory-capacity-shared");
const { getOrCreateChatMemory, updateChatMemory } = await import("@/lib/memory/memory-db");
const { updateLorebookForChat } = await import("@/lib/memory/memory-manager");
const {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
} = await import("@/lib/memory/memory-rolling-summary");

const MANUAL_TEXT =
  "[직접 정리한 장기기억] 주인공은 편의점 알바생 히유의 단골이다. 금요일 한강 야경 약속은 히유의 근무 사정으로 취소되었고 지금은 유효하지 않다. 청동열쇠는 편의점 뒤편 공동 보관함 3번에 맡겨 두었다.";

const SENTENCES = [
  "주인공은 퇴근길에 편의점에 들러 알바생 히유와 평소처럼 짧은 안부를 나눴다.",
  "히유는 야간 근무 중이라 피곤해 보였지만 단골인 주인공에게는 늘 신메뉴 도시락을 먼저 권했다.",
  "두 사람은 금요일 저녁 한강에서 야경을 보기로 약속했고, 시간과 장소를 서로 확인했다.",
  "약속 당일 히유는 갑작스러운 근무 교대 때문에 나갈 수 없게 되었다며 사과했고, 주인공은 괜찮다고 답했다.",
  "한강 약속은 결국 미뤄졌고 둘은 다음에 다시 정하자고 말했지만 구체적인 날짜는 잡지 않았다.",
  "주인공은 히유에게 청동열쇠를 맡기며 편의점 뒤편 공동 보관함에 넣어 두라고 부탁했다.",
  "히유는 열쇠를 받아 보관함 번호를 메모해 두었고, 주인공에게 잊지 말고 찾아가라고 당부했다.",
  "비가 오던 밤에는 우산이 없어 곤란해하던 주인공에게 히유가 여분의 우산을 빌려주었다.",
  "주인공은 다음 날 우산을 돌려주며 감사의 표시로 따뜻한 캔커피를 건넸다.",
  "두 사람의 대화는 점점 길어졌고, 히유는 자신이 소설을 쓰고 싶다는 속마음을 처음 털어놓았다.",
];

function summaryFor(start: number, end: number): string {
  const offset = Math.floor((start - 1) / 5);
  let body = `[T${start}–${end} 자동 기록] `;
  for (let i = 0; body.length < 430; i++) {
    body += `${SENTENCES[(offset * 3 + i) % SENTENCES.length]} `;
  }
  return body.trim().slice(0, 590);
}

__setSummarizeTurnBatchCallerForTests(async (_system, history) => {
  const m = /\[(\d+)~(\d+)턴 원본 대화\]/.exec(history[0]!.content);
  return { text: summaryFor(Number(m![1]), Number(m![2])) };
});
__setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));

const db = getDb();
const USER_ID = 880001;
const CHAT_ID = 880101;
const character = db
  .prepare(`SELECT id FROM characters WHERE id=2`)
  .get() as { id: number } | undefined;
if (!character) throw new Error("seeded character id=2 not found");
const CHARACTER_ID = character.id;

db.prepare(
  `INSERT OR REPLACE INTO users (id, email, nickname, pw_hash, is_adult, points) VALUES (?,?,?,?,1,2000)`
).run(USER_ID, "memory-verify@test.local", "기억검증", "x");
db.prepare(`DELETE FROM chat_turn_summaries WHERE chat_id=?`).run(CHAT_ID);
db.prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
db.prepare(`DELETE FROM messages WHERE chat_id=?`).run(CHAT_ID);
db.prepare(`DELETE FROM chats WHERE id=?`).run(CHAT_ID);
db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
  CHAT_ID,
  USER_ID,
  CHARACTER_ID
);
getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, "free");
db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
  CHAT_ID,
  "assistant",
  "어서 오세요. 오늘도 야간 근무라 졸려요.",
  "greeting"
);

let played = 0;
function play(lastTurn: number): void {
  for (let t = played + 1; t <= lastTurn; t++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(CHAT_ID, "user", `(${t}번째) 히유에게 말을 건다. "오늘은 뭐 재밌는 일 없었어요?"`)
      .lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(
      CHAT_ID,
      "assistant",
      `히유가 계산대 너머에서 웃으며 대답했다. "${t}번째 손님 응대가 끝나면 이야기해 드릴게요."`,
      "test",
      userMsgId
    );
  }
  played = lastTurn;
  updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, { message_count: lastTurn });
}

const sealOpts = {
  chatId: CHAT_ID,
  userId: USER_ID,
  characterId: CHARACTER_ID,
  charName: "캐릭터",
  tier: "free" as const,
  memoryCapacity: MEMORY_CAPACITY_FIXED,
  maxRounds: 12,
};

play(11);
await catchUpRollingSummaries(sealOpts);
await updateLorebookForChat(CHAT_ID, USER_ID, CHARACTER_ID, MANUAL_TEXT, "free", MEMORY_CAPACITY_FIXED);
play(26);
await catchUpRollingSummaries(sealOpts);

const token = crypto.randomBytes(32).toString("hex");
db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(
  token,
  USER_ID,
  new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
);

__setSummarizeTurnBatchCallerForTests(null);
__setCompactCurrentMemoryTestOverride(null);
console.log(JSON.stringify({ token, chatId: CHAT_ID, characterId: CHARACTER_ID, manualText: MANUAL_TEXT }));
