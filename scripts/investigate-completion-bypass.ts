/**
 * Completion heuristic BYPASS — which narrative structure keeps the scene "not done"?
 *
 * Base: dialogue → reaction, then ONE structure added independently.
 *
 * Usage:
 *   npx.cmd tsx scripts/investigate-completion-bypass.ts
 *   npx.cmd tsx scripts/investigate-completion-bypass.ts --repeats 3
 *   npx.cmd tsx scripts/investigate-completion-bypass.ts --skip-api
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";

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

const FLOOR = 2200;
const TARGET = 3300;
const skipApi = process.argv.includes("--skip-api");
const repeats = Math.max(1, Number(process.argv.find((a) => a.startsWith("--repeats="))?.split("=")[1] ?? 3));

function displayProse(content: string): string {
  let s = content ?? "";
  const i = s.search(/<<<STATUS_VALUES/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/\{"honorifics"/);
  if (j >= 0) s = s.slice(0, j);
  return s.trim();
}

function pct(n: number, total: number) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "0%";
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DIALOGUE_REACTION_BASE = `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.`;

/** One independent structure snippet appended after dialogue+reaction */
const STRUCTURE_SNIPPETS: Record<string, string> = {
  baseline: "",
  atmosphere:
    "엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다.",
  environment_interaction:
    "백하율은 손끝으로 엘리베이터 층수 버튼판을 스쳤고, 눌린 버튼 위의 불빛이 두 사람의 얼굴을 짧게 비췄다.",
  sensory_continuation:
    "백하율은 렌의 손목 위에서 올라오는 미세한 떨림과 뜨거운 피부 온도를 피부 끝에서 하나하나 읽어 내렸다.",
  internal_monologue:
    "'떨어지라고? 지금 이 순간을 버리라는 말을 진심으로 꺼낸 건가.' 백하율은 겉으로는 웃음을 유지한 채 속으로만 칼날 같은 생각을 삼켰다.",
  secondary_reaction:
    "렌의 눈꼬리가 또 한 번 떨렸다. 이번에는 당황이 아니라 두려움이 스쳤고, 그것이 백하율의 입꼬리를 더 깊게 올리게 만들었다.",
  new_tension:
    "백하율은 렌의 손목을 더 세게 쥐며, 아직 끝나지 않은 질문을 입술 끝에 걸었다.",
  scene_state_mutation:
    "엘리베이터가 갑자기 한 번 흔들리며 멈춰 섰고, 위에서 작은 전동음이 끊긴 뒤 좁은 상자 안이 정적으로 가라앉았다.",
  parallel_character_action:
    "동시에 렌은 자유롭게 두려 손을 움직이려 했지만, 손목이 움켜잡힌 채로는 팔뚝에만 힘만 실렸다.",
};

const STRUCTURE_ORDER = [
  "baseline",
  "atmosphere",
  "environment_interaction",
  "sensory_continuation",
  "internal_monologue",
  "secondary_reaction",
  "new_tension",
  "scene_state_mutation",
  "parallel_character_action",
] as const;

const MODELS: Array<{ label: string; id: string }> = [
  { label: "deepseek", id: "deepseek/deepseek-v4-pro" },
  { label: "anthropic", id: "anthropic/claude-opus-4.5" },
  { label: "qwen", id: "qwen/qwen3.7-max" },
  { label: "gemini", id: "google/gemini-2.5-pro" },
];

function buildPrefix(structure: string): string {
  const snippet = STRUCTURE_SNIPPETS[structure];
  if (!snippet) return DIALOGUE_REACTION_BASE;
  return `${DIALOGUE_REACTION_BASE} ${snippet}`;
}

async function openRouterContinue(opts: {
  model: string;
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  user: string;
  assistantPrefix: string;
  maxTokens: number;
}): Promise<{ text: string; finishReason: string; completionTokens: number }> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY missing");

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: opts.system },
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.user },
    { role: "assistant", content: opts.assistantPrefix },
  ];

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "completion-bypass-investigation",
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: 0.85,
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { completion_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `OpenRouter ${res.status}`);
  const completion = data.choices?.[0]?.message?.content ?? "";
  return {
    text: opts.assistantPrefix + completion,
    finishReason: data.choices?.[0]?.finish_reason ?? "unknown",
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

type RunRow = {
  model: string;
  structure: string;
  repeat: number;
  prefixLen: number;
  added: number;
  total: number;
  finishReason: string;
  completionTokens: number;
  floorPass: boolean;
  gateOpen: boolean;
};

async function main() {
  const db = new Database(path.resolve("data/app.db"), { readonly: true });
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);
  const rows: RunRow[] = [];

  push("=".repeat(80));
  push("COMPLETION HEURISTIC BYPASS — staged structure replay");
  push(`generated: ${new Date().toISOString()}`);
  push(`FLOOR=${FLOOR} · repeats=${repeats} · base=dialogue→reaction`);
  push("=".repeat(80));

  const { buildContext } = await import("../src/services/contextBuilder");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");
  const { rawRecentTurnsToHistory, messagesToTurns } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");

  const chatId = 30;
  const chatRow = db
    .prepare(
      `SELECT c.*, ch.name, ch.gender, ch.system_prompt, ch.world, ch.example_dialog,
              ch.setting_chunks, ch.setting_chunks_en, ch.prompt_translation_hash,
              ch.speech_profile, ch.nsfw, ch.status_widget_json,
              ch.status_widget_allow_user_override
       FROM chats c JOIN characters ch ON ch.id = c.character_id WHERE c.id = ?`
    )
    .get(chatId) as Record<string, unknown>;

  const mem = db
    .prepare("SELECT summarized_turn_count, recent_summary FROM chat_memories WHERE chat_id=?")
    .get(chatId) as { summarized_turn_count: number; recent_summary: string } | undefined;

  const allRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id")
    .all(chatId);
  const turns = messagesToTurns(
    allRows.map((r: { role: string; content: string; model: string }) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      model: r.model,
    }))
  );
  const summarized = mem?.summarized_turn_count ?? 0;
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    summarized,
    resolveRawRecentTurnWindowForHistory(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      "openrouter",
      turns.length
    )
  );
  const lastUser =
    allRows.filter((r: { role: string }) => r.role === "user").at(-1)?.content ?? "";

  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: Number(chatRow.character_id),
      name: String(chatRow.name ?? ""),
      gender: chatRow.gender as string | null,
      system_prompt: String(chatRow.system_prompt ?? ""),
      world: String(chatRow.world ?? ""),
      example_dialog: String(chatRow.example_dialog ?? ""),
      setting_chunks: String(chatRow.setting_chunks ?? "[]"),
      setting_chunks_en: String(chatRow.setting_chunks_en ?? ""),
      prompt_translation_hash: String(chatRow.prompt_translation_hash ?? ""),
      speech_profile: String(chatRow.speech_profile ?? ""),
    },
    "user",
    "user"
  );

  const built = buildContext({
    charName: String(chatRow.name ?? "char"),
    chunks,
    userNickname: "user",
    shortTermHistory: historyRaw,
    currentUserMessage: lastUser,
    nsfw: Boolean(chatRow.nsfw),
    gender: (chatRow.gender as "male" | "female" | "other") ?? "other",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    targetResponseChars: Number(chatRow.target_response_chars ?? 3300),
    completedTurns: turns.length,
    longTermMemory: mem?.recent_summary ?? "",
    statusWidgetActive: false,
    mainModelOwnsRelationshipExtract: false,
  });

  const system = built.systemPrompt;
  const builtHistory = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const maxTokens = 8192;
  const outDir = path.join("output", "completion-bypass");
  fs.mkdirSync(outDir, { recursive: true });

  push("", "## Structures tested (independent append after dialogue→reaction)");
  for (const s of STRUCTURE_ORDER) {
    if (s === "baseline") {
      push(`  baseline: dialogue→reaction only (${displayProse(DIALOGUE_REACTION_BASE).length}ch)`);
    } else {
      push(`  + ${s}: ${STRUCTURE_SNIPPETS[s]}`);
    }
  }

  if (skipApi || !process.env.OPENROUTER_API_KEY?.trim()) {
    push("\n[--skip-api or no key] API runs skipped");
  } else {
    push("\n## Running staged replays…");
    for (const { label, id: modelId } of MODELS) {
      push(`\n--- ${label} (${modelId}) ---`);
      for (let rep = 1; rep <= repeats; rep++) {
        for (const structure of STRUCTURE_ORDER) {
          const prefix = buildPrefix(structure);
          try {
            const r = await openRouterContinue({
              model: modelId,
              system,
              history: builtHistory,
              user: lastUser,
              assistantPrefix: prefix,
              maxTokens,
            });
            const prefixLen = displayProse(prefix).length;
            const total = displayProse(r.text).length;
            const added = total - prefixLen;
            const floorPass = total >= FLOOR;
            const gateOpen = r.finishReason !== "stop" || total >= FLOOR || added >= 500;
            rows.push({
              model: label,
              structure,
              repeat: rep,
              prefixLen,
              added,
              total,
              finishReason: r.finishReason,
              completionTokens: r.completionTokens,
              floorPass,
              gateOpen,
            });
            fs.writeFileSync(
              path.join(outDir, `${label}-${structure}-r${rep}.txt`),
              r.text,
              "utf8"
            );
          } catch (e) {
            push(`  [${structure} r${rep}] ERROR: ${(e as Error).message}`);
          }
        }
      }
    }
  }

  // ── Aggregate metrics ──
  push("", "## Metrics by model × structure");

  type Agg = {
    added: number[];
    floorPasses: number;
    gateOpens: number;
    finishes: Record<string, number>;
  };
  const agg: Record<string, Record<string, Agg>> = {};

  for (const row of rows) {
    if (!agg[row.model]) agg[row.model] = {};
    if (!agg[row.model][row.structure]) {
      agg[row.model][row.structure] = { added: [], floorPasses: 0, gateOpens: 0, finishes: {} };
    }
    const a = agg[row.model][row.structure];
    a.added.push(row.added);
    if (row.floorPass) a.floorPasses++;
    if (row.gateOpen) a.gateOpens++;
    a.finishes[row.finishReason] = (a.finishes[row.finishReason] ?? 0) + 1;
  }

  for (const { label } of MODELS) {
    push(`\n  [${label}]`);
    const baselineMedian = median(agg[label]?.baseline?.added ?? []);
    for (const structure of STRUCTURE_ORDER) {
      const a = agg[label]?.[structure];
      if (!a) continue;
      const med = median(a.added);
      const gain = med - baselineMedian;
      push(
        `    ${structure}: median_added=${med} · gain_vs_baseline=${gain} · FLOOR_pass=${a.floorPasses}/${a.added.length} (${pct(a.floorPasses, a.added.length)}) · gate_open=${pct(a.gateOpens, a.added.length)} · finish=${Object.entries(a.finishes).map(([k, v]) => `${k}:${v}`).join(",")}`
      );
    }
  }

  // ── Cross-model vs DeepSeek-only classification ──
  push("", "## Bypass effectiveness classification");
  push("  bypass_effective: median gain≥300 vs baseline AND (FLOOR pass OR median added≥800)");
  push("  gate_effective: gate_open rate ≥80% AND median gain≥200 vs baseline");

  const structures = STRUCTURE_ORDER.filter((s) => s !== "baseline");
  const bypassEffective: Record<string, string[]> = {};
  const gateEffective: Record<string, string[]> = {};

  for (const structure of structures) {
    bypassEffective[structure] = [];
    gateEffective[structure] = [];
    for (const { label } of MODELS) {
      const baseMed = median(agg[label]?.baseline?.added ?? []);
      const a = agg[label]?.[structure];
      if (!a || !a.added.length) continue;
      const med = median(a.added);
      const gain = med - baseMed;
      const floorRate = a.floorPasses / a.added.length;
      const gateRate = a.gateOpens / a.added.length;
      if (gain >= 300 && (floorRate > 0 || med >= 800)) bypassEffective[structure].push(label);
      if (gateRate >= 0.8 && gain >= 200) gateEffective[structure].push(label);
    }
  }

  const crossModelBypass = structures.filter(
    (s) => bypassEffective[s].length === MODELS.length
  );
  const crossModelGate = structures.filter((s) => gateEffective[s].length === MODELS.length);
  const deepseekOnlyBypass = structures.filter(
    (s) =>
      bypassEffective[s].includes("deepseek") &&
      bypassEffective[s].length === 1
  );
  const deepseekOnlyGate = structures.filter(
    (s) =>
      gateEffective[s].includes("deepseek") &&
      gateEffective[s].length === 1 &&
      !crossModelGate.includes(s)
  );

  push("\n  Cross-model bypass_effective (all 4):");
  for (const s of crossModelBypass) push(`    ${s}`);
  if (!crossModelBypass.length) push("    (none)");

  push("\n  Cross-model gate_effective (all 4):");
  for (const s of crossModelGate) push(`    ${s}`);
  if (!crossModelGate.length) push("    (none)");

  push("\n  DeepSeek-only bypass_effective:");
  for (const s of deepseekOnlyBypass) push(`    ${s}`);
  if (!deepseekOnlyBypass.length) push("    (none)");

  push("\n  DeepSeek-only gate_effective (not cross-model):");
  for (const s of deepseekOnlyGate) push(`    ${s}`);
  if (!deepseekOnlyGate.length) push("    (none)");

  push("\n  Per-structure model coverage (bypass_effective):");
  for (const s of structures) {
    push(`    ${s}: ${bypassEffective[s].join(", ") || "—"}`);
  }

  // Summary matrix: median gain vs baseline
  push("", "## Gain matrix (median added − baseline median)");
  push("  structure | deepseek | anthropic | qwen | gemini");
  for (const structure of structures) {
    const cells = MODELS.map(({ label }) => {
      const baseMed = median(agg[label]?.baseline?.added ?? []);
      const med = median(agg[label]?.[structure]?.added ?? []);
      if (!agg[label]?.[structure]?.added.length) return "?";
      return String(med - baseMed);
    });
    push(`  ${structure} | ${cells.join(" | ")}`);
  }

  push("", "## Verdict");
  const deepseekBase = median(agg.deepseek?.baseline?.added ?? []);
  const deepseekAtmoGain =
    median(agg.deepseek?.atmosphere?.added ?? []) - deepseekBase;
  const othersAtmoGain = MODELS.filter((m) => m.label !== "deepseek").map(
    (m) => median(agg[m.label]?.atmosphere?.added ?? []) - median(agg[m.label]?.baseline?.added ?? [])
  );
  const atmoOnlyDeepseek =
    deepseekAtmoGain >= 300 &&
    othersAtmoGain.every((g) => g < 300) &&
    !crossModelBypass.includes("atmosphere");

  if (atmoOnlyDeepseek) {
    push(
      "  SCENE COMPLETION CONTROL confirmed: atmosphere bypass is DeepSeek-specific; not a generic LENGTH CONTROL issue."
    );
  } else if (crossModelBypass.includes("atmosphere")) {
    push(
      "  atmosphere bypass effective across all models — completion heuristic is structure-addressable globally."
    );
  } else {
    push(
      "  Mixed bypass profile — see per-structure coverage; no single structure dominates all models."
    );
  }

  const reportPath = path.join("output", "investigate-completion-bypass.txt");
  const jsonPath = path.join("output", "investigate-completion-bypass.json");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ rows, agg: Object.fromEntries(
    Object.entries(agg).map(([model, structs]) => [
      model,
      Object.fromEntries(
        Object.entries(structs).map(([s, a]) => [
          s,
          {
            medianAdded: median(a.added),
            floorPassRate: a.floorPasses / (a.added.length || 1),
            gateOpenRate: a.gateOpens / (a.added.length || 1),
            finishes: a.finishes,
          },
        ])
      ),
    ])
  ) }, null, 2), "utf8");

  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(lines.join("\n"));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
