/**
 * Gemini 3.1 Pro — max_tokens vs reasoning.effort A/B on full RP fixture.
 * Usage: npx.cmd tsx scripts/probe-gemini31-maxtok-effort-ab.ts [--reps=3]
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";

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

const MODEL = OPENROUTER_GEMINI_31_PRO_MODEL;
const TARGET_CHARS = 3300;
const FLOOR = 2200;
const DELAY_MS = 5000;
const USER_MESSAGE =
  "정말 고장났나봐.... 나랑 떨어져야되는거아니야?? 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다.";

const REPS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--reps="));
  return Math.max(2, Math.min(5, Number(arg?.split("=")[1]) || 3));
})();

const CELLS = [
  { id: "low_10000", effort: "low" as const, max_tokens: 10000 },
  { id: "medium_10000", effort: "medium" as const, max_tokens: 10000 },
];

type Row = {
  cell: string;
  rep: number;
  effort: string;
  max_tokens: number;
  finish_reason: string;
  completion_tokens: number;
  reasoning_tokens: number;
  content_tokens_est: number;
  output_chars: number;
  floor_pass: boolean;
  target_pass: boolean;
  truncated_mid: boolean;
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

function loadHistoryTemplates() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT content FROM messages WHERE role='assistant' AND LENGTH(content)>2500 ORDER BY id DESC LIMIT 12`
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
    if (prose.length < 800) continue;
    templates.push({
      user: userAlts[templates.length % userAlts.length],
      assistant: prose.slice(0, Math.min(prose.length, 4500)),
    });
  }
  return templates;
}

async function buildFixture() {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const templates = loadHistoryTemplates();
  const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < 3; i++) {
    const t = templates[i % templates.length];
    historyMessages.push({ role: "user", content: t.user });
    historyMessages.push({ role: "assistant", content: t.assistant });
  }

  const turns = messagesToTurns(
    [...historyMessages, { role: "user", content: USER_MESSAGE }].map((m) => ({
      ...m,
      model: "assistant",
    }))
  );
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL, "openrouter", turns.length)
  );

  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "vg-1",
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
    currentUserMessage: USER_MESSAGE,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 6,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const split = built.openRouterSystemSplit!;
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return {
    split,
    history,
    system: [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n"),
  };
}

async function callVariant(
  ctx: Awaited<ReturnType<typeof buildFixture>>,
  cell: (typeof CELLS)[number]
): Promise<Omit<Row, "cell" | "rep">> {
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const messages = buildOpenRouterMessages(
    ctx.system,
    [...ctx.history, { role: "user", content: USER_MESSAGE }],
    { systemSplit: ctx.split, charName: "백하율" }
  );

  const body = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.95,
    max_tokens: cell.max_tokens,
    reasoning: { effort: cell.effort },
    include_reasoning: false,
    stream_options: { include_usage: true },
  };

  const key = process.env.OPENROUTER_API_KEY?.trim();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  const usage = data.usage ?? {};
  const details = usage.completion_tokens_details ?? {};
  const reasoning = Number(details.reasoning_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? 0);
  const content = String(data.choices?.[0]?.message?.content ?? "");
  const prose = displayProse(content);
  const finish = String(data.choices?.[0]?.finish_reason ?? "unknown");

  return {
    effort: cell.effort,
    max_tokens: cell.max_tokens,
    finish_reason: finish,
    completion_tokens: completion,
    reasoning_tokens: reasoning,
    content_tokens_est: Math.max(0, completion - reasoning),
    output_chars: prose.length,
    floor_pass: prose.length >= FLOOR,
    target_pass: prose.length >= TARGET_CHARS,
    truncated_mid: finish === "length",
  };
}

function summarize(rows: Row[]) {
  const byCell = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byCell.has(r.cell)) byCell.set(r.cell, []);
    byCell.get(r.cell)!.push(r);
  }
  const lines: string[] = [];
  for (const cell of CELLS) {
    const sub = byCell.get(cell.id) ?? [];
    const n = sub.length || 1;
    const meanChars = sub.reduce((a, r) => a + r.output_chars, 0) / n;
    const meanReason = sub.reduce((a, r) => a + r.reasoning_tokens, 0) / n;
    const meanContent = sub.reduce((a, r) => a + r.content_tokens_est, 0) / n;
    const lengthN = sub.filter((r) => r.finish_reason === "length").length;
    const floorN = sub.filter((r) => r.floor_pass).length;
    const targetN = sub.filter((r) => r.target_pass).length;
    lines.push(
      `${cell.id}: reps=${sub.length} mean_chars=${meanChars.toFixed(0)} mean_reason=${meanReason.toFixed(0)} mean_content_tok=${meanContent.toFixed(0)} finish_length=${lengthN}/${sub.length} floor=${floorN}/${sub.length} target3300=${targetN}/${sub.length} chars=[${sub.map((r) => r.output_chars).join(",")}]`
    );
  }
  return lines.join("\n");
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const ctx = await buildFixture();
  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "probe-gemini31-maxtok-effort-ab.jsonl");
  fs.writeFileSync(jsonlPath, "", "utf8");

  const rows: Row[] = [];
  console.log(`cells=${CELLS.length} reps=${REPS} target=${TARGET_CHARS} floor=${FLOOR}`);

  for (const cell of CELLS) {
    console.log(`\n=== ${cell.id} ===`);
    for (let rep = 1; rep <= REPS; rep++) {
      await sleep(DELAY_MS);
      process.stdout.write(`  rep ${rep}/${REPS}...`);
      const r = await callVariant(ctx, cell);
      const row: Row = { cell: cell.id, rep, ...r };
      rows.push(row);
      fs.appendFileSync(jsonlPath, JSON.stringify(row) + "\n", "utf8");
      console.log(
        ` chars=${row.output_chars} finish=${row.finish_reason} comp=${row.completion_tokens} reason=${row.reasoning_tokens} content~=${row.content_tokens_est}`
      );
    }
  }

  const report = summarize(rows);
  const reportPath = path.join(outDir, "probe-gemini31-maxtok-effort-ab-report.txt");
  fs.writeFileSync(
    reportPath,
    [`generated: ${new Date().toISOString()}`, `reps/cell: ${REPS}`, "", report, ""].join("\n"),
    "utf8"
  );
  console.log("\n" + report);
  console.log(`Wrote ${jsonlPath}\nWrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
