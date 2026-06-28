/**
 * Production forensic — output beat structure (long vs short), prompt composition from DB only.
 * No API calls. No prompt changes.
 *
 * Usage: npx.cmd tsx scripts/forensic-output-structure-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDatabasePath } from "../src/lib/dataDir";

const LONG_N = 10;
const SHORT_N = 10;
const FLOOR_CHARS = 2200;
const SHORT_TARGET_MID = 800;
const SHORT_EXPAND_MAX = 1200;

type BeatType = "dialogue" | "action" | "internal" | "sensory" | "narration";
type Centric = "dialogue-centric" | "internal-centric" | "description-centric";

type Row = {
  message_id: number;
  chat_id: number;
  model: string;
  content: string;
  usage: string | null;
  created_at: string;
  prompt_hash: string;
  context_json: string;
  input_tokens: number;
  output_tokens: number;
  user_message_id: number | null;
};

const INTERNAL_RE =
  /(?:속으로|마음속|머릿속|혼잣말|되뇌|스스로에게|생각했|떠올|의심했|욕망|결심|갈등|충동|회의|심경|마음이|뇌리에|속마음|내심|심장이|가슴이.*(?:했다|컸|졌))/;

const SENSORY_RE =
  /(?:향|냄새|향기|온기|차가|뜨거|미지근|촉감|질감|부드러|거친|소리|울려|귓|눈에|시야|빛|어둠|습|땀|맥박|심장|열기|온도|밀폐|느껴|감지|스쳐|퍼져|번져|달아오|오돌오돌|파르르|뒤죽박죽|공기|정적|고요|향기|촉|질감|온기|차가|뜨)/;

const ACTION_RE =
  /(?:걸음|뛰|달리|움직|손가락|손을|손목|눈을|고개|몸을|일어|앉|쥐|잡|당기|밀|뻗|내밀|돌아|향해|열|닫|쓸|키스|안아|품|기울|숙|넘어|당|끌|박|삼|빨|넣|빼|벗|풀|움츠|떨|흔들|일그|비비|문지|쓸어|파고|가져|놓|맞|받|쏟|쏙|내려|올려|찍|감싸|파고들|기대|몸을|내밀|뻗|쥐어|꽉|끼|포개|만지|쓸|밀어|당겨|끌어|움직|일어나|돌리|향하)/;

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/\{"honorifics"/);
  if (j >= 0) s = s.slice(0, j);
  return s.trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function classifyNarrationBeat(text: string): BeatType {
  const t = text.trim();
  if (!t) return "narration";
  if (INTERNAL_RE.test(t)) return "internal";
  if (SENSORY_RE.test(t)) return "sensory";
  if (ACTION_RE.test(t)) return "action";
  return "narration";
}

function classifyBeatText(text: string): BeatType {
  const t = text.trim();
  if (!t) return "narration";
  if (/^"[^"]*"$/.test(t)) return "dialogue";
  const quotes = t.match(/"[^"]*"/g);
  if (quotes && quotes.join("").length >= t.length * 0.6) return "dialogue";
  return classifyNarrationBeat(t);
}

function segmentBeats(text: string): { type: BeatType; chars: number; preview: string }[] {
  const beats: { type: BeatType; chars: number; preview: string }[] = [];
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());

  for (const para of paragraphs) {
    let lastIndex = 0;
    const dialogueRegex = /"[^"]*"/g;
    let match: RegExpExecArray | null;
    while ((match = dialogueRegex.exec(para)) !== null) {
      if (match.index > lastIndex) {
        for (const sent of splitSentences(para.slice(lastIndex, match.index))) {
          const type = classifyBeatText(sent);
          beats.push({ type, chars: sent.length, preview: sent.slice(0, 80) });
        }
      }
      const dlg = match[0];
      beats.push({ type: "dialogue", chars: dlg.length, preview: dlg.slice(0, 80) });
      lastIndex = match.index + dlg.length;
    }
    if (lastIndex < para.length) {
      for (const sent of splitSentences(para.slice(lastIndex))) {
        const type = classifyBeatText(sent);
        beats.push({ type, chars: sent.length, preview: sent.slice(0, 80) });
      }
    }
    if (lastIndex === 0 && !match) {
      for (const sent of splitSentences(para)) {
        const type = classifyBeatText(sent);
        beats.push({ type, chars: sent.length, preview: sent.slice(0, 80) });
      }
    }
  }
  return beats;
}

function beatRatios(beats: { type: BeatType; chars: number }[]) {
  const total = beats.reduce((s, b) => s + b.chars, 0) || 1;
  const sums: Record<BeatType, number> = {
    dialogue: 0,
    action: 0,
    internal: 0,
    sensory: 0,
    narration: 0,
  };
  for (const b of beats) sums[b.type] += b.chars;
  const ratios: Record<BeatType, number> = { ...sums };
  for (const k of Object.keys(sums) as BeatType[]) ratios[k] = sums[k] / total;
  return { sums, ratios, totalChars: total, beatCount: beats.length };
}

function classifyCentric(ratios: Record<BeatType, number>): Centric {
  const desc = ratios.action + ratios.sensory + ratios.narration;
  if (ratios.dialogue >= ratios.internal && ratios.dialogue >= desc) return "dialogue-centric";
  if (ratios.internal > ratios.dialogue && ratios.internal >= ratios.action && ratios.internal >= ratios.sensory)
    return "internal-centric";
  return "description-centric";
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

function extractPromptComposition(ctx: Record<string, unknown>, promptHash: string) {
  const audit = (ctx.promptAudit as Record<string, unknown> | undefined) ?? {};
  const bd = (audit.breakdown as Record<string, number> | undefined) ?? {};
  return {
    prompt_hash: promptHash,
    completed_turns: Number(ctx.completedTurns ?? 0),
    target_response_chars: Number(ctx.targetResponseChars ?? 0),
    route: String(ctx.route ?? ""),
    nsfw: Boolean(ctx.nsfw),
    system_rules_tokens: bd.systemRules ?? 0,
    character_setting_tokens: bd.characterSetting ?? 0,
    world_lore_tokens: bd.worldLore ?? 0,
    memory_tokens: bd.memory ?? 0,
    persona_tokens: bd.persona ?? 0,
    user_note_tokens: bd.userNote ?? 0,
    dialogue_examples_tokens: bd.dialogueExamples ?? 0,
    recent_conversation_tokens: bd.recentConversation ?? 0,
    system_prompt_tokens: Number(audit.systemPromptTokens ?? 0),
    history_tokens: Number(audit.historyTokens ?? 0),
    user_turn_tokens: Number(audit.currentUserTurnTokens ?? 0),
    total_assembled_tokens: Number(audit.totalAssembledTokens ?? 0),
    section_count: Number(audit.sectionCount ?? 0),
  };
}

function mean(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function analyzeSample(
  row: Row,
  userContent: string,
  label: string
) {
  const prose = displayProse(row.content);
  const ctx = parseContext(row.context_json);
  const usage = parseUsage(row.usage);
  const beats = segmentBeats(prose);
  const { sums, ratios, totalChars, beatCount } = beatRatios(beats);
  const centric = classifyCentric(ratios);
  const prompt = extractPromptComposition(ctx, row.prompt_hash);

  return {
    label,
    message_id: row.message_id,
    chat_id: row.chat_id,
    created_at: row.created_at,
    output_chars: prose.length,
    finish_reason: String(usage.finishReason ?? usage.finish_reason ?? "unknown"),
    completion_tokens: row.output_tokens,
    input_tokens: row.input_tokens,
    user_message_chars: userContent.length,
    user_message_preview: userContent.slice(0, 120).replace(/\n/g, " "),
    prompt,
    beat_count: beatCount,
    beat_char_sums: sums,
    beat_ratios_pct: Object.fromEntries(
      (Object.keys(ratios) as BeatType[]).map((k) => [k, Math.round(ratios[k] * 1000) / 10])
    ),
    centric,
    beats_sample: beats.slice(0, 8).map((b) => ({ type: b.type, preview: b.preview })),
    beats_tail: beats.slice(-3).map((b) => ({ type: b.type, preview: b.preview })),
  };
}

function formatSampleBlock(s: ReturnType<typeof analyzeSample>) {
  const p = s.prompt;
  const lines = [
    `### ${s.label} message_id=${s.message_id} chat_id=${s.chat_id} ${s.created_at}`,
    `  output_chars=${s.output_chars} finish=${s.finish_reason} completion_tokens=${s.completion_tokens} input_tokens=${s.input_tokens}`,
    `  user_chars=${s.user_message_chars} preview="${s.user_message_preview}"`,
    `  prompt: hash=${p.prompt_hash} turns=${p.completed_turns} target=${p.target_response_chars} route=${p.route} nsfw=${p.nsfw}`,
    `  prompt tokens: system=${p.system_prompt_tokens} history=${p.history_tokens} user_turn=${p.user_turn_tokens} total=${p.total_assembled_tokens}`,
    `  breakdown: rules=${p.system_rules_tokens} char=${p.character_setting_tokens} lore=${p.world_lore_tokens} memory=${p.memory_tokens} persona=${p.persona_tokens} user_note=${p.user_note_tokens} dlg_ex=${p.dialogue_examples_tokens} recent_conv=${p.recent_conversation_tokens}`,
    `  beats=${s.beat_count} centric=${s.centric}`,
    `  ratios(%): dialogue=${s.beat_ratios_pct.dialogue} action=${s.beat_ratios_pct.action} internal=${s.beat_ratios_pct.internal} sensory=${s.beat_ratios_pct.sensory} narration=${s.beat_ratios_pct.narration}`,
    `  tail beats: ${s.beats_tail.map((b) => b.type).join(" → ")}`,
  ];
  return lines.join("\n");
}

function aggregateGroup(samples: ReturnType<typeof analyzeSample>[]) {
  const types: BeatType[] = ["dialogue", "action", "internal", "sensory", "narration"];
  const meanRatios: Record<string, number> = {};
  for (const t of types) {
    meanRatios[t] = mean(samples.map((s) => Number(s.beat_ratios_pct[t] ?? 0)));
  }
  const centricDist: Record<string, number> = {};
  for (const s of samples) centricDist[s.centric] = (centricDist[s.centric] ?? 0) + 1;
  return {
    n: samples.length,
    mean_output_chars: mean(samples.map((s) => s.output_chars)),
    mean_beat_count: mean(samples.map((s) => s.beat_count)),
    mean_ratios_pct: meanRatios,
    centric_dist: centricDist,
    mean_history_tokens: mean(samples.map((s) => s.prompt.history_tokens)),
    mean_user_turn_tokens: mean(samples.map((s) => s.prompt.user_turn_tokens)),
    mean_system_tokens: mean(samples.map((s) => s.prompt.system_prompt_tokens)),
    mean_recent_conv_tokens: mean(samples.map((s) => s.prompt.recent_conversation_tokens)),
  };
}

function main() {
  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { readonly: true });

  const rows = db
    .prepare(
      `
    SELECT m.id AS message_id, m.chat_id, m.model, m.content, m.usage, m.created_at,
           COALESCE(mg.prompt_hash, '') AS prompt_hash,
           COALESCE(mg.context_json, '{}') AS context_json,
           COALESCE(mg.input_tokens, 0) AS input_tokens,
           COALESCE(mg.output_tokens, 0) AS output_tokens,
           mg.user_message_id
    FROM messages m
    LEFT JOIN message_generations mg ON mg.message_id = m.id
    WHERE m.role = 'assistant'
      AND m.model LIKE '%deepseek%'
      AND m.model != 'greeting'
    ORDER BY m.created_at ASC
  `
    )
    .all() as Row[];

  const byMsg = new Map<number, Row>();
  for (const row of rows) {
    const existing = byMsg.get(row.message_id);
    if (!existing) {
      byMsg.set(row.message_id, row);
      continue;
    }
    if (row.output_tokens > existing.output_tokens) byMsg.set(row.message_id, row);
    else if (!existing.prompt_hash && row.prompt_hash) byMsg.set(row.message_id, row);
  }

  const all = [...byMsg.values()].map((row) => {
    const prose = displayProse(row.content);
    return { row, proseLen: prose.length };
  });

  const longCandidates = [...all].sort((a, b) => b.proseLen - a.proseLen).slice(0, LONG_N);

  const shortInBand = all
    .filter((x) => x.proseLen >= 700 && x.proseLen <= 900)
    .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at));

  let shortCandidates: typeof all;
  let shortPoolNote: string;
  if (shortInBand.length >= SHORT_N) {
    shortCandidates = shortInBand.slice(0, SHORT_N);
    shortPoolNote = "700-900ch recent (strict band)";
  } else {
    const expandable = all
      .filter((x) => x.proseLen < FLOOR_CHARS && x.proseLen <= SHORT_EXPAND_MAX)
      .sort((a, b) => {
        const distA = Math.abs(a.proseLen - SHORT_TARGET_MID);
        const distB = Math.abs(b.proseLen - SHORT_TARGET_MID);
        if (distA !== distB) return distA - distB;
        return b.row.created_at.localeCompare(a.row.created_at);
      });
    shortCandidates = expandable.slice(0, SHORT_N);
    shortPoolNote = `strict 700-900 had ${shortInBand.length}; expanded to <${FLOOR_CHARS}ch ≤${SHORT_EXPAND_MAX}ch closest to ${SHORT_TARGET_MID}ch`;
  }

  function userContent(row: Row): string {
    if (row.user_message_id) {
      const u = db
        .prepare(`SELECT content FROM messages WHERE id = ?`)
        .get(row.user_message_id) as { content: string } | undefined;
      if (u?.content) return u.content.trim();
    }
    const prior = db
      .prepare(
        `SELECT role, content FROM messages WHERE chat_id=? AND id < ? ORDER BY id ASC`
      )
      .all(row.chat_id, row.message_id) as { role: string; content: string }[];
    const users = prior.filter((m) => m.role === "user");
    return users[users.length - 1]?.content?.trim() ?? "";
  }

  const longSamples = longCandidates.map((x, i) =>
    analyzeSample(x.row, userContent(x.row), `LONG#${i + 1}`)
  );
  const shortSamples = shortCandidates.map((x, i) =>
    analyzeSample(x.row, userContent(x.row), `SHORT#${i + 1}`)
  );

  const longAgg = aggregateGroup(longSamples);
  const shortAgg = aggregateGroup(shortSamples);

  // Lab 5523 reference (not in DB — metadata only from sweep jsonl)
  let lab5523Note = "history-depth-sweep jsonl not found";
  const sweepPath = path.resolve("output/history-depth-sweep.jsonl");
  if (fs.existsSync(sweepPath)) {
    const sweep = fs
      .readFileSync(sweepPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const max = sweep.reduce(
      (best: { output_chars?: number }, s: { output_chars?: number }) =>
        (s.output_chars ?? 0) > (best.output_chars ?? 0) ? s : best,
      {}
    );
    lab5523Note = JSON.stringify({
      source: "lab history-depth-sweep (NOT production DB)",
      depth: max.depth,
      run: max.run,
      output_chars: max.output_chars,
      history_tokens: max.history_tokens,
      system_tokens: max.system_tokens,
      finish_reason: max.finish_reason,
      targetResponseChars_fixture: 3300,
      user_tokens_fixture: 26,
      note: "full assistant text not stored in jsonl — beat analysis unavailable",
    });
  }

  const ref4492 = longSamples.find((s) => s.output_chars >= 4490) ?? longSamples[0];

  const lines: string[] = [
    "PRODUCTION FORENSIC — OUTPUT STRUCTURE (DeepSeek)",
    `generated: ${new Date().toISOString()}`,
    `db: ${dbPath}`,
    `unique messages with generations: ${byMsg.size}`,
    `long pool top ${LONG_N} by prose length | short pool: ${shortPoolNote}`,
    "",
    "## Reference: 5523ch lab sample vs 4492ch production",
    `  LAB 5523 (not in DB): ${lab5523Note}`,
    `  PROD ~4492: message_id=${ref4492?.message_id} output_chars=${ref4492?.output_chars}`,
  ];
  if (ref4492) {
    const p = ref4492.prompt;
    lines.push(
      `    prod prompt: history_tokens=${p.history_tokens} user_turn=${p.user_turn_tokens} system=${p.system_prompt_tokens} target=${p.target_response_chars} recent_conv=${p.recent_conversation_tokens}`
    );
    lines.push(
      `    prod structure: centric=${ref4492.centric} ratios=${JSON.stringify(ref4492.beat_ratios_pct)} beats=${ref4492.beat_count}`
    );
  }
  lines.push("");

  lines.push("## 1. Long samples (top 10 by output_chars)");
  for (const s of longSamples) {
    lines.push(formatSampleBlock(s));
    lines.push("");
  }

  lines.push("## 4. Short samples (below FLOOR, closest to 700-900ch)");
  lines.push(`  pool: ${shortPoolNote}`);
  if (shortSamples.length < SHORT_N) {
    lines.push(`  (only ${shortSamples.length} samples available in DB)`);
  }
  for (const s of shortSamples) {
    lines.push(formatSampleBlock(s));
    lines.push("");
  }

  lines.push("## 3. Centric classification summary");
  lines.push("  Long group:");
  for (const s of longSamples) {
    lines.push(`    id=${s.message_id} ${s.output_chars}ch → ${s.centric}`);
  }
  lines.push("  Short group:");
  for (const s of shortSamples) {
    lines.push(`    id=${s.message_id} ${s.output_chars}ch → ${s.centric}`);
  }
  lines.push("");

  lines.push("## 5. Group aggregate — long vs short");
  lines.push(`  LONG: ${JSON.stringify(longAgg, null, 2)}`);
  lines.push(`  SHORT: ${JSON.stringify(shortAgg, null, 2)}`);
  lines.push("");
  lines.push("## 5b. Ratio deltas (long − short, percentage points)");
  const types: BeatType[] = ["dialogue", "action", "internal", "sensory", "narration"];
  for (const t of types) {
    const d = longAgg.mean_ratios_pct[t] - shortAgg.mean_ratios_pct[t];
    lines.push(`  ${t}: ${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`);
  }
  lines.push(
    `  output_chars: +${(longAgg.mean_output_chars - shortAgg.mean_output_chars).toFixed(0)}`
  );
  lines.push(
    `  beat_count: +${(longAgg.mean_beat_count - shortAgg.mean_beat_count).toFixed(1)}`
  );
  lines.push(
    `  history_tokens: +${(longAgg.mean_history_tokens - shortAgg.mean_history_tokens).toFixed(0)}`
  );
  lines.push(
    `  user_turn_tokens: +${(longAgg.mean_user_turn_tokens - shortAgg.mean_user_turn_tokens).toFixed(0)}`
  );
  lines.push(
    `  recent_conv_tokens: +${(longAgg.mean_recent_conv_tokens - shortAgg.mean_recent_conv_tokens).toFixed(0)}`
  );

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-output-structure-deepseek-report.txt");
  const jsonlPath = path.join(outDir, "forensic-output-structure-deepseek.jsonl");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  const allOut = [...longSamples, ...shortSamples];
  fs.writeFileSync(jsonlPath, allOut.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${jsonlPath}`);
}

main();
