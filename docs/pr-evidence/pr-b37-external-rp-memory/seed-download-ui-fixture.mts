/**
 * Seeds an isolated dev DB (DATA_DIR) with TEST-ONLY messages for the download UI/route check.
 * No personal conversation. Prints cookies for two users so the route can be exercised for
 * 200 / 401 / 404 (other user's chat).
 *
 *   DATA_DIR=/tmp/b37/devdata SESSION_SECRET=... node --conditions=react-server --import tsx \
 *     docs/pr-evidence/pr-b37-external-rp-memory/seed-download-ui-fixture.mts [turns]
 */
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const TURNS = Number(process.argv[2] ?? "120");
const { getDb } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth");
const { createChatSession } = await import("@/lib/chatSessionCreate");

const db = getDb();
function user(id: number, email: string, nickname: string) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, is_adult) VALUES (?,?,?,?,1)").run(
    id,
    email,
    nickname,
    "x"
  );
}
user(9201, "download-test-a@example.com", "테스터A");
user(9202, "download-test-b@example.com", "테스터B");
db.prepare(
  `INSERT OR IGNORE INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official, description, system_prompt)
   VALUES (9203,'테스트 캐릭터','안녕하세요. 테스트 인사말입니다.',0,'public','approved',1,'테스트 캐릭터 설명','테스트')`
).run();
db.prepare("INSERT OR IGNORE INTO user_personas (id, user_id, name, description) VALUES (9204, 9201, '테스트 페르소나', '설명')").run();

const chatId = createChatSession({
  userId: 9201,
  characterId: 9203,
  greeting: "안녕하세요. 테스트 인사말입니다.",
  selectedPersonaId: 9204,
  __testOnGreetingSchedule: () => {},
});
db.prepare("UPDATE chats SET title='다운로드 테스트 방' WHERE id=?").run(chatId);

const insertMsg = db.prepare(
  `INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant)
   VALUES (?,?,?,?, 'completed', ?, ?)`
);
for (let i = 1; i <= TURNS; i += 1) {
  insertMsg.run(chatId, "user", `테스트 유저 발화 ${i} *손을 흔들었다* OOC: 테스트 ${i}`, "", "[]", 0);
  const body = `테스트 응답 ${i} — "대사입니다."\n\n**굵게** <div style="color:#aaa">HP ${i}</div> 😀`;
  if (i === 3) {
    const variants = [
      { content: "폐기된 첫 번째 재생성 후보", model: "test", usage: null, created_at: "" },
      { content: body, model: "test", usage: null, created_at: "" },
    ];
    insertMsg.run(chatId, "assistant", body, "test", JSON.stringify(variants), 1);
  } else {
    insertMsg.run(chatId, "assistant", body, "test", "[]", 0);
  }
}
db.prepare("INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant) VALUES (?,?,?,?,?,'[]',0)").run(
  chatId,
  "user",
  "응답 실패로 남은 고아 유저 메시지",
  "",
  "completed"
);

const otherChat = createChatSession({
  userId: 9202,
  characterId: 9203,
  greeting: "다른 사용자의 인사말",
  __testOnGreetingSchedule: () => {},
});
db.prepare("INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant) VALUES (?,?,?,?,?,'[]',0)").run(
  otherChat,
  "user",
  "다른 사용자 비공개 메시지",
  "",
  "completed"
);
db.prepare("INSERT INTO messages (chat_id, role, content, model, generation_status, alternates, active_variant) VALUES (?,?,?,?,?,'[]',0)").run(
  otherChat,
  "assistant",
  "다른 사용자 비공개 응답",
  "test",
  "completed"
);

console.log(
  JSON.stringify({
    chatId,
    otherChat,
    cookieA: createSession(9201),
    cookieB: createSession(9202),
    characterId: 9203,
  })
);
process.exit(0);
