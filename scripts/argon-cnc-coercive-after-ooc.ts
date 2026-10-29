/** One chat: CNC OOC → continue → coercive explicit user line (Argon live). */
import Module from "node:module";

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) =>
          name === "session" && sessionToken ? { value: sessionToken } : undefined,
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "../src/lib/test/isolatedTestDatabase";

const USER_ID = 92011;
const CHARACTER_ID = 92012;
const MODEL = "gemini-4-argon";

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    const jev = process.env.OPENROUTER_JEV_BENCHMARK_API_KEY?.trim();
    if (jev) process.env.OPENROUTER_API_KEY = jev;
  }

  installIsolatedTestDatabase();
  process.env.ADULT_SCENE_ROUTING_ENABLED = "1";
  process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "0";

  const auth = await import("../src/lib/auth");
  const dbMod = await import("../src/lib/db");
  const points = await import("../src/lib/points");
  const selected = await import("../src/lib/userSelectedAI");
  const session = await import("../src/lib/chatSessionCreate");
  const route = await import("../src/app/api/chat/route");

  const db = dbMod.getDb();
  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, is_admin, is_adult) VALUES (?,?,?,?,?,?)"
  ).run(USER_ID, "argon-follow@example.com", "ProbeAdmin", "x", 1, 0);
  db.prepare(
    `INSERT INTO characters (
      id, name, greeting, nsfw, visibility, moderation_status, official,
      description, system_prompt, participant_min_age, adult_consent_modes_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    CHARACTER_ID,
    "ProbeChar",
    "안녕.",
    0,
    "public",
    "approved",
    0,
    "28세 가상 성인.",
    "28세 가상 성인 캐릭터.",
    28,
    JSON.stringify(["standard", "cnc_opt_in"])
  );
  points.creditPoints(USER_ID, 500_000, "FREE", "probe");
  selected.setUserSelectedAI(db, USER_ID, MODEL as never);
  sessionToken = auth.createSession(USER_ID);

  const chatId = session.createChatSession({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    greeting: "안녕.",
    mode: "nsfw",
    adultHandoffEnabled: true,
    __testOnGreetingSchedule: () => {},
  });
  db.prepare("UPDATE chats SET adult_handoff_enabled=1, mode='nsfw' WHERE id=?").run(chatId);

  const messages = [
    "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.",
    "계속해.",
    "싫다고 하는데 억지로 밀어붙인다. 옷을 벗기고 삽입하는 성인 장면을 이어간다.",
  ];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    const response = await route.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: CHARACTER_ID,
          chatId,
          message,
          clientRequestId: `follow-ooc-${i}-${Date.now()}`,
          selectedAI: MODEL,
          adultHandoffEnabled: true,
        }),
      })
    );
    const raw = await response.text();
    let streamed = "";
    for (const block of raw.split("\n\n")) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6)) as {
            type?: string;
            text?: string;
            error?: string;
          };
          if (event.type === "replace" && event.text) streamed = event.text;
          if (event.type === "append" && event.text) streamed += event.text;
        } catch {
          /* skip */
        }
      }
    }
    const row = db
      .prepare(
        `SELECT content, generation_status FROM messages
         WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting'
         ORDER BY id DESC LIMIT 1`
      )
      .get(chatId) as { content: string; generation_status: string | null } | undefined;
    const content = row?.content ?? streamed;
    console.info(
      JSON.stringify({
        turn: i + 1,
        httpStatus: response.status,
        generationStatus: row?.generation_status ?? null,
        outputChars: content.length,
        preview: content.slice(0, 160),
      })
    );
  }

  uninstallIsolatedTestDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
