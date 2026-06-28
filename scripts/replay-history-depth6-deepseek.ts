/**
 * Replay history-depth-sweep depth=6 fixture — DeepSeek only, Phase2 prompt unchanged.
 * Single-arm A/B with no A/B: depth=6 only, 5 runs max (5 API calls).
 *
 * Goal: check if the 5523-char length-finish sample from history-depth-sweep
 * is reproducible under identical system/history/user/model/targetResponseChars.
 *
 * Usage: npx.cmd tsx scripts/replay-history-depth6-deepseek.ts
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
const DEPTH: 6 = 6;
const RUNS = 5;
const MAX_CALLS = 5;
const TARGET_CHARS = 3300;
const USER_CURRENT = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";

type Depth = 6;

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type Sample = {
  run: number;
  output_chars: number;
  finish_reason: string;
  block_count: number;
  terminal_structure: StopStructure;
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
  return { blockCount: blocks.length, terminal };
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function variance(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}

/** Load escalating real assistant texts from production DB for history momentum (copied from history-depth-sweep). */
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

function loadDone(jsonlPath: string): Set<number> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<number>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample & { error?: string };
    if (typeof j.output_chars === "number") done.add(j.run);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  if (!fs.existsSync(jsonlPath)) return [];
  return fs
    .readFileSync(jsonlPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sample)
    .filter((s) => typeof s.output_chars === "number");
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const templates = loadHistoryTemplates();
  const ctx = await buildContextForDepth(DEPTH, templates);

  const system = [ctx.split.systemRulesBlock, ctx.split.characterSettingsBlock, ctx.split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");

  console.log(
    `Fixture depth=${DEPTH} historyTokens=${ctx.historyTokens} systemTokens=${ctx.systemTokens} historyMsgs=${ctx.history.length}`
  );

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "replay-history-depth6-deepseek.jsonl");
  const reportPath = path.join(outDir, "replay-history-depth6-deepseek-report.txt");

  const done = loadDone(jsonlPath);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  const samples: Sample[] = [...loadSamples(jsonlPath)];

  for (let run = 1; run <= RUNS; run++) {
    if (done.has(run)) {
      console.log(`run ${run}/${RUNS} skip (done)`);
      continue;
    }
    if (apiCalls >= MAX_CALLS) {
      console.error(`MAX_CALLS ${MAX_CALLS} reached, stopping`);
      break;
    }
    process.stdout.write(`run ${run}/${RUNS}\n`);
    apiCalls++;
    try {
      await sleep(4000);
      const result = await callOpenRouterAdult(
        system,
        [...ctx.history, { role: "user", content: ctx.userMessage }],
        MODEL_ID,
        TARGET_CHARS,
        { charName: ctx.charName, systemSplit: ctx.split },
        { chargeTurnBudget: false, requestKind: "history-depth6-replay" }
      );
      const prose = displayProse(result.text);
      const finishReason = String(result.usage?.finishReason ?? "unknown");
      const stop = analyzeStop(prose);
      const sample: Sample = {
        run,
        output_chars: prose.length,
        finish_reason: finishReason,
        block_count: stop.blockCount,
        terminal_structure: stop.terminal,
      };
      fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
      samples.push(sample);
      console.log(
        `  ok ${sample.output_chars}ch finish=${sample.finish_reason} blocks=${sample.block_count} terminal=${sample.terminal_structure}`
      );
    } catch (e) {
      console.error(`  error run ${run}: ${(e as Error).message.slice(0, 120)}`);
      fs.appendFileSync(jsonlPath, JSON.stringify({ run, error: "failed" }) + "\n", "utf8");
    }
  }

  const outputs = samples.map((s) => s.output_chars);
  const varChars = variance(outputs);
  const meanChars = mean(outputs);
  const hits5523 = samples.filter((s) => s.output_chars === 5523).length;

  const lines: string[] = [
    "HISTORY DEPTH 6 REPLAY — DeepSeek V4 Pro (history-depth-sweep fixture)",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · depth=${DEPTH} · RUNS=${RUNS} · apiCalls=${apiCalls}`,
    `context: historyTokens=${ctx.historyTokens} systemTokens=${ctx.systemTokens} historyMsgs=${ctx.history.length} targetChars=${TARGET_CHARS}`,
    "",
    "## Per-run",
  ];

  for (const s of samples) {
    lines.push(
      `  run=${s.run} chars=${s.output_chars} finish=${s.finish_reason} blocks=${s.block_count} terminal=${s.terminal_structure}`
    );
  }

  lines.push(
    "",
    "## Summary",
    `  mean output_chars=${meanChars.toFixed(1)}`,
    `  var output_chars=${varChars.toFixed(1)}`,
    `  5523-char exact matches: ${hits5523}/${samples.length}`,
    `  finish_reason counts: ${Object.entries(
      samples.reduce((m, s) => {
        m[s.finish_reason] = (m[s.finish_reason] ?? 0) + 1;
        return m;
      }, {} as Record<string, number>)
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`
  );

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

