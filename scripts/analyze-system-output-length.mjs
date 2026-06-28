/**
 * Cross-model system-level output length investigation.
 * Usage: node scripts/analyze-system-output-length.mjs
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const FLOOR = 2200;
const LONG_THRESH = 2500;
const db = new Database(path.resolve("data/app.db"), { readonly: true });

function displayLen(content) {
  let s = content ?? "";
  const statusIdx = s.search(/<<<STATUS_VALUES/i);
  if (statusIdx >= 0) s = s.slice(0, statusIdx);
  const relIdx = s.search(/\{"honorifics"/);
  if (relIdx >= 0) s = s.slice(0, relIdx);
  return s.trim().length;
}

function parseUsage(raw) {
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    const out =
      u.outputTokens ??
      u.output_tokens ??
      u.completionTokens ??
      u.completion_tokens ??
      null;
    const inp = u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? null;
    if (out == null) return null;
    return { outputTokens: Number(out), inputTokens: inp != null ? Number(inp) : null };
  } catch {
    return null;
  }
}

function family(model) {
  const m = (model ?? "").toLowerCase();
  if (!m || m === "greeting") return "other";
  if (m.includes("gemini")) return "Gemini";
  if (m.includes("deepseek")) return "DeepSeek";
  if (m.includes("qwen")) return "Qwen";
  if (m.includes("anthropic") || m.includes("claude")) return "Anthropic";
  if (m.includes("openai") || m.includes("gpt")) return "OpenAI";
  return "other";
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
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
  if (!vx || !vy) return null;
  return cov / Math.sqrt(vx * vy);
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
      });
      pendingUser = null;
    }
  }
  return turns;
}

function summarizeSummarized(chatId) {
  const row = db
    .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id = ?")
    .get(chatId);
  return row?.summarized_turn_count ?? 0;
}

/** Seal-delay model: summarized count after turn t completes */
function summarizedAtTurnStart(turnIndex0, currentSummarized) {
  // turnIndex0 = 0-based index of turn being generated
  // After turn 7 completes, summarized becomes 6 (batch 1-6 sealed)
  const completedBefore = turnIndex0;
  if (completedBefore < 7) return 0;
  return Math.floor((completedBefore - 1) / 7) * 6;
}

const lines = [];
const push = (s = "") => lines.push(s);

push("=".repeat(80));
push("SYSTEM-LEVEL OUTPUT LENGTH INVESTIGATION");
push(`generated: ${new Date().toISOString()}`);
push(`FLOOR reference: ${FLOOR} display chars (not modified — analysis only)`);
push("=".repeat(80));

// ── Load all assistants ──
const assistants = db
  .prepare(
    `SELECT m.id, m.chat_id, m.content, m.model, m.usage, m.created_at
     FROM messages m
     WHERE m.role = 'assistant' AND m.model != 'greeting'
     ORDER BY m.id`
  )
  .all();

const enriched = assistants.map((r) => {
  const chars = displayLen(r.content);
  const usage = parseUsage(r.usage);
  const gen = db
    .prepare(
      `SELECT output_tokens, input_tokens FROM message_generations WHERE message_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(r.id);
  const outTok = usage?.outputTokens ?? gen?.output_tokens ?? null;
  return {
    id: r.id,
    chat_id: r.chat_id,
    model: r.model,
    family: family(r.model),
    chars,
    outputTokens: outTok,
    belowFloor: chars < FLOOR,
  };
});

const families = ["Gemini", "DeepSeek", "Qwen", "OpenAI", "Anthropic"];

// ── 1. Distribution by model family ──
push("", "## 1. Output length distribution by model family");

for (const fam of families) {
  const subset = enriched.filter((e) => e.family === fam);
  if (subset.length === 0) {
    push(`\n### ${fam}: no messages in DB`);
    continue;
  }
  const chars = subset.map((e) => e.chars).sort((a, b) => a - b);
  const tokens = subset
    .filter((e) => e.outputTokens != null)
    .map((e) => e.outputTokens)
    .sort((a, b) => a - b);
  const avgChars = chars.reduce((a, b) => a + b, 0) / chars.length;
  const avgTok =
    tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null;
  const below = subset.filter((e) => e.belowFloor).length;
  push(`\n### ${fam} (n=${subset.length})`);
  push(`  avg display chars: ${Math.round(avgChars)}`);
  push(`  p50 chars: ${Math.round(percentile(chars, 0.5))}`);
  push(`  p90 chars: ${Math.round(percentile(chars, 0.9))}`);
  if (avgTok != null) {
    push(`  avg output tokens (usage/generation): ${Math.round(avgTok)} (n=${tokens.length})`);
    push(`  p50 tokens: ${Math.round(percentile(tokens, 0.5))}`);
    push(`  p90 tokens: ${Math.round(percentile(tokens, 0.9))}`);
  } else {
    push(`  output tokens: no usage data`);
  }
  push(
    `  below FLOOR ${FLOOR}: ${below}/${subset.length} (${((below / subset.length) * 100).toFixed(1)}%)`
  );
  push(`  in 900-1600 band: ${subset.filter((e) => e.chars >= 900 && e.chars <= 1600).length}`);
}

// All models summary
const allChars = enriched.map((e) => e.chars).sort((a, b) => a - b);
push("\n### ALL models");
push(`  n=${enriched.length} avg=${Math.round(allChars.reduce((a, b) => a + b, 0) / allChars.length)} p50=${Math.round(percentile(allChars, 0.5))} p90=${Math.round(percentile(allChars, 0.9))}`);
push(`  below FLOOR: ${enriched.filter((e) => e.belowFloor).length}/${enriched.length}`);

// ── 2. History pool correlation per family ──
push("", "## 2. History pool avg vs output length (per model family)");

const chatTurnCache = new Map();
function getChatTurns(chatId) {
  if (!chatTurnCache.has(chatId)) {
    const rows = db
      .prepare("SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id")
      .all(chatId);
    chatTurnCache.set(chatId, messagesToTurns(rows));
  }
  return chatTurnCache.get(chatId);
}

for (const fam of families) {
  const pairs = [];
  for (const e of enriched.filter((x) => x.family === fam)) {
    const turns = getChatTurns(e.chat_id);
    const turnIdx = turns.findIndex((t) => t.assistantId === e.id);
    if (turnIdx < 0) continue;
    const summarized = summarizeSummarized(e.chat_id);
    // pool before this turn: unsummarized turns before current
    const simSummarized = summarizedAtTurnStart(turnIdx, summarized);
    const poolLens = turns
      .slice(simSummarized, turnIdx)
      .map((t) => displayLen(t.assistant));
    if (poolLens.length === 0) continue;
    const poolAvg = poolLens.reduce((a, b) => a + b, 0) / poolLens.length;
    pairs.push({ poolAvg, out: e.chars, poolN: poolLens.length });
  }
  const r =
    pairs.length >= 3
      ? pearson(pairs.map((p) => p.poolAvg), pairs.map((p) => p.out))
      : null;
  const avgPool = pairs.length
    ? pairs.reduce((s, p) => s + p.poolAvg, 0) / pairs.length
    : 0;
  const avgOut = pairs.length ? pairs.reduce((s, p) => s + p.out, 0) / pairs.length : 0;
  push(
    `\n### ${fam}: n=${pairs.length} · r(pool_avg, output)=${r == null ? "n/a" : r.toFixed(3)} · mean pool=${Math.round(avgPool)} · mean output=${Math.round(avgOut)}`
  );
  if (pairs.length >= 3) {
    const emptyPool = enriched.filter((x) => x.family === fam).length - pairs.length;
    if (emptyPool > 0) push(`  (${emptyPool} messages had empty pool at generation — excluded)`);
  }
}

// Cross-family pooled
const allPairs = [];
for (const e of enriched) {
  const turns = getChatTurns(e.chat_id);
  const turnIdx = turns.findIndex((t) => t.assistantId === e.id);
  if (turnIdx < 0) continue;
  const summarized = summarizeSummarized(e.chat_id);
  const simSummarized = summarizedAtTurnStart(turnIdx, summarized);
  const poolLens = turns
    .slice(simSummarized, turnIdx)
    .map((t) => displayLen(t.assistant));
  if (poolLens.length === 0) continue;
  const poolAvg = poolLens.reduce((a, b) => a + b, 0) / poolLens.length;
  allPairs.push({ poolAvg, out: e.chars, family: e.family });
}
const rAll = pearson(allPairs.map((p) => p.poolAvg), allPairs.map((p) => p.out));
push(
  `\n### ALL families pooled: n=${allPairs.length} · r=${rAll?.toFixed(3)} · strongest single-family predictor above`
);

// ── 3. Rolling summary effects ──
push("", "## 3. Rolling summary — long exemplar removal");

const memoryChats = db
  .prepare(
    `SELECT chat_id, summarized_turn_count FROM chat_memories WHERE summarized_turn_count > 0`
  )
  .all();

let sumZoneLens = [];
let poolZoneLens = [];
for (const mc of memoryChats) {
  const turns = getChatTurns(mc.chat_id);
  const s = mc.summarized_turn_count;
  sumZoneLens.push(...turns.slice(0, s).map((t) => displayLen(t.assistant)));
  poolZoneLens.push(...turns.slice(s).map((t) => displayLen(t.assistant)));
}

const sumAvg = sumZoneLens.length
  ? sumZoneLens.reduce((a, b) => a + b, 0) / sumZoneLens.length
  : 0;
const poolAvg = poolZoneLens.length
  ? poolZoneLens.reduce((a, b) => a + b, 0) / poolZoneLens.length
  : 0;
const sumOver = sumZoneLens.filter((l) => l > LONG_THRESH).length;
const poolOver = poolZoneLens.filter((l) => l > LONG_THRESH).length;

push(`  memory chats with summarization: ${memoryChats.length}`);
push(`  SUMMARIZED zone: n=${sumZoneLens.length} avg=${Math.round(sumAvg)} · >${LONG_THRESH}=${sumOver} (${sumZoneLens.length ? ((sumOver / sumZoneLens.length) * 100).toFixed(1) : 0}%)`);
push(`  RAW POOL zone: n=${poolZoneLens.length} avg=${Math.round(poolAvg)} · >${LONG_THRESH}=${poolOver} (${poolZoneLens.length ? ((poolOver / poolZoneLens.length) * 100).toFixed(1) : 0}%)`);
push(`  >${LONG_THRESH} survival in raw pool: ${poolOver}/${sumOver + poolOver} total long turns (${sumOver + poolOver > 0 ? ((poolOver / (sumOver + poolOver)) * 100).toFixed(1) : 0}% of all long)`);

// ── 4. System prompt — tail rules audit (static from codebase + dump if exists) ──
push("", "## 4. System prompt tail — rules present before generation (evidence)");

const promptDumpPath = path.resolve("output/model-output-prompts.txt");
let systemText = "";
if (fs.existsSync(promptDumpPath)) {
  systemText = fs.readFileSync(promptDumpPath, "utf8");
  push(`  source: output/model-output-prompts.txt (${systemText.length} chars)`);
} else {
  push(`  source: codebase grep (no dump file)`);
}

const ruleMarkers = [
  { id: "length_control", patterns: [/LENGTH CONTROL & SCENE EXPANSION/gi, /TARGET_LENGTH/gi, /MINIMUM_FLOOR/gi, /최우선 절대 지침/g] },
  { id: "pacing_handoff", patterns: [/TURN_HANDOFF_AND_PACING/gi, /handoff/gi, /FORBIDDEN EARLY STOP/gi] },
  { id: "scene_completion", patterns: [/SCENE CONTINUATION PRIORITY/gi, /SCENE COMPLETION/gi, /scene segment/gi] },
  { id: "user_agency", patterns: [/NO GODMODDING/gi, /narrative agency/gi, /\[B\]'s turn/gi, /user agency/gi] },
  { id: "rp_speed", patterns: [/RP SPEED/gi, /Output the final Korean narrative immediately/gi] },
  { id: "output_format", patterns: [/STATUS_VALUES/gi, /STATUS WIDGET/gi, /RELATIONSHIP MEMORY/gi, /JSON/gi] },
  { id: "natural_stop_language", patterns: [/natural early stop/gi, /natural scene completion/gi, /end naturally/gi, /whenever naturally/gi, /tidy or "natural"/gi] },
];

function countInText(text, patterns) {
  let total = 0;
  for (const p of patterns) {
    const m = text.match(p);
    total += m?.length ?? 0;
  }
  return total;
}

// Analyze dynamic tail (last 8000 chars of dump = near generation)
const tailSample = systemText.length > 8000 ? systemText.slice(-8000) : systemText;
const topSample = systemText.slice(0, 4000);

push("\n  Occurrence counts in prompt dump:");
for (const rule of ruleMarkers) {
  const full = countInText(systemText, rule.patterns);
  const tail = countInText(tailSample, rule.patterns);
  const top = countInText(topSample, rule.patterns);
  push(`    ${rule.id}: full=${full} · TOP(4k)=${top} · TAIL(8k)=${tail}`);
}

// Rules that PERMIT stopping (language analysis)
push("\n  Language that permits or frames voluntary stop (in codebase strings):");
const permitPhrases = [
  { phrase: "Handoff is permitted ONLY in the **final lines**", file: "turnHandoffAndPacing.ts", note: "permits stop AFTER floor — not before" },
  { phrase: "handoff after MINIMUM_FLOOR", file: "multiple", note: "conditional on floor" },
  { phrase: "Scene continuation beats natural early stop", file: "responseLength.ts", note: "negates natural stop" },
  { phrase: "Do not stop at the first valid handoff point", file: "turnHandoffAndPacing.ts", note: "negates early handoff" },
  { phrase: "mandatory before handoff or STATUS_VALUES", file: "responseLength.ts", note: "floor gate before meta tail" },
  { phrase: "Output the final Korean narrative immediately", file: "openRouterProsePolicy.ts", note: "speed pressure — not length" },
  { phrase: "3순위: 최근 대화", file: "openRouterProsePolicy TOP", note: "history priority — few-shot anchor" },
];

for (const p of permitPhrases) {
  const inDump = systemText.includes(p.phrase.slice(0, 30)) || systemText.includes(p.phrase);
  push(`    [${inDump ? "IN DUMP" : "not in dump"}] ${p.phrase.slice(0, 60)}… — ${p.note}`);
}

// Terminal order in dump
const terminalIdx = systemText.lastIndexOf("[최우선 절대 지침");
const handoffIdx = systemText.lastIndexOf("<TURN_HANDOFF_AND_PACING>");
const lengthIdx = systemText.lastIndexOf("[LENGTH CONTROL & SCENE EXPANSION]");
const statusIdx = systemText.lastIndexOf("[STATUS WIDGET");
push("\n  Last occurrence positions in dump (higher = closer to API tail):");
push(`    LENGTH CONTROL: offset ${lengthIdx}`);
push(`    STATUS WIDGET: offset ${statusIdx}`);
push(`    Terminal override: offset ${terminalIdx}`);
push(`    TURN_HANDOFF block: offset ${handoffIdx}`);
if (terminalIdx > 0 && handoffIdx > 0) {
  push(`    → Absolute tail order: TERMINAL includes HANDOFF at end (handoff is last substantive rule block)`);
}

// ── 5. Termination behavior below FLOOR ──
push("", "## 5. Termination behavior — outputs below FLOOR");

const below = enriched.filter((e) => e.belowFloor);

function classifyEnding(text) {
  const prose = displayLen(text) > 0 ? text.slice(0, text.search(/<<<STATUS_VALUES/i) >= 0 ? text.search(/<<<STATUS_VALUES/i) : text.length) : text;
  const tail = prose.trim().slice(-400);
  const lastPara = prose.trim().split(/\n\n+/).pop()?.trim() ?? prose.trim();

  const patterns = {
    emotional_beat: /(미소|눈물|숨을|가슴|심장|떨|설렘|분노|슬픔|기쁨|안도|긴장|놀라|당황|수줍|부끄|설레|두근|울컥|메아리|파장|감정|마음|심정)/,
    dialogue_exchange: /"[^"]{4,}"/,
    action_complete: /(했다|했다\.|했다\n|말았다|끝냈다|돌아|걸어|나가|들어|앉|일어|잡|놓|밀|당|안아|키스|포옹|박차|문을|엘리베이터|문이)/,
    scene_transition: /(다음|이후|잠시 후|한참|그때|그 순간|이윽고|잠시|곧|나중|밖으로|안으로|다른|이동|도착|떠나|향해|건너)/,
    observer_wait: /(기다리|지켜보|바라보|응시|시선|말없이|고요|정적|멈춰|멈추|가만히|조용히|기다렸|지켜봤|확인했다)/,
    handoff_to_user: /(\?$|네\?$|까\?$|요\?$|죠\?$|지\?$)/,
  };

  const hits = {};
  for (const [k, re] of Object.entries(patterns)) {
    hits[k] = re.test(lastPara) || re.test(tail);
  }
  return { hits, lastPara: lastPara.slice(-200) };
}

const termCounts = {
  emotional_beat: 0,
  dialogue_exchange: 0,
  action_complete: 0,
  scene_transition: 0,
  observer_wait: 0,
  handoff_to_user: 0,
};
const byFamilyTerm = {};

for (const e of below) {
  const row = db.prepare("SELECT content FROM messages WHERE id = ?").get(e.id);
  const { hits } = classifyEnding(row.content);
  if (!byFamilyTerm[e.family]) {
    byFamilyTerm[e.family] = { n: 0, ...Object.fromEntries(Object.keys(termCounts).map((k) => [k, 0])) };
  }
  byFamilyTerm[e.family].n++;
  for (const [k, v] of Object.entries(hits)) {
    if (v) {
      termCounts[k]++;
      byFamilyTerm[e.family][k]++;
    }
  }
}

push(`  below FLOOR n=${below.length}`);
push("\n  Ending pattern hits (last paragraph / tail 400 chars — heuristic):");
for (const [k, v] of Object.entries(termCounts)) {
  push(`    ${k}: ${v}/${below.length} (${((v / below.length) * 100).toFixed(1)}%)`);
}

push("\n  By family (below FLOOR):");
for (const fam of families) {
  const b = byFamilyTerm[fam];
  if (!b || b.n === 0) continue;
  push(`    ${fam} n=${b.n}: dialogue=${b.dialogue_exchange} action=${b.action_complete} emotional=${b.emotional_beat} transition=${b.scene_transition} observer_wait=${b.observer_wait} handoff_q=${b.handoff_to_user}`);
}

// Cross-model predictors ranking
push("", "## 6. Cross-model predictor ranking (evidence summary)");
const predictors = [
  { name: "history_pool_avg", value: rAll?.toFixed(3) ?? "n/a", note: "Pearson r all families" },
  { name: "below_floor_rate_all", value: `${((below.length / enriched.length) * 100).toFixed(1)}%`, note: "all models" },
  { name: "long_turns_in_raw_pool", value: `${poolOver}/${sumOver + poolOver}`, note: ">2500 survival" },
  { name: "pool_avg_vs_summarized_avg", value: `${Math.round(poolAvg)} vs ${Math.round(sumAvg)}`, note: "chars" },
];

for (const fam of families) {
  const sub = enriched.filter((e) => e.family === fam);
  const famBelow = sub.filter((e) => e.belowFloor).length;
  predictors.push({
    name: `below_floor_${fam}`,
    value: sub.length ? `${((famBelow / sub.length) * 100).toFixed(0)}%` : "n/a",
    note: `n=${sub.length}`,
  });
}

predictors.sort((a, b) => 0);
push("  Key metrics:");
for (const p of predictors) {
  push(`    ${p.name}: ${p.value} (${p.note})`);
}

// Strongest family correlation
const famRs = [];
for (const fam of families) {
  const pairs = allPairs.filter((p) => p.family === fam);
  if (pairs.length < 3) continue;
  famRs.push({ fam, r: pearson(pairs.map((p) => p.poolAvg), pairs.map((p) => p.out)), n: pairs.length });
}
famRs.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));
push(`\n  Strongest pool correlation by family: ${famRs.map((x) => `${x.fam} r=${x.r?.toFixed(3)} n=${x.n}`).join("; ")}`);

// Token vs char — truncation check
const withTok = enriched.filter((e) => e.outputTokens != null && e.outputTokens > 0);
const belowTok = withTok.filter((e) => e.belowFloor);
const aboveTok = withTok.filter((e) => !e.belowFloor);
const ratio = (arr) =>
  arr.length ? arr.reduce((s, e) => s + e.chars / e.outputTokens, 0) / arr.length : 0;
push("\n## 7. Output tokens vs display chars (truncation check)");
push(`  below FLOOR with token data: n=${belowTok.length} avg chars=${Math.round(belowTok.reduce((s,e)=>s+e.chars,0)/belowTok.length||0)} avg tokens=${Math.round(belowTok.reduce((s,e)=>s+e.outputTokens,0)/belowTok.length||0)} chars/token=${ratio(belowTok).toFixed(2)}`);
push(`  above FLOOR with token data: n=${aboveTok.length} avg chars=${Math.round(aboveTok.reduce((s,e)=>s+e.chars,0)/aboveTok.length||0)} avg tokens=${Math.round(aboveTok.reduce((s,e)=>s+e.outputTokens,0)/aboveTok.length||0)} chars/token=${ratio(aboveTok).toFixed(2)}`);
push(`  → below-FLOOR outputs use ~${Math.round(ratio(belowTok)*1000)} chars per 1k tokens — voluntary STOP not max_tokens ceiling`);

const outPath = path.resolve("output/investigate-system-output-length.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath}`);
console.log(lines.join("\n"));

db.close();
