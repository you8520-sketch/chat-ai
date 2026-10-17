import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { after, before, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { __setSummarizeTurnBatchCallerForTests, processRollingSummaryBatch } from "./memory-rolling-summary";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { listMemoryRecordsForChat, rebuildLorebookFromRecords } from "./memory-turn-summary";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";

const CHAR = "라이크";
const OUT = process.env.AB_OUT ?? "/tmp/cp";
const results: Record<string, unknown> = {};
before(() => { installIsolatedTestDatabase(); process.env.MEMORY_FEATURE_ENABLED = "1"; });
after(() => { __setSummarizeTurnBatchCallerForTests(null); mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/contract-pipeline.json`, JSON.stringify(results, null, 2)); uninstallIsolatedTestDatabase(); });

const NORMAL = [
  "렌이 아마추어 같다고 하자 라이크는 입술을 깨물며 시선을 피함. 이후 검술에 대한 자존심이 흔들렸을 가능성이 있음.",
  "렌이 심했다며 사과함. 이후 라이크는 굳은 표정을 풀고 렌의 손을 잡으며 천천히 숨을 고름.",
  "렌이 마을에 도착해 라이크에게 검을 건넴. 그때 라이크는 말없이 검을 받아 들고 렌을 오래 바라봄.",
  "렌이 오늘의 잡담을 이어 가자 라이크는 장작을 쌓으며 짧게 대꾸함. 그동안 렌은 곁에서 불을 쬐며 기다림.",
];
const FIRST_USER = "솔직히 너 좀 아마추어 같아.";

function run(label: string, persona: string, userId: number) {
  return async () => {
    const chatId = userId + 1, charId = userId + 2;
    const db = getDb();
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(userId, `c-${userId}@t.l`, "렌", "x");
    db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, CHAR);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(chatId, userId, charId);
    getOrCreateChatMemory(chatId, userId, charId, "pro");
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "assistant", "인사.", "greeting");
    for (let t = 1; t <= 40; t++) {
      const uid = Number(db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "user", t === 1 ? FIRST_USER : `오늘의 잡담 ${t}`, "user").lastInsertRowid);
      db.prepare(`INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status) VALUES (?,?,?,?,?,'completed')`).run(chatId, "assistant", `라이크는 ${t}번째 장작을 쌓았다.`, "test", uid);
    }
    updateChatMemory(chatId, userId, charId, { message_count: 40, membership_tier: "pro" } as never);
    const frontier = Number(db.prepare(`INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`).run(chatId, "user", "다음 입력").lastInsertRowid);
    let calls = 0;
    let n = 0;
    __setSummarizeTurnBatchCallerForTests(async (_s, history) => {
      calls += 1;
      const start = Number(history.map((m) => m.content).join("\n").match(/\[(\d+)~\d+턴 원본 대화\]/)?.[1] ?? "1");
      const base = NORMAL[Math.floor((start - 1) / 5) % NORMAL.length]!;
      return { text: `${base} 둘은 오늘의 잡담을 나누며 장작을 쌓음. 장작더미가 조금씩 높아짐.` };
    });
    // each stubbed call returns the same normal summary per batch attempt; retries repeat the identical rejected text
    let sealed = 0;
    for (let round = 0; round < 12; round++) {
      n = calls;
      const ok = await processRollingSummaryBatch({ chatId, userId, characterId: charId, charName: CHAR, tier: "pro", memoryCapacity: MEMORY_CAPACITY_FIXED, userPersona: persona } as never);
      if (!ok) break;
      sealed += 1;
    }
    db.prepare("DELETE FROM messages WHERE id=?").run(frontier);
    const recs = listMemoryRecordsForChat(chatId).filter((r) => !r.inactive);
    results[label] = { batchesAttemptedSealOk: sealed, providerCallsMade: calls, persistedRecords: recs.length, firstRecord: recs[0]?.summary ?? null, currentMemoryChars: rebuildLorebookFromRecords(chatId).length };
    void n;
  };
}
it("bare (route today)", run("bare_route_today", "렌", 971000));
it("labelled (persona-only fix)", run("labelled_background_identity", formatSelectedPersonaIdentityForBackground("렌", "male")!, 972000));
