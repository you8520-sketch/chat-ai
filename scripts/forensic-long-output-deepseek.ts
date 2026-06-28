/**
 * Forensic: long vs short DeepSeek outputs from production DB.
 * Usage: npx.cmd tsx scripts/forensic-long-output-deepseek.ts
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { getDatabasePath } from "../src/lib/dataDir";

const FLOOR = 2200;
const THRESHOLDS = [1800, 2200, 3000];
const RECENT_SHORT_MAX = 900;
const RECENT_WINDOW_DAYS = 14;

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type TerminalCategory =
  | "dialogue_resolution"
  | "reaction_only"
  | "atmosphere"
  | "internal_state"
  | "tension_shift"
  | "followup_interaction"
  | "other";

type Row = {
  message_id: number;
  chat_id: number;
  model: string;
  created_at: string;
  content: string;
  usage: string | null;
  prompt_hash: string;
  context_json: string;
  input_tokens: number;
  output_tokens: number;
  nsfw: number;
  character_id: number;
  char_name: string;
  char_nsfw: number;
};

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/\{"honorifics"/);
  if (j >= 0) s = s.slice(0, j);
  return s.trim();
}

function classifyBlock(block: string): StopStructure {
  const t = block.trim();
  if (!t) return "other";
  if (
    /[,…]\s*$/.test(t) ||
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|말해지지)/.test(t.slice(-100))
  )
    return "tension_continuation";
  if (/(?:문이|문을|열리|닫히|나갔|들어|이동|걸어|달려|뛰|회전|돌아|장면이|다른 층|복도)/.test(t))
    return "scene_state_transition";
  if (
    /(?:공기가|분위기|향기|조명|어둠|온도|밀폐|실내|주변|철 상자|엘리베이터)/.test(t) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";
  if (/(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|반응을 기다)/.test(t))
    return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)) return "dialogue_resolution";
  if (/(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨)/.test(t))
    return "immediate_reaction";
  return "other";
}

function analyzeOutput(prose: string) {
  const paragraphs = prose.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.map(classifyBlock);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const terminalText = paragraphs[paragraphs.length - 1] ?? "";
  let terminalCategory: TerminalCategory = "other";
  if (terminal === "dialogue_resolution") terminalCategory = "dialogue_resolution";
  else if (terminal === "immediate_reaction") terminalCategory = "reaction_only";
  else if (terminal === "atmosphere_block") terminalCategory = "atmosphere";
  else if (terminal === "tension_continuation") terminalCategory = "tension_shift";
  else if (terminal === "scene_state_transition") terminalCategory = "followup_interaction";
  else if (/(?:속으로|마음|생각|의심|욕망|계산|떠올|결심|갈등|충동)/.test(terminalText))
    terminalCategory = "internal_state";
  return { blockCount: blocks.length, terminalStructure: terminal, terminalCategory, blocks };
}

function parseContext(ctx: string) {
  try {
    return JSON.parse(ctx) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseUsage(u: string | null) {
  if (!u) return {};
  try {
    return JSON.parse(u) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tensionScore(text: string): number {
  let s = 0;
  if (/(?:하지만|그런데|아직|더 |긴장|압박|위험|떨|흔들|말문|질문|걸려|파고들)/.test(text)) s += 2;
  if (/(?:엘리베이터|밀폐|어둠|고장|떨어져|무서워|손목|밀어|당기)/.test(text)) s += 1;
  if (/(?:안도|편안|웃음|미소|따뜻|포근|해결)/.test(text)) s -= 1;
  return s;
}

function characterCount(text: string): number {
  const names = text.match(/[가-힣]{2,4}(?:은|는|이|가|을|를|의|과|와)/g) ?? [];
  return new Set(names.map((n) => n.replace(/(은|는|이|가|을|를|의|과|와)$/, ""))).size;
}

function sceneType(text: string): string {
  if (/엘리베이터|층|복도|철 상자/.test(text)) return "elevator";
  if (/침대|방|호텔|샤워|목욕/.test(text)) return "bedroom";
  if (/편의점|알바|매장/.test(text)) return "store";
  if (/전쟁|군|총|전투/.test(text)) return "war";
  if (/가족|부모|형|누나/.test(text)) return "family";
  return "other";
}

function mean(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function extractFeatures(row: Row, prose: string, ctx: Record<string, unknown>, usage: Record<string, unknown>) {
  const analysis = analyzeOutput(prose);
  const audit = (ctx.promptAudit as Record<string, unknown> | undefined) ?? {};
  const breakdown = (audit.breakdown as Record<string, number> | undefined) ?? {};
  const systemTokens = Number(audit.systemPromptTokens ?? 0);
  const historyTokens = Number(audit.historyTokens ?? 0);
  const userTurnTokens = Number(audit.currentUserTurnTokens ?? 0);
  const historyTurns = Number(ctx.completedTurns ?? 0);

  return {
    message_id: row.message_id,
    chat_id: row.chat_id,
    model: row.model,
    created_at: row.created_at,
    prompt_hash: row.prompt_hash || "unknown",
    system_tokens: systemTokens,
    system_chars_est: systemTokens * 4,
    history_tokens: historyTokens,
    history_chars_est: historyTokens * 4,
    user_tokens: userTurnTokens,
    user_chars_est: userTurnTokens * 4,
    history_turns: historyTurns,
    target_response_chars: Number(ctx.targetResponseChars ?? 0),
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    finish_reason: String(usage.finishReason ?? usage.finish_reason ?? "unknown"),
    output_chars: prose.length,
    output_blocks: analysis.blockCount,
    terminal_beat: analysis.terminalCategory,
    terminal_structure: analysis.terminalStructure,
    nsfw: row.nsfw === 1 || row.char_nsfw === 1,
    scene_type: sceneType(prose + row.content),
    character_count_est: characterCount(prose),
    tension_score: tensionScore(prose),
    breakdown_system_rules: breakdown.systemRules ?? 0,
    breakdown_character: breakdown.characterSettings ?? 0,
    breakdown_dynamic: breakdown.dynamic ?? 0,
    route: String(ctx.route ?? ""),
    regenerate: Boolean(ctx.regenerate),
    has_generation_snapshot: true,
  };
}

function main() {
  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { readonly: true });

  const rows = db
    .prepare(
      `
    SELECT m.id AS message_id, m.chat_id, m.model, m.content, m.usage, m.created_at,
           mg.prompt_hash, mg.context_json, mg.input_tokens, mg.output_tokens, mg.nsfw,
           mg.character_id, c.name AS char_name, c.nsfw AS char_nsfw
    FROM messages m
    INNER JOIN message_generations mg ON mg.message_id = m.id
    LEFT JOIN characters c ON c.id = mg.character_id
    WHERE m.role = 'assistant'
      AND m.model LIKE '%deepseek%'
      AND m.model != 'greeting'
    ORDER BY m.created_at ASC
  `
    )
    .all() as Row[];

  const withGen = rows.map((row) => {
    const prose = displayProse(row.content);
    const ctx = parseContext(row.context_json);
    const usage = parseUsage(row.usage);
    return extractFeatures(row, prose, ctx, usage);
  });

  // Fallback: messages without message_generations
  const noGen = db
    .prepare(
      `
    SELECT m.id AS message_id, m.chat_id, m.model, m.content, m.usage, m.created_at,
           '' AS prompt_hash, '{}' AS context_json, 0 AS input_tokens, 0 AS output_tokens, 0 AS nsfw,
           ch.character_id, c.name AS char_name, c.nsfw AS char_nsfw
    FROM messages m
    JOIN chats ch ON ch.id = m.chat_id
    LEFT JOIN characters c ON c.id = ch.character_id
    WHERE m.role = 'assistant'
      AND m.model LIKE '%deepseek%'
      AND m.model != 'greeting'
      AND NOT EXISTS (SELECT 1 FROM message_generations mg WHERE mg.message_id = m.id)
    ORDER BY m.created_at ASC
  `
    )
    .all() as Row[];

  for (const row of noGen) {
    const prose = displayProse(row.content);
    const ctx: Record<string, unknown> = {};
    const prior = db
      .prepare(
        `SELECT role, content FROM messages WHERE chat_id=? AND id < ? ORDER BY id ASC`
      )
      .all(row.chat_id, row.message_id) as { role: string; content: string }[];
    const userMsgs = prior.filter((m) => m.role === "user");
    const lastUser = userMsgs[userMsgs.length - 1]?.content ?? "";
    ctx.completedTurns = prior.filter((m) => m.role === "user").length;
    const usage = parseUsage(row.usage);
    const feat = extractFeatures(row, prose, ctx, usage);
    feat.user_chars_est = lastUser.length;
    feat.history_chars_est = prior
      .filter((m) => m.role === "assistant")
      .reduce((s, m) => s + displayProse(m.content).length, 0);
    feat.has_generation_snapshot = false;
    withGen.push(feat);
  }

  withGen.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const long1800 = withGen.filter((r) => r.output_chars >= 1800);
  const long2200 = withGen.filter((r) => r.output_chars >= 2200);
  const long3000 = withGen.filter((r) => r.output_chars >= 3000);

  const maxDate = withGen.length ? withGen[withGen.length - 1].created_at : "";
  const recentShort = withGen.filter(
    (r) => r.output_chars <= RECENT_SHORT_MAX && r.created_at >= subtractDays(maxDate, RECENT_WINDOW_DAYS)
  );

  const earlyLong = withGen.filter((r) => r.output_chars >= 1800);
  const comparePool =
    recentShort.length >= 5
      ? recentShort
      : withGen.filter((r) => r.output_chars < 1000).slice(-30);

  function groupStats(items: typeof withGen) {
    if (!items.length) return null;
    return {
      n: items.length,
      mean_output: mean(items.map((i) => i.output_chars)),
      mean_system_tokens: mean(items.map((i) => i.system_tokens).filter((x) => x > 0)),
      mean_history_tokens: mean(items.map((i) => i.history_tokens).filter((x) => x > 0)),
      mean_user_tokens: mean(items.map((i) => i.user_tokens).filter((x) => x > 0)),
      mean_history_turns: mean(items.map((i) => i.history_turns)),
      mean_input_tokens: mean(items.map((i) => i.input_tokens).filter((x) => x > 0)),
      mean_output_tokens: mean(items.map((i) => i.output_tokens).filter((x) => x > 0)),
      nsfw_rate: items.filter((i) => i.nsfw).length / items.length,
      finish_stop: items.filter((i) => i.finish_reason === "stop").length / items.length,
      finish_length: items.filter((i) => i.finish_reason === "length").length / items.length,
      tension_mean: mean(items.map((i) => i.tension_score)),
      scene_dist: countKey(items, (i) => i.scene_type),
      terminal_dist: countKey(items, (i) => i.terminal_beat),
      prompt_hashes: [...new Set(items.map((i) => i.prompt_hash))].length,
      date_min: items[0]?.created_at,
      date_max: items[items.length - 1]?.created_at,
    };
  }

  function countKey<T>(items: T[], fn: (i: T) => string) {
    const m: Record<string, number> = {};
    for (const i of items) m[fn(i)] = (m[fn(i)] ?? 0) + 1;
    return m;
  }

  function subtractDays(iso: string, days: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  const longStats = groupStats(earlyLong);
  const shortStats = groupStats(comparePool);

  const lines: string[] = [
    "DEEPSEEK LONG OUTPUT FORENSIC",
    `generated: ${new Date().toISOString()}`,
    `db: ${dbPath}`,
    `total deepseek assistant samples: ${withGen.length}`,
    `>=1800: ${long1800.length} | >=2200: ${long2200.length} | >=3000: ${long3000.length}`,
    `recent short (<=900ch, last ${RECENT_WINDOW_DAYS}d): ${recentShort.length}`,
    "",
    "## Long samples (>=1800ch) aggregate",
    JSON.stringify(longStats, null, 2),
    "",
    "## Comparison pool aggregate",
    JSON.stringify(shortStats, null, 2),
    "",
  ];

  if (longStats && shortStats) {
    lines.push("## Diff (long - short)");
    lines.push(`  output_chars: ${(longStats.mean_output - shortStats.mean_output).toFixed(0)}`);
    lines.push(`  system_tokens: ${(longStats.mean_system_tokens - shortStats.mean_system_tokens).toFixed(0)}`);
    lines.push(`  history_tokens: ${(longStats.mean_history_tokens - shortStats.mean_history_tokens).toFixed(0)}`);
    lines.push(`  user_tokens: ${(longStats.mean_user_tokens - shortStats.mean_user_tokens).toFixed(0)}`);
    lines.push(`  history_turns: ${(longStats.mean_history_turns - shortStats.mean_history_turns).toFixed(1)}`);
    lines.push(`  input_tokens: ${(longStats.mean_input_tokens - shortStats.mean_input_tokens).toFixed(0)}`);
    lines.push(`  output_tokens: ${(longStats.mean_output_tokens - shortStats.mean_output_tokens).toFixed(0)}`);
    lines.push(`  nsfw_rate: ${((longStats.nsfw_rate - shortStats.nsfw_rate) * 100).toFixed(1)}pp`);
    lines.push(`  finish_stop: ${((longStats.finish_stop - shortStats.finish_stop) * 100).toFixed(1)}pp`);
    lines.push(`  finish_length: ${((longStats.finish_length - shortStats.finish_length) * 100).toFixed(1)}pp`);
    lines.push(`  tension: ${(longStats.tension_mean - shortStats.tension_mean).toFixed(2)}`);
    lines.push(`  unique prompt_hashes long: ${longStats.prompt_hashes} vs short: ${shortStats.prompt_hashes}`);
    lines.push("");
  }

  for (const thresh of THRESHOLDS) {
    lines.push(`## Samples >= ${thresh}ch`);
    const subs = withGen.filter((r) => r.output_chars >= thresh);
    for (const s of subs.slice(0, 50)) {
      lines.push(
        `  id=${s.message_id} ${s.created_at} ${s.output_chars}ch finish=${s.finish_reason} sysTok=${s.system_tokens} histTok=${s.history_tokens} userTok=${s.user_tokens} turns=${s.history_turns} target=${s.target_response_chars} nsfw=${s.nsfw} scene=${s.scene_type} terminal=${s.terminal_beat} hash=${s.prompt_hash}`
      );
    }
    if (subs.length > 50) lines.push(`  ... +${subs.length - 50} more`);
    lines.push("");
  }

  // Cause ranking heuristic
  const causes: Array<{ name: string; score: number; note: string }> = [];
  if (longStats && shortStats) {
    const sysDiff = longStats.mean_system_tokens - shortStats.mean_system_tokens;
    if (Math.abs(sysDiff) > 100) causes.push({ name: "system_prompt_size", score: Math.abs(sysDiff) / 50, note: `Δsystem_tokens ${sysDiff.toFixed(0)}` });
    const histDiff = longStats.mean_history_tokens - shortStats.mean_history_tokens;
    if (Math.abs(histDiff) > 50) causes.push({ name: "history_length", score: Math.abs(histDiff) / 30, note: `Δhistory_tokens ${histDiff.toFixed(0)}` });
    const turnDiff = longStats.mean_history_turns - shortStats.mean_history_turns;
    if (Math.abs(turnDiff) > 0.5) causes.push({ name: "history_turns", score: Math.abs(turnDiff) * 2, note: `Δturns ${turnDiff.toFixed(1)}` });
    const hashDiff = longStats.prompt_hashes !== shortStats.prompt_hashes;
    if (hashDiff || longStats.prompt_hashes > 1) causes.push({ name: "prompt_version_change", score: 5, note: `hashes long=${longStats.prompt_hashes} short=${shortStats.prompt_hashes}` });
    const nsfwDiff = longStats.nsfw_rate - shortStats.nsfw_rate;
    if (Math.abs(nsfwDiff) > 0.15) causes.push({ name: "nsfw_scene_type", score: Math.abs(nsfwDiff) * 10, note: `Δnsfw ${(nsfwDiff * 100).toFixed(0)}pp` });
    const lenFinish = longStats.finish_length - shortStats.finish_length;
    if (lenFinish > 0.1) causes.push({ name: "finish_reason_length_cap", score: lenFinish * 15, note: "long outputs hit length finish more" });
    const stopDiff = longStats.finish_stop - shortStats.finish_stop;
    if (stopDiff < -0.1) causes.push({ name: "early_stop_finish", score: Math.abs(stopDiff) * 10, note: "recent short stops more often with stop" });
    const tensionDiff = longStats.tension_mean - shortStats.tension_mean;
    if (tensionDiff > 0.3) causes.push({ name: "input_tension", score: tensionDiff * 3, note: `Δtension ${tensionDiff.toFixed(2)}` });
    const outTok = longStats.mean_output_tokens - shortStats.mean_output_tokens;
    if (outTok > 100) causes.push({ name: "model_token_budget", score: outTok / 200, note: `Δoutput_tokens ${outTok.toFixed(0)}` });
  }
  causes.sort((a, b) => b.score - a.score);

  lines.push("## Cause candidates (ranked)");
  for (const c of causes) {
    lines.push(`  ${c.score.toFixed(1)} — ${c.name}: ${c.note}`);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-long-output-deepseek-report.txt");
  const jsonlPath = path.join(outDir, "forensic-long-output-deepseek.jsonl");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  fs.writeFileSync(jsonlPath, withGen.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main();
