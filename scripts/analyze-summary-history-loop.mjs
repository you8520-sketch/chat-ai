/**
 * Rolling summary vs history composition / length anchoring analysis.
 * Usage: node scripts/analyze-summary-history-loop.mjs [--chat-id=30]
 */
import Database from "better-sqlite3";
import { resolve } from "path";

const THRESHOLD = 2500;
const chatIdArg = process.argv.find((a) => a.startsWith("--chat-id="));
const focusChatId = chatIdArg ? Number(chatIdArg.split("=")[1]) : 30;

const db = new Database(resolve("data/app.db"), { readonly: true });

function displayLen(content) {
  let s = content ?? "";
  const statusIdx = s.search(/<<<STATUS_VALUES/i);
  if (statusIdx >= 0) s = s.slice(0, statusIdx);
  const relIdx = s.search(/\{"honorifics"/);
  if (relIdx >= 0) s = s.slice(0, relIdx);
  return s.trim().length;
}

function messagesToTurns(rows) {
  const turns = [];
  let pendingUser = null;
  for (const row of rows) {
    if (row.role === "user") pendingUser = row.content;
    else if (row.role === "assistant" && row.model !== "greeting" && pendingUser !== null) {
      turns.push({
        user: pendingUser,
        assistant: row.content,
        assistantId: row.id,
        model: row.model,
        created_at: row.created_at,
      });
      pendingUser = null;
    }
  }
  return turns;
}

function getSummarizedCount(chatId) {
  const mem = db
    .prepare(
      `SELECT summarized_turn_count, message_count, recent_summary FROM chat_memories WHERE chat_id = ?`
    )
    .get(chatId);
  return {
    summarized_turn_count: mem?.summarized_turn_count ?? 0,
    message_count: mem?.message_count ?? 0,
    recent_summary_len: mem?.recent_summary?.length ?? 0,
  };
}

// Which table has summarized_turn_count - route likely uses chat_memories
function resolveSummarized(chatId) {
  const row = db
    .prepare(`SELECT summarized_turn_count FROM chat_memories WHERE chat_id = ?`)
    .get(chatId);
  return row?.summarized_turn_count ?? 0;
}

const allChats = db
  .prepare(
    `SELECT c.id FROM chats c
     JOIN chat_memories cm ON cm.chat_id = c.id
     WHERE cm.summarized_turn_count > 0
     ORDER BY c.id`
  )
  .all();

console.log("=".repeat(72));
console.log("ROLLING SUMMARY · HISTORY COMPOSITION ANALYSIS");
console.log(`threshold: assistant > ${THRESHOLD} display chars`);
console.log("=".repeat(72));

// Global: all chats with memory
let globalSummarizedTurns = 0;
let globalSummarizedAssistants = [];
let globalUnsummarizedAssistants = [];
let globalAllAssistants = [];

for (const { id: chatId } of allChats) {
  const summarized = resolveSummarized(chatId);
  const rows = db
    .prepare(
      `SELECT id, role, content, model, created_at FROM messages WHERE chat_id = ? ORDER BY id`
    )
    .all(chatId);
  const turns = messagesToTurns(rows);
  for (let i = 0; i < turns.length; i++) {
    const len = displayLen(turns[i].assistant);
    const entry = { chatId, turn: i + 1, len, model: turns[i].model };
    globalAllAssistants.push(entry);
    if (i < summarized) {
      globalSummarizedAssistants.push(entry);
      globalSummarizedTurns++;
    } else {
      globalUnsummarizedAssistants.push(entry);
    }
  }
}

function stats(label, arr) {
  const n = arr.length;
  const over = arr.filter((x) => x.len > THRESHOLD);
  const avg = n ? arr.reduce((s, x) => s + x.len, 0) / n : 0;
  console.log(`\n${label}`);
  console.log(`  turns: ${n}`);
  console.log(`  avg display chars: ${Math.round(avg)}`);
  console.log(`  >${THRESHOLD} chars: ${over.length} (${n ? ((over.length / n) * 100).toFixed(1) : 0}%)`);
  if (over.length > 0) {
    console.log(
      `  long turns sample: ${over
        .slice(0, 8)
        .map((x) => `chat${x.chatId}#${x.turn}=${x.len}`)
        .join(", ")}${over.length > 8 ? "…" : ""}`
    );
  }
}

stats("Q1 — ALL assistant turns (memory-enabled chats)", globalAllAssistants);
stats("Q1 — SUMMARIZED zone (removed from raw history pool)", globalSummarizedAssistants);
stats("Q1 — UNSUMMARIZED zone (eligible for raw history pool)", globalUnsummarizedAssistants);

// Q2: bias check — are long turns disproportionately in summarized zone?
const summarizedLongPct =
  globalSummarizedAssistants.length
    ? globalSummarizedAssistants.filter((x) => x.len > THRESHOLD).length /
      globalSummarizedAssistants.length
    : 0;
const unsummarizedLongPct =
  globalUnsummarizedAssistants.length
    ? globalUnsummarizedAssistants.filter((x) => x.len > THRESHOLD).length /
      globalUnsummarizedAssistants.length
    : 0;
const summarizedAvg =
  globalSummarizedAssistants.length
    ? globalSummarizedAssistants.reduce((s, x) => s + x.len, 0) / globalSummarizedAssistants.length
    : 0;
const unsummarizedAvg =
  globalUnsummarizedAssistants.length
    ? globalUnsummarizedAssistants.reduce((s, x) => s + x.len, 0) /
      globalUnsummarizedAssistants.length
    : 0;

console.log("\n" + "=".repeat(72));
console.log("Q2 — Does summarization leave only short turns in raw pool?");
console.log(`  summarized zone avg: ${Math.round(summarizedAvg)} · >${THRESHOLD} rate: ${(summarizedLongPct * 100).toFixed(1)}%`);
console.log(`  unsummarized zone avg: ${Math.round(unsummarizedAvg)} · >${THRESHOLD} rate: ${(unsummarizedLongPct * 100).toFixed(1)}%`);
console.log(
  `  avg length drop (summarized → unsummarized pool): ${Math.round(summarizedAvg - unsummarizedAvg)} chars`
);

// Per-chat where unsummarized pool avg < summarized zone avg
let biasChats = 0;
let totalBiasChats = 0;
for (const { id: chatId } of allChats) {
  const summarized = resolveSummarized(chatId);
  if (summarized === 0) continue;
  const rows = db
    .prepare(`SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id`)
    .all(chatId);
  const turns = messagesToTurns(rows);
  const sumLens = turns.slice(0, summarized).map((t) => displayLen(t.assistant));
  const unsLens = turns.slice(summarized).map((t) => displayLen(t.assistant));
  if (sumLens.length === 0 || unsLens.length === 0) continue;
  totalBiasChats++;
  const sumAvg = sumLens.reduce((a, b) => a + b, 0) / sumLens.length;
  const unsAvg = unsLens.reduce((a, b) => a + b, 0) / unsLens.length;
  if (unsAvg < sumAvg) biasChats++;
}
console.log(
  `  chats with summarized>0: ${totalBiasChats} · unsummarized avg < summarized avg: ${biasChats} (${totalBiasChats ? ((biasChats / totalBiasChats) * 100).toFixed(0) : 0}%)`
);

// Q3: chat #30 detail
console.log("\n" + "=".repeat(72));
console.log(`Q3 — Chat #${focusChatId} per-turn breakdown`);
const memInfo = getSummarizedCount(focusChatId);
const summarized30 = resolveSummarized(focusChatId);
const rows30 = db
  .prepare(
    `SELECT id, role, content, model, created_at FROM messages WHERE chat_id = ? ORDER BY id`
  )
  .all(focusChatId);
const turns30 = messagesToTurns(rows30);

console.log(`  summarized_turn_count: ${memInfo.summarized_turn_count}`);
console.log(`  message_count: ${memInfo.message_count}`);
console.log(`  recent_summary (lorebook) chars: ${memInfo.recent_summary_len}`);
console.log(`  completed turns: ${turns30.length}`);
console.log(`  raw history pool: turns ${summarized30 + 1}–${turns30.length} (${turns30.length - summarized30} turns)`);

const records30 = db
  .prepare(
    `SELECT turn_number, assistant_message_id, summary, length(summary) as sum_len FROM chat_turn_summaries WHERE chat_id = ? ORDER BY turn_number`
  )
  .all(focusChatId);

console.log(`  memory records (chat_turn_summaries): ${records30.length}`);
for (const r of records30) {
  console.log(
    `    batch start turn ${r.turn_number}: summary ${r.sum_len} chars · ends at msg#${r.assistant_message_id}`
  );
}

console.log("\n  Per-turn assistant lengths:");
let beforeSumLens = [];
let afterSumLens = [];
let poolLens = [];

for (let i = 0; i < turns30.length; i++) {
  const t = turns30[i];
  const len = displayLen(t.assistant);
  const zone = i < summarized30 ? "SUMMARIZED (out of raw pool)" : "RAW POOL (in history)";
  const long = len > THRESHOLD ? " LONG" : "";
  console.log(
    `    turn ${i + 1} msg#${t.assistantId} ${zone}${long} · ${len} chars · ${t.model?.split("/").pop() ?? "?"} · ${t.created_at}`
  );
  if (i < summarized30) beforeSumLens.push(len);
  else {
    afterSumLens.push(len);
    poolLens.push(len);
  }
}

const avgBefore = beforeSumLens.length
  ? beforeSumLens.reduce((a, b) => a + b, 0) / beforeSumLens.length
  : 0;
const avgAfter = afterSumLens.length
  ? afterSumLens.reduce((a, b) => a + b, 0) / afterSumLens.length
  : 0;
const avgPool = poolLens.length ? poolLens.reduce((a, b) => a + b, 0) / poolLens.length : 0;

console.log("\n  Chat #30 averages:");
console.log(`    BEFORE summary boundary (turns 1–${summarized30}): avg=${Math.round(avgBefore)} · >${THRESHOLD}: ${beforeSumLens.filter((l) => l > THRESHOLD).length}/${beforeSumLens.length}`);
console.log(`    AFTER summary boundary (turns ${summarized30 + 1}–${turns30.length}): avg=${Math.round(avgAfter)} · >${THRESHOLD}: ${afterSumLens.filter((l) => l > THRESHOLD).length}/${afterSumLens.length}`);
console.log(`    Remaining in message history (raw pool): avg=${Math.round(avgPool)}`);

// DeepSeek-only turns in pool
const dsPool = turns30
  .slice(summarized30)
  .filter((t) => /deepseek/i.test(t.model ?? ""));
const dsAvg =
  dsPool.length
    ? dsPool.reduce((s, t) => s + displayLen(t.assistant), 0) / dsPool.length
    : 0;
console.log(`    DeepSeek-only in raw pool: n=${dsPool.length} avg=${Math.round(dsAvg)}`);

// Q4: feedback loop simulation — track how pool avg evolves as summarized count increases
console.log("\n" + "=".repeat(72));
console.log("Q4 — Simulated pool avg as summarization advances (chat #" + focusChatId + ")");

for (let s = 0; s <= turns30.length; s++) {
  const pool = turns30.slice(s);
  if (pool.length === 0) continue;
  const lens = pool.map((t) => displayLen(t.assistant));
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const over = lens.filter((l) => l > THRESHOLD).length;
  const marker = s === summarized30 ? " ← CURRENT" : "";
  console.log(
    `  summarized_turn_count=${s}: pool=${pool.length} turns · avg=${Math.round(avg)} · >${THRESHOLD}=${over}${marker}`
  );
}

// Global feedback loop: for each chat, compare first batch summarized vs current pool
console.log("\n" + "=".repeat(72));
console.log("Q4 — Global: first summarized batch vs current raw pool (all memory chats)");

let loopEvidence = 0;
let loopTotal = 0;
for (const { id: chatId } of allChats) {
  const summarized = resolveSummarized(chatId);
  if (summarized < 6) continue; // need at least one full batch summarized
  const rows = db
    .prepare(`SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id`)
    .all(chatId);
  const turns = messagesToTurns(rows);
  const firstBatch = turns.slice(0, 6).map((t) => displayLen(t.assistant));
  const pool = turns.slice(summarized).map((t) => displayLen(t.assistant));
  if (firstBatch.length < 6 || pool.length === 0) continue;
  loopTotal++;
  const firstAvg = firstBatch.reduce((a, b) => a + b, 0) / 6;
  const poolAvg = pool.reduce((a, b) => a + b, 0) / pool.length;
  if (poolAvg < firstAvg - 200) loopEvidence++;
}

console.log(
  `  chats with ≥6 summarized turns: ${loopTotal} · pool avg < first-batch avg−200: ${loopEvidence} (${loopTotal ? ((loopEvidence / loopTotal) * 100).toFixed(0) : 0}%)`
);

// DeepSeek correlation: pool avg vs next deepseek output in same chat
console.log("\n  DeepSeek chain within chats (pool avg when DS turn generated):");
const dsPairs = [];
for (const { id: chatId } of db.prepare("SELECT id FROM chats ORDER BY id").all()) {
  const summarized = resolveSummarized(chatId);
  const rows = db
    .prepare(`SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id`)
    .all(chatId);
  const turns = messagesToTurns(rows);
  for (let i = 0; i < turns.length; i++) {
    if (!/deepseek/i.test(turns[i].model ?? "")) continue;
    const poolBefore = turns.slice(summarized, i).map((t) => displayLen(t.assistant));
    if (poolBefore.length === 0) continue;
    const poolAvg = poolBefore.reduce((a, b) => a + b, 0) / poolBefore.length;
    dsPairs.push({ poolAvg, out: displayLen(turns[i].assistant), summarized });
  }
}
if (dsPairs.length >= 3) {
  const xs = dsPairs.map((p) => p.poolAvg);
  const ys = dsPairs.map((p) => p.out);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  const r = vx && vy ? cov / Math.sqrt(vx * vy) : null;
  console.log(`  n=${dsPairs.length} · r(pool_avg_before_turn, deepseek_output)=${r?.toFixed(3)}`);
  console.log(`  mean pool avg: ${Math.round(mx)} · mean DS output: ${Math.round(my)}`);
}

// Extended multi-chat table
console.log("\n" + "=".repeat(72));
console.log("Per-chat: summarized zone vs raw pool (>2500 counts)");
const memoryChats = db
  .prepare(`SELECT chat_id, summarized_turn_count, message_count, length(recent_summary) as lore FROM chat_memories WHERE summarized_turn_count > 0 ORDER BY chat_id`)
  .all();
for (const mc of memoryChats) {
  const rows = db
    .prepare(`SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id`)
    .all(mc.chat_id);
  const turns = messagesToTurns(rows);
  const s = mc.summarized_turn_count;
  const sumLens = turns.slice(0, s).map((t) => displayLen(t.assistant));
  const poolLens = turns.slice(s).map((t) => displayLen(t.assistant));
  const sumAvg = sumLens.length ? Math.round(sumLens.reduce((a, b) => a + b, 0) / sumLens.length) : 0;
  const poolAvg = poolLens.length ? Math.round(poolLens.reduce((a, b) => a + b, 0) / poolLens.length) : 0;
  const sumOver = sumLens.filter((l) => l > THRESHOLD).length;
  const poolOver = poolLens.filter((l) => l > THRESHOLD).length;
  const rawSumTotal = sumLens.reduce((a, b) => a + b, 0);
  console.log(
    `  chat ${mc.chat_id}: turns=${turns.length} summarized=${s} pool=${poolLens.length} · sumZone avg=${sumAvg} >${THRESHOLD}=${sumOver}/${sumLens.length} rawTotal=${rawSumTotal}ch lore=${mc.lore}ch · pool avg=${poolAvg} >${THRESHOLD}=${poolOver}/${poolLens.length}`
  );
}

db.close();
