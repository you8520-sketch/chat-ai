/**
 * Correlation: prior assistant history length vs current output length.
 * Usage: node scripts/analyze-length-correlation.mjs
 */
import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = resolve("data/app.db");
const db = new Database(dbPath, { readonly: true });

function displayLen(content) {
  // mirror visibleAssistantDisplayCharCount lightly — strip common tails if present
  let s = content ?? "";
  const statusIdx = s.search(/<<<STATUS_VALUES/i);
  if (statusIdx >= 0) s = s.slice(0, statusIdx);
  const relIdx = s.search(/\{"honorifics"/);
  if (relIdx >= 0) s = s.slice(0, relIdx);
  return s.trim().length;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function summarize(label, pairs) {
  const xs = pairs.map((p) => p.priorAvg);
  const ys = pairs.map((p) => p.outLen);
  const r = pearson(xs, ys);
  const avgPrior = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgOut = ys.reduce((a, b) => a + b, 0) / ys.length;
  console.log(`\n=== ${label} (n=${pairs.length}) ===`);
  console.log(`  prior assistant avg (mean of means): ${Math.round(avgPrior)}`);
  console.log(`  output length mean: ${Math.round(avgOut)}`);
  console.log(`  Pearson r(prior_avg, output): ${r === null ? "n/a" : r.toFixed(3)}`);

  // also immediate prior only
  const imm = pairs.filter((p) => p.prior1 != null);
  const r1 = pearson(imm.map((p) => p.prior1), imm.map((p) => p.outLen));
  console.log(`  Pearson r(immediate_prior, output): ${r1 === null ? "n/a" : r1.toFixed(3)} (n=${imm.length})`);

  // bucket analysis
  const buckets = [
    { name: "prior<1200", min: 0, max: 1200 },
    { name: "1200-1800", min: 1200, max: 1800 },
    { name: "1800-2500", min: 1800, max: 2500 },
    { name: "2500+", min: 2500, max: 99999 },
  ];
  for (const b of buckets) {
    const sub = pairs.filter((p) => p.priorAvg >= b.min && p.priorAvg < b.max);
    if (sub.length === 0) continue;
    const m = sub.reduce((s, p) => s + p.outLen, 0) / sub.length;
    console.log(`  bucket ${b.name}: n=${sub.length} avg_output=${Math.round(m)}`);
  }
}

const allAssistants = db
  .prepare(
    `SELECT m.id, m.chat_id, m.content, m.model, m.created_at
     FROM messages m
     WHERE m.role = 'assistant' AND m.model != 'greeting'
     ORDER BY m.chat_id, m.id`
  )
  .all();

function buildPairs(modelFilter) {
  const pairs = [];
  const byChat = new Map();
  for (const row of allAssistants) {
    if (modelFilter && !modelFilter(row.model)) continue;
    if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
    const hist = byChat.get(row.chat_id);
    const priorLens = hist.map((h) => h.len);
    const priorAvg =
      priorLens.length > 0
        ? priorLens.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, priorLens.length)
        : null;
    const prior1 = priorLens.length > 0 ? priorLens[priorLens.length - 1] : null;
    const outLen = displayLen(row.content);
    if (priorAvg != null) {
      pairs.push({
        id: row.id,
        chat_id: row.chat_id,
        model: row.model,
        priorAvg,
        prior1,
        outLen,
        priorCount: priorLens.length,
      });
    }
    hist.push({ id: row.id, len: outLen });
  }
  return pairs;
}

const deepseekFilter = (m) => /deepseek/i.test(m);
const allPairs = buildPairs(null);
const dsPairs = buildPairs(deepseekFilter);

summarize("ALL models", allPairs);
summarize("DeepSeek only", dsPairs);

// same chat mixed model — deepseek output when prior avg from any model
const dsOutPairs = [];
const chatHist = new Map();
for (const row of allAssistants) {
  if (!chatHist.has(row.chat_id)) chatHist.set(row.chat_id, []);
  const hist = chatHist.get(row.chat_id);
  const priorLens = hist.map((h) => h.len);
  const priorAvg =
    priorLens.length > 0
      ? priorLens.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, priorLens.length)
      : null;
  if (/deepseek/i.test(row.model) && priorAvg != null) {
    dsOutPairs.push({
      priorAvg,
      prior1: priorLens.length ? priorLens[priorLens.length - 1] : null,
      outLen: displayLen(row.content),
    });
  }
  hist.push({ len: displayLen(row.content) });
}
summarize("DeepSeek output (prior any model)", dsOutPairs);

// lag: does output length predict NEXT output?
const lagPairs = [];
for (const [chatId, hist] of chatHist) {
  for (let i = 1; i < hist.length; i++) {
    lagPairs.push({ prev: hist[i - 1].len, next: hist[i].len });
  }
}
const lagR = pearson(lagPairs.map((p) => p.prev), lagPairs.map((p) => p.next));
console.log(`\n=== Autocorrelation within chat (prev_output -> next_output) n=${lagPairs.length} ===`);
console.log(`  Pearson r: ${lagR === null ? "n/a" : lagR.toFixed(3)}`);

const dsLag = [];
for (const row of allAssistants) {
  // rebuild per chat deepseek only sequence
}
const byChatDs = new Map();
for (const row of allAssistants) {
  if (!/deepseek/i.test(row.model)) continue;
  if (!byChatDs.has(row.chat_id)) byChatDs.set(row.chat_id, []);
  byChatDs.get(row.chat_id).push(displayLen(row.content));
}
for (const lens of byChatDs.values()) {
  for (let i = 1; i < lens.length; i++) {
    dsLag.push({ prev: lens[i - 1], next: lens[i] });
  }
}
const dsLagR = pearson(dsLag.map((p) => p.prev), dsLag.map((p) => p.next));
console.log(`\n=== DeepSeek autocorrelation n=${dsLag.length} ===`);
console.log(`  Pearson r: ${dsLagR === null ? "n/a" : dsLagR.toFixed(3)}`);

db.close();
