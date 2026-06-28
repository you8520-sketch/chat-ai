/**
 * History Depth Sweep — DeepSeek only, Phase2 prompt unchanged, history depth sole variable.
 * 7 depths × 5 runs = 35 API calls max.
 * Usage: npx.cmd tsx scripts/history-depth-sweep-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL_ID = "deepseek/deepseek-v4-pro";
const DEPTHS = [0, 2, 4, 6, 8, 10, 12] as const;
const RUNS = 5;
const MAX_CALLS = 35;
const FLOOR = 2200;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;
const TARGET_CHARS = 3300;
const USER_CURRENT = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";

type Depth = typeof DEPTHS[number];

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

type Sample = {
  depth: Depth;
  run: number;
  history_turns: number;
  history_tokens: number;
  system_tokens: number;
  output_chars: number;
  floor_pass: boolean;
  finish_reason: string;
  block_count: number;
  stop_after: StopStructure;
  terminal_structure: StopStructure;
  terminal_beat: TerminalCategory;
  s1: boolean;
  s2: boolean;
  s3: boolean;
  s4: boolean;
  s5: boolean;
  s6: boolean;
  s_all: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
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

function analyzeStop(prose: string) {
  const paragraphs = prose.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.map(classifyBlock);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const stopAfter = blocks.length >= 2 ? blocks[blocks.length - 2] : terminal;
  const terminalText = paragraphs[paragraphs.length - 1] ?? "";
  let terminalBeat: TerminalCategory = "other";
  if (terminal === "dialogue_resolution") terminalBeat = "dialogue_resolution";
  else if (terminal === "immediate_reaction") terminalBeat = "reaction_only";
  else if (terminal === "atmosphere_block") terminalBeat = "atmosphere";
  else if (terminal === "tension_continuation") terminalBeat = "tension_shift";
  else if (terminal === "scene_state_transition") terminalBeat = "followup_interaction";
  else if (/(?:속으로|마음|생각|의심|욕망|계산|떠올|결심|갈등|충동)/.test(terminalText))
    terminalBeat = "internal_state";
  return { blockCount: blocks.length, stopAfter, terminal, terminalBeat };
}

function detectSStages(prose: string) {
  const s1 = /"[^"]{2,}"/.test(prose);
  const s2 = /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨|반응|움찔)/.test(prose);
  const s3 = /(?:공기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|엘리베이터|소리|냄새|빛|차가|따뜻)/.test(prose);
  const s4 = /(?:속으로|마음|생각|의심|욕망|계산|떠올|결심|갈등|충동|끓어|의구심|속마음|심장)/.test(prose);
  const s5 = /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|긴장|압박|말문|질문)/.test(prose);
  const tail = prose.slice(Math.floor(prose.length * 0.4));
  const s6 = /(?:한 걸음|다가|손을|뻗|당기|밀|말을|입을|돌아|나아|움직|일어|잡|쥐|키스|안아|밀어|당겨)/.test(tail);
  return { s1, s2, s3, s4, s5, s6, s_all: s1 && s2 && s3 && s4 && s5 && s6 };
}

function pearson(xs: number[], ys: number[]) {
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

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function pct(n: number, t: number) {
  return t ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

/** Load escalating real assistant texts from production DB for history momentum */
function loadHistoryTemplates(): { user: string; assistant: string }[] {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT content FROM messages
       WHERE role='assistant' AND model LIKE '%deepseek%' AND LENGTH(content) > 800
       ORDER BY id ASC`
    )
    .all() as { content: string }[];

  const templates: { user: string; assistant: string }[] = [];
  const userAlts = [
    "자동진행",
    "…여기 오래 갇혀 있었어?",
    "가이드님… 무서워.",
    "손 잡아줄래?",
    "이대로 계속 있어도 괜찮아?",
    "떨어지면 어떡해…",
    "백하율… 지금 뭐 하는 거야?",
  ];

  for (let i = 0; i < rows.length && templates.length < 8; i++) {
    let s = rows[i].content;
    const idx = s.search(/<<<STATUS/i);
    if (idx >= 0) s = s.slice(0, idx);
    const prose = s.trim();
    if (prose.length < 400) continue;
    templates.push({
      user: userAlts[templates.length % userAlts.length],
      assistant: prose.slice(0, Math.min(prose.length, 4500)),
    });
  }
  db.close();

  if (templates.length < 4) {
    return [
      {
        user: "자동진행",
        assistant:
          "백하율은 렌의 손목을 잡은 채 엘리베이터 벽에 등을 댔다. 좁은 공간 안 온도가 뒤섞였다.",
      },
      {
        user: "…여기 오래 갇혀 있었어?",
        assistant: `"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?"\n\n렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다. 엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다.`,
      },
      ...templates,
    ];
  }
  return templates;
}

function buildHistoryMessages(depth: Depth, templates: { user: string; assistant: string }[]) {
  const pairsNeeded = depth / 2;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < pairsNeeded; i++) {
    const t = templates[i % templates.length];
    messages.push({ role: "user", content: t.user });
    messages.push({ role: "assistant", content: t.assistant });
  }
  messages.push({ role: "user", content: USER_CURRENT });
  return messages;
}

async function buildContextForDepth(depth: Depth, templates: { user: string; assistant: string }[]) {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const persona = "렌";
  const historyMessages = buildHistoryMessages(depth, templates);
  const turns = messagesToTurns(historyMessages.map((m) => ({ ...m, model: "assistant" })));
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", turns.length)
  );
  const chunks = parseCharacterSetting({
    characterId: "hd-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: USER_CURRENT,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: depth > 0 ? depth : 1,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const split = built.openRouterSystemSplit!;
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const audit = built.meta.promptAudit;

  return {
    charName,
    history,
    userMessage: USER_CURRENT,
    split,
    historyTokens: audit?.historyTokens ?? 0,
    systemTokens: audit?.systemPromptTokens ?? 0,
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample;
    if (typeof j.output_chars === "number") done.add(`${j.depth}|${j.run}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.output_chars !== "number") continue;
    byKey.set(`${s.depth}|${s.run}`, s);
  }
  return [...byKey.values()];
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const templates = loadHistoryTemplates();
  console.log(`History templates loaded: ${templates.length} (lengths: ${templates.map((t) => t.assistant.length).join(",")})`);

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "history-depth-sweep.jsonl");
  const reportPath = path.join(outDir, "history-depth-sweep-report.txt");
  const done = loadDone(jsonlPath);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  for (const depth of DEPTHS) {
    const ctx = await buildContextForDepth(depth, templates);
    const system = [ctx.split.systemRulesBlock, ctx.split.characterSettingsBlock, ctx.split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n");
    console.log(
      `\n=== depth=${depth} historyTokens=${ctx.historyTokens} systemTokens=${ctx.systemTokens} historyMsgs=${ctx.history.length} ===`
    );

    for (let run = 1; run <= RUNS; run++) {
      const key = `${depth}|${run}`;
      if (done.has(key)) {
        console.log(`depth ${depth} run ${run}/${RUNS} skip (done)`);
        continue;
      }
      if (apiCalls >= MAX_CALLS) {
        console.error(`MAX_CALLS ${MAX_CALLS} reached`);
        process.exit(3);
      }
      process.stdout.write(`depth ${depth} run ${run}/${RUNS}\n`);
      let ok = false;
      for (let att = 1; att <= MAX_ATTEMPTS; att++) {
        await sleep(DELAY_MS);
        apiCalls++;
        try {
          const result = await callOpenRouterAdult(
            system,
            [...ctx.history, { role: "user", content: ctx.userMessage }],
            MODEL_ID,
            TARGET_CHARS,
            { charName: ctx.charName, systemSplit: ctx.split },
            { chargeTurnBudget: false, requestKind: "history-depth-sweep" }
          );
          const prose = displayProse(result.text);
          const stop = analyzeStop(prose);
          const stages = detectSStages(prose);
          const sample: Sample = {
            depth,
            run,
            history_turns: depth,
            history_tokens: ctx.historyTokens,
            system_tokens: ctx.systemTokens,
            output_chars: prose.length,
            floor_pass: prose.length >= FLOOR,
            finish_reason: String(result.usage?.finishReason ?? "unknown"),
            block_count: stop.blockCount,
            stop_after: stop.stopAfter,
            terminal_structure: stop.terminal,
            terminal_beat: stop.terminalBeat,
            s1: stages.s1,
            s2: stages.s2,
            s3: stages.s3,
            s4: stages.s4,
            s5: stages.s5,
            s6: stages.s6,
            s_all: stages.s_all,
          };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(
            `  ok ${sample.output_chars}ch histTok=${sample.history_tokens} floor=${sample.floor_pass} finish=${sample.finish_reason} S_all=${sample.s_all} terminal=${sample.terminal_beat}`
          );
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 100)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(jsonlPath, JSON.stringify({ depth, run, error: "failed" }) + "\n", "utf8");
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const lines: string[] = [
    "HISTORY DEPTH SWEEP — DeepSeek V4 Pro",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · depths=${DEPTHS.join(",")} · runs=${RUNS} · apiCalls=${apiCalls}`,
    "prompt: Phase2 baseline unchanged · only history depth varied",
    "",
  ];

  const histToks = samples.map((s) => s.history_tokens);
  const outChars = samples.map((s) => s.output_chars);
  const r = pearson(histToks, outChars);
  lines.push(`Pearson r(history_tokens, output_chars): ${r === null ? "n/a" : r.toFixed(3)} (n=${samples.length})`);
  lines.push("");

  for (const depth of DEPTHS) {
    const sub = samples.filter((s) => s.depth === depth);
    if (!sub.length) continue;
    const ht = sub[0].history_tokens;
    lines.push(`### depth=${depth} (history_tokens≈${ht}, n=${sub.length})`);
    lines.push(
      `  mean_out=${mean(sub.map((s) => s.output_chars)).toFixed(0)}ch  FLOOR=${pct(sub.filter((s) => s.floor_pass).length, sub.length)}  mean_blocks=${mean(sub.map((s) => s.block_count)).toFixed(1)}`
    );
    lines.push(
      `  S_all=${pct(sub.filter((s) => s.s_all).length, sub.length)}  finish_stop=${pct(sub.filter((s) => s.finish_reason === "stop").length, sub.length)}`
    );
    const term: Record<string, number> = {};
    for (const s of sub) term[s.terminal_beat] = (term[s.terminal_beat] ?? 0) + 1;
    lines.push(`  terminal: ${Object.entries(term).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    lines.push("");
  }

  const thresholds = [5000, 8000, 10000];
  lines.push("## Token threshold buckets (by configured depth)");
  for (const th of thresholds) {
    const above = samples.filter((s) => s.history_tokens > th);
    const below = samples.filter((s) => s.history_tokens <= th && s.history_tokens > 0);
    if (!above.length) {
      lines.push(`  history>${th}: no samples reached this history_tokens level in sweep`);
      continue;
    }
    lines.push(
      `  history>${th}: n=${above.length} mean_out=${mean(above.map((s) => s.output_chars)).toFixed(0)} FLOOR=${pct(above.filter((s) => s.floor_pass).length, above.length)}`
    );
    if (below.length) {
      lines.push(
        `  history<=${th}: n=${below.length} mean_out=${mean(below.map((s) => s.output_chars)).toFixed(0)} Δ=${(mean(above.map((s) => s.output_chars)) - mean(below.map((s) => s.output_chars))).toFixed(0)}`
      );
    }
  }

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
