import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import {
  TABLE_STATUS,
  TEXT_3200,
  TEXT_5200,
  TEXT_RICH,
  TEXT_SHORT,
  TEXT_USER_LONG,
  TEXT_USER_SHORT,
  USER_LINES,
} from "./e43e-texts";

const db = getDb();
db.exec(
  "DELETE FROM messages; DELETE FROM chats; DELETE FROM characters; DELETE FROM user_personas;",
);

function user(email: string, nick: string, o: { adult: number; nsfw_on: number; admin: number }) {
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  if (ex) {
    db.prepare("UPDATE users SET nickname=?, is_adult=?, nsfw_on=?, is_admin=?, points=2000 WHERE id=?").run(
      nick, o.adult, o.nsfw_on, o.admin, ex.id,
    );
    return ex.id;
  }
  return Number(
    db
      .prepare("INSERT INTO users (email,nickname,pw_hash,points,is_adult,nsfw_on,is_admin) VALUES (?,?,?,?,?,?,?)")
      .run(email, nick, "x", 2000, o.adult, o.nsfw_on, o.admin).lastInsertRowid,
  );
}
const creator = user("creator@e43e.local", "소설가하루", { adult: 1, nsfw_on: 0, admin: 0 });
const U = {
  std: user("std@e43e.local", "일반회원", { adult: 1, nsfw_on: 1, admin: 0 }),
  minor: user("minor@e43e.local", "미성년회원", { adult: 0, nsfw_on: 0, admin: 0 }),
  adult: user("adult@e43e.local", "성인인증회원", { adult: 1, nsfw_on: 1, admin: 1 }),
};

const POSTER = "/uploads/g-poster.webp";
const asset = (url: string, tag: string, o: Record<string, unknown> = {}) => ({
  url, tag, public: true, chat: true, ...o,
});
const GALLERY = [
  asset(POSTER, "대표", { representativeRank: 1 }),
  asset("/uploads/g-b.webp", "미소"),
  asset("/uploads/g-3.webp", "비밀", { viewerBlur: true }),
  asset("/uploads/g-wide1.webp", "장면"),
];

const cols =
  "name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, total_turns, audience, likes, status_widget_json";
const widgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
function character(name: string, nsfw: number, greeting: string, widget: string) {
  return Number(
    db
      .prepare(`INSERT INTO characters (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`)
      .run(
        name, "달빛 아래서만 문을 여는 고서점의 주인", "고서점 주인", greeting, "s", "현대 판타지",
        JSON.stringify(["고서점"]), nsfw, 1, "✨", 260, creator, "공식계정", "public", "approved",
        JSON.stringify([POSTER]), JSON.stringify(GALLERY), 10, "all", 10, widget,
      ).lastInsertRowid,
  );
}
const GREETING =
  "달빛이 가장 얇아지는 밤, 서점의 종이 울렸다. \"어서 오십시오. 문이 닫히기 전에 도착하셨군요.\"";
const C_MAIN = character("세라핀 에르하르트", 0, GREETING, widgetJson);
const C_ADULT = character("성인 전용 캐릭터", 1, GREETING, "");

const model = MAIN_RP_MODEL_IDS[0] as string;
function chat(userId: number, characterId: number, title: string, minAgo: number) {
  return Number(
    db
      .prepare("INSERT INTO chats (user_id,character_id,title,created_at) VALUES (?,?,?,datetime('now', ?))")
      .run(userId, characterId, title, `-${minAgo} minutes`).lastInsertRowid,
  );
}
function msg(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  extra: { model?: string; statusMeta?: unknown; widgetValues?: unknown } = {},
) {
  return Number(
    db
      .prepare(
        "INSERT INTO messages (chat_id,role,content,model,status_meta,status_widget_values_json,status_widget_turn_active) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        chatId, role, content, extra.model ?? (role === "assistant" ? model : ""),
        extra.statusMeta ? JSON.stringify(extra.statusMeta) : null,
        extra.widgetValues ? JSON.stringify(extra.widgetValues) : "{}",
        extra.widgetValues ? 1 : 0,
      ).lastInsertRowid,
  );
}

const chats: Record<string, number> = {};
chats.new = chat(U.std, C_MAIN, "새 대화", 5);
msg(chats.new, "assistant", GREETING, { model: "greeting" });

chats.short = chat(U.std, C_MAIN, "짧은 답변", 10);
msg(chats.short, "assistant", GREETING, { model: "greeting" });
msg(chats.short, "user", TEXT_USER_SHORT);
msg(chats.short, "assistant", TEXT_SHORT);

chats.c3200 = chat(U.std, C_MAIN, "3,200자 답변", 15);
msg(chats.c3200, "assistant", GREETING, { model: "greeting" });
msg(chats.c3200, "user", TEXT_USER_LONG);
msg(chats.c3200, "assistant", TEXT_3200);

chats.c5200 = chat(U.std, C_MAIN, "5,000자 이상 답변", 20);
msg(chats.c5200, "assistant", GREETING, { model: "greeting" });
msg(chats.c5200, "user", TEXT_USER_LONG);
msg(chats.c5200, "assistant", TEXT_5200);

chats.rich = chat(U.std, C_MAIN, "위젯·표·HTML·이미지", 25);
msg(chats.rich, "assistant", GREETING, { model: "greeting" });
msg(chats.rich, "user", TEXT_USER_SHORT);
msg(chats.rich, "assistant", TEXT_RICH, {
  statusMeta: {
    meta: {
      tableMarkdown:
        "| 항목 | 값 |\n| :-- | :-- |\n| 시각 | 새벽 3시 40분 |\n| 장소 | 달빛 서가 안쪽 |\n| 관계 | 경계 → 호기심 |",
    },
    extractedAt: new Date().toISOString(),
    source: "background-deepseek",
    formatSpec: "| 항목 | 값 |\n| :-- | :-- |\n| 시각 | |\n| 장소 | |\n| 관계 | |",
  },
  widgetValues: {
    character: {
      시간: "새벽 3시 40분",
      장소: "달빛 서가 안쪽, 난로 앞",
      현재상황: "손님이 처음으로 잊고 싶은 문장을 꺼내려 한다",
      현재목표: "손님의 이야기를 끝까지 듣는다",
      속마음: "이번에는 마지막 장을 채울 사람일까 → 아직 모른다 → 그래도 문은 열렸다",
    },
  },
});

chats.table = chat(U.std, C_MAIN, "상태창 표", 27);
msg(chats.table, "assistant", GREETING, { model: "greeting" });
msg(chats.table, "user", "(OOC: 현재 상태창을 표로 보여줘)");
msg(chats.table, "assistant", [TEXT_SHORT, TABLE_STATUS].join("\n\n"));

chats.failed = chat(U.std, C_MAIN, "생성 실패", 28);
msg(chats.failed, "assistant", GREETING, { model: "greeting" });
msg(chats.failed, "user", TEXT_USER_SHORT);
const failedId = msg(chats.failed, "assistant", TEXT_3200.slice(0, 900));
db.prepare("UPDATE messages SET generation_status='failed_partial' WHERE id=?").run(failedId);

chats.long = chat(U.std, C_MAIN, "긴 기존 대화", 120);
msg(chats.long, "assistant", GREETING, { model: "greeting" });
for (let i = 0; i < 10; i++) {
  msg(chats.long, "user", USER_LINES[i % USER_LINES.length]!);
  msg(chats.long, "assistant", i % 3 === 0 ? TEXT_3200 : i % 3 === 1 ? TEXT_SHORT : TEXT_3200.slice(0, 1800));
}
msg(chats.long, "user", TEXT_USER_LONG);
msg(chats.long, "assistant", TEXT_5200);

chats.adult = chat(U.adult, C_ADULT, "성인 접근 가능", 30);
msg(chats.adult, "assistant", GREETING, { model: "greeting" });
msg(chats.adult, "user", TEXT_USER_SHORT);
msg(chats.adult, "assistant", TEXT_3200.slice(0, 1500));

chats.blocked = chat(U.minor, C_ADULT, "성인 차단", 30);
msg(chats.blocked, "assistant", GREETING, { model: "greeting" });

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(
    tok, uid, new Date(Date.now() + 864e5).toISOString(),
  );
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43e-fixtures.json", JSON.stringify({ tokens, chats, chars: { main: C_MAIN, adult: C_ADULT } }, null, 1));
console.log(JSON.stringify({ chats, C_MAIN, C_ADULT }));
