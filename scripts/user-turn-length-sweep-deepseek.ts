/**
 * User Turn Length Sweep — DeepSeek, Phase2 prompt, fixed history depth 6.
 * User input token targets: 200, 500, 1000, 2000, 4000, 6000 × 5 runs = 30 calls.
 * Usage: npx.cmd tsx scripts/user-turn-length-sweep-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { estimateTokens } from "../src/lib/tokenEstimate";

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
const USER_TARGETS = [200, 500, 1000, 2000, 4000, 6000] as const;
const RUNS = 5;
const MAX_CALLS = 30;
const FLOOR = 2200;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;
const TARGET_CHARS = 3300;
const FIXED_DEPTH = 6;
const BASE_USER = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";

type UserTarget = typeof USER_TARGETS[number];

type Sample = {
  user_target_tokens: UserTarget;
  run: number;
  user_tokens_actual: number;
  user_chars: number;
  history_tokens: number;
  output_chars: number;
  floor_pass: boolean;
  finish_reason: string;
  completion_tokens: number;
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

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function pct(n: number, t: number) {
  return t ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

/** Pad user message to approximate target tokens using in-character impersonation prose */
function buildUserMessage(targetTokens: UserTarget): string {
  const filler =
    " 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다. 좁은 공간의 정적이 귀를 찌르고, 형광등이 불규칙하게 깜빡였다. 손목에 닿은 온기가 믿을 수 없게 선명했다. ";
  let msg = BASE_USER;
  while (estimateTokens(msg) < targetTokens) {
    msg += filler;
    if (msg.length > targetTokens * 12) break;
  }
  // trim down if overshot significantly
  while (estimateTokens(msg) > targetTokens + 80 && msg.length > BASE_USER.length + 20) {
    msg = msg.slice(0, -Math.min(200, msg.length - BASE_USER.length));
  }
  return msg.trim();
}

function loadHistoryTemplates(): { user: string; assistant: string }[] {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT content FROM messages WHERE role='assistant' AND model LIKE '%deepseek%' AND LENGTH(content)>800 ORDER BY id ASC`
    )
    .all() as { content: string }[];
  db.close();
  const templates: { user: string; assistant: string }[] = [];
  const userAlts = [
    "자동진행",
    "…여기 오래 갇혀 있었어?",
    "가이드님… 무서워.",
    "손 잡아줄래?",
    "이대로 계속 있어도 괜찮아?",
    "떨어지면 어떡해…",
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
  return templates;
}

function buildHistoryMessages(templates: { user: string; assistant: string }[]) {
  const pairs = FIXED_DEPTH / 2;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < pairs; i++) {
    const t = templates[i % templates.length];
    messages.push({ role: "user", content: t.user });
    messages.push({ role: "assistant", content: t.assistant });
  }
  return messages;
}

async function buildFixture(userMessage: string) {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const templates = loadHistoryTemplates();
  const historyMessages = buildHistoryMessages(templates);
  const turns = messagesToTurns(
    [...historyMessages, { role: "user", content: userMessage, model: "assistant" }].map((m) => ({
      ...m,
      model: "assistant",
    }))
  );
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", turns.length)
  );

  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "ut-1",
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
    currentUserMessage: userMessage,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: FIXED_DEPTH,
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
    userMessage,
    split,
    historyTokens: audit?.historyTokens ?? 0,
    userTokensAudit: audit?.currentUserTurnTokens ?? estimateTokens(userMessage),
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample;
    if (typeof j.output_chars === "number") done.add(`${j.user_target_tokens}|${j.run}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.output_chars !== "number") continue;
    byKey.set(`${s.user_target_tokens}|${s.run}`, s);
  }
  return [...byKey.values()];
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "user-turn-length-sweep.jsonl");
  const reportPath = path.join(outDir, "user-turn-length-sweep-report.txt");
  const done = loadDone(jsonlPath);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  for (const target of USER_TARGETS) {
    const userMessage = buildUserMessage(target);
    const actualTok = estimateTokens(userMessage);
    console.log(`\n=== user_target=${target} actual_user_tokens≈${actualTok} chars=${userMessage.length} ===`);
    const ctx = await buildFixture(userMessage);
    const system = [ctx.split.systemRulesBlock, ctx.split.characterSettingsBlock, ctx.split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n");
    console.log(`  history_tokens=${ctx.historyTokens} audit_user_tokens=${ctx.userTokensAudit}`);

    for (let run = 1; run <= RUNS; run++) {
      const key = `${target}|${run}`;
      if (done.has(key)) {
        console.log(`target ${target} run ${run}/${RUNS} skip (done)`);
        continue;
      }
      if (apiCalls >= MAX_CALLS) {
        console.error(`MAX_CALLS ${MAX_CALLS} reached`);
        process.exit(3);
      }
      process.stdout.write(`target ${target} run ${run}/${RUNS}\n`);
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
            { chargeTurnBudget: false, requestKind: "user-turn-length-sweep" }
          );
          const prose = displayProse(result.text);
          const sample: Sample = {
            user_target_tokens: target,
            run,
            user_tokens_actual: ctx.userTokensAudit,
            user_chars: userMessage.length,
            history_tokens: ctx.historyTokens,
            output_chars: prose.length,
            floor_pass: prose.length >= FLOOR,
            finish_reason: String(result.usage?.finishReason ?? "unknown"),
            completion_tokens: Number(result.usage?.completionTokens ?? 0),
          };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(
            `  ok out=${sample.output_chars} floor=${sample.floor_pass} finish=${sample.finish_reason} compTok=${sample.completion_tokens}`
          );
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 100)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(jsonlPath, JSON.stringify({ user_target_tokens: target, run, error: "failed" }) + "\n", "utf8");
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const lines: string[] = [
    "USER TURN LENGTH SWEEP — DeepSeek V4 Pro",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · fixed history depth=${FIXED_DEPTH} · runs=${RUNS} · apiCalls=${apiCalls}`,
    "prompt: Phase2 baseline unchanged",
    "",
  ];

  const xs = samples.map((s) => s.user_tokens_actual);
  const ys = samples.map((s) => s.output_chars);
  let r: number | null = null;
  if (xs.length >= 3) {
    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    if (vx && vy) r = cov / Math.sqrt(vx * vy);
  }
  lines.push(`Pearson r(user_tokens, output_chars): ${r === null ? "n/a" : r.toFixed(3)} (n=${samples.length})`);
  lines.push("");

  for (const target of USER_TARGETS) {
    const sub = samples.filter((s) => s.user_target_tokens === target);
    if (!sub.length) continue;
    lines.push(`### user_target=${target} (n=${sub.length})`);
    lines.push(
      `  mean_user_tokens=${mean(sub.map((s) => s.user_tokens_actual)).toFixed(0)} mean_out=${mean(sub.map((s) => s.output_chars)).toFixed(0)}ch FLOOR=${pct(sub.filter((s) => s.floor_pass).length, sub.length)}`
    );
    const finishes: Record<string, number> = {};
    for (const s of sub) finishes[s.finish_reason] = (finishes[s.finish_reason] ?? 0) + 1;
    lines.push(`  finish: ${Object.entries(finishes).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    lines.push("");
  }

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
