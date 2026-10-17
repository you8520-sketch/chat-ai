import Module from "module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { after, before, it } from "node:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { getDb } from "@/lib/db";
import { callBackgroundMemory } from "@/lib/ai";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { __setSummarizeTurnBatchCallerForTests, processRollingSummaryBatch } from "./memory-rolling-summary";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { listMemoryRecordsForChat, rebuildLorebookFromRecords } from "./memory-turn-summary";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";

const DIR = "/opt/cursor/artifacts/gate4";
const ARM = process.env.ARM ?? "A";
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const CALL_CAP = Number(process.env.CALL_CAP ?? 120);
const CHAR = "라이크";
const persona = ARM === "A" ? "렌" : formatSelectedPersonaIdentityForBackground("렌", "male")!;
const sources = JSON.parse(readFileSync(`${DIR}/sources.json`, "utf8")) as Record<string, { kind: string; turns: { user: string; assistant: string }[] }>;
const out: Record<string, unknown> = existsSync(`${DIR}/seal-${ARM}.json`) ? JSON.parse(readFileSync(`${DIR}/seal-${ARM}.json`, "utf8")) : {};
let calls = 0;
let costUsd = 0;
before(() => { installIsolatedTestDatabase(); process.env.MEMORY_FEATURE_ENABLED = "1"; });
after(() => { __setSummarizeTurnBatchCallerForTests(null); mkdirSync(DIR, { recursive: true }); writeFileSync(`${DIR}/seal-${ARM}.json`, JSON.stringify(out, null, 2)); writeFileSync(`${DIR}/seal-${ARM}-cost.json`, JSON.stringify({ calls, costUsd }, null, 2)); uninstallIsolatedTestDatabase(); });

let n = 0;
for (const [id, src] of Object.entries(sources)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  if (out[id]) continue;
  const idx = ++n;
  it(`${ARM} ${id}`, async () => {
    if (calls >= CALL_CAP) { out[id] = { skipped: "CALL_CAP" }; return; }
    const userId = 990000 + idx * 10, chatId = userId + 1, charId = userId + 2;
    const db = getDb();
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(userId, `l-${userId}@t.l`, "렌", "x");
    db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, CHAR);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(chatId, userId, charId);
    getOrCreateChatMemory(chatId, userId, charId, "pro");
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "assistant", "인사.", "greeting");
    const turns = [...src.turns, ...Array.from({ length: 4 }, (_, i) => ({ user: `잡담 ${i}`, assistant: `라이크는 고개를 끄덕였다. ${i}` }))];
    for (const t of turns) {
      const uid = Number(db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "user", t.user, "user").lastInsertRowid);
      db.prepare(`INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status) VALUES (?,?,?,?,?,'completed')`).run(chatId, "assistant", t.assistant, "test", uid);
    }
    updateChatMemory(chatId, userId, charId, { message_count: turns.length, membership_tier: "pro" } as never);
    const frontier = Number(db.prepare(`INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`).run(chatId, "user", "다음 입력").lastInsertRowid);
    const attempts: { text: string; usd: number | null }[] = [];
    let userContent = "";
    __setSummarizeTurnBatchCallerForTests(async (system, history, trace, kind) => {
      calls += 1;
      userContent = history.map((m) => m.content).join("\n");
      const r = await callBackgroundMemory(system, history, trace, kind);
      const usd = (r.usage as unknown as { cheaperInferenceBilledCostUsd?: number }).cheaperInferenceBilledCostUsd ?? null;
      costUsd += usd ?? 0;
      attempts.push({ text: r.text, usd });
      return r;
    });
    const ok = await processRollingSummaryBatch({ chatId, userId, characterId: charId, charName: CHAR, tier: "pro", memoryCapacity: MEMORY_CAPACITY_FIXED, userPersona: persona } as never);
    db.prepare("DELETE FROM messages WHERE id=?").run(frontier);
    const rec = listMemoryRecordsForChat(chatId).filter((r) => !r.inactive).find((r) => r.turnStart === 1);
    out[id] = { arm: ARM, kind: src.kind, sealed: Boolean(ok && rec), providerCalls: attempts.length, attempts, persisted: rec?.summary ?? null, currentMemory: rec ? rebuildLorebookFromRecords(chatId) : "", promptUserContent: userContent };
    writeFileSync(`${DIR}/seal-${ARM}.json`, JSON.stringify(out, null, 2));
  });
}
