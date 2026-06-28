/**
 * Completion heuristic investigation — where models decide the turn is "done".
 *
 * Usage:
 *   npx.cmd tsx scripts/investigate-completion-heuristic.ts
 *   npx.cmd tsx scripts/investigate-completion-heuristic.ts --skip-api
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

/** User-facing stop-structure taxonomy (length-independent) */
type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type SemanticEnd =
  | "emotional_resolution"
  | "dialogue_resolution"
  | "question_answered"
  | "action_completed"
  | "character_waiting"
  | "scene_stabilized"
  | "unresolved_tension"
  | "other";

/** Classify a single paragraph/block — order matters (tension > scene > atmosphere > wait > dialogue > reaction) */
function classifyBlockStructure(block: string): StopStructure {
  const t = block.trim();
  if (!t) return "other";

  const endsUnresolved =
    /[,…]\s*$/.test(t) ||
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|말해지지|끝맺지)/.test(
      t.slice(-100)
    );
  if (endsUnresolved) return "tension_continuation";

  if (
    /(?:문이|문을|열리|닫히|나갔|들어|이동|걸어|달려|뛰|회전|돌아|장면이|다른 층|복도|밖으로|안으로|층|방으로|카페|거실|현관|출구|입구)/.test(
      t
    )
  )
    return "scene_state_transition";

  if (
    /(?:공기가|분위기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|철 상자|엘리베이터 안)/.test(
      t
    ) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";

  if (
    /(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|확인하며|시선을 고정|반응을 기다|대답을 기다)/.test(
      t
    )
  )
    return "observer_wait_ending";

  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t) || /^"[^"]{4,}"$/.test(t))
    return "dialogue_resolution";

  if (
    /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|연두색|황금|동공|손목|손가락|입술|숨)/.test(
      t
    )
  )
    return "immediate_reaction";

  return "other";
}

/** Ordered structural blocks (paragraphs) + terminal stop structure */
function analyzeStopStructure(prose: string): {
  blocks: StopStructure[];
  terminal: StopStructure;
  stopAfter: StopStructure;
  chain: string;
} {
  const paragraphs = prose
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const blocks = paragraphs.map(classifyBlockStructure);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const stopAfter = blocks.length >= 2 ? blocks[blocks.length - 2] : terminal;
  const chain = blocks.join("→");
  return { blocks, terminal, stopAfter, chain };
}

function classifySemanticEnd(tail: string, fullLen: number): SemanticEnd[] {
  const hits: SemanticEnd[] = [];
  const t = tail.trim();

  if (
    /(?:미소|안도|긴장이 풀|편안|따뜻|설렘|감정이 가라앉|마음이 놓|안심|위안|달아오른|만족)/.test(t)
  )
    hits.push("emotional_resolution");
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t) || /"[^"]{4,}"[^"]*$/.test(t.slice(-120)))
    hits.push("dialogue_resolution");
  if (/(?:그래|맞아|알겠|그렇구나|그런가|답이|대답|물었다|되물었다).*[.!?…]?\s*$/i.test(t))
    hits.push("question_answered");
  if (
    /(?:했다|했다\.|말았다|끝냈다|돌아섰|나아갔|들어갔|나왔|잡았|놓았|밀었|당겼|안았|키스|문을|엘리베이터|떠났|멈춰 섰)[.!?…]?\s*$/.test(
      t
    )
  )
    hits.push("action_completed");
  if (
    /(?:기다리|지켜보|바라보|응시|말없이|고요|정적|가만히|조용히|기다렸|확인하며|시선을 고정|멈춰)/.test(
      t
    )
  )
    hits.push("character_waiting");
  if (
    /(?:공기가|분위기|장면|주변|조명|향기|온도|고요|정적|밀폐|어둠|달빛|실내)/.test(t) &&
    !/(?:하지만|그런데|아직|더 )/.test(t.slice(-80))
  )
    hits.push("scene_stabilized");
  if (
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|순간|직전|막\s|채\s|멈추지|끝나지)/.test(
      t.slice(-150)
    ) ||
    /[,…]\s*$/.test(t) ||
    fullLen < FLOOR &&
      /(?:손가락|시선|입술|숨|심장|파동).{0,40}$/.test(t) &&
      !/[.!?…"']\s*$/.test(t)
  )
    hits.push("unresolved_tension");

  if (hits.length === 0) hits.push("other");
  return hits;
}

/** Staged partial completions — same scene, increasing completeness */
const STAGE_PREFIXES: Record<string, string> = {
  dialogue_only: `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"`,

  dialogue_reaction: `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다.`,

  dialogue_reaction_atmosphere: `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다. 엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다.`,

  dialogue_reaction_atmosphere_tension: `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다. 엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다. 백하율의 손가락이 렌의 손목을 스치며 더 깊이 파고들려 했고, 아직 말해지지 않은 질문이 그의 목젖 위에 걸려`,

  dialogue_reaction_atmosphere_tension_scene_shift: `백하율은 렌의 말을 듣고 입꼬리를 올렸다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다. 엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다. 백하율의 손가락이 렌의 손목을 스치며 더 깊이 파고들려 했고, 아직 말해지지 않은 질문이 그의 목젖 위에 걸려. 엘리베이터 문이 열리며 새 층의 차가운 바람이 그들의 어깨를 스쳤다. 백하율은 렌을 밀어 넣은 채 복도 쪽으로 한 걸음 나아갔다.`,
};

const STAGED_MODELS: Array<{ label: string; id: string }> = [
  { label: "deepseek", id: "deepseek/deepseek-v4-pro" },
  { label: "anthropic", id: "anthropic/claude-opus-4.5" },
  { label: "qwen", id: "qwen/qwen3.7-max" },
  { label: "gemini", id: "google/gemini-2.5-pro" },
];

const STAGE_ORDER = [
  "dialogue_only",
  "dialogue_reaction",
  "dialogue_reaction_atmosphere",
  "dialogue_reaction_atmosphere_tension",
  "dialogue_reaction_atmosphere_tension_scene_shift",
] as const;

/** Gate open: continuation adds meaningful prose and crosses FLOOR or large delta */
function continuationGateOpen(total: number, added: number, finishReason: string): boolean {
  if (finishReason !== "stop") return true;
  return total >= FLOOR || added >= 500;
}

async function openRouterContinue(opts: {
  model: string;
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  user: string;
  assistantPrefix: string;
  maxTokens: number;
  systemSplit?: import("../src/lib/openRouterCache").OpenRouterSystemSplit;
  charName?: string;
}): Promise<{ text: string; finishReason: string; completionTokens: number }> {
  if (!opts.assistantPrefix.trim()) {
    const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
    const history = [...opts.history, { role: "user" as const, content: opts.user }];
    const r = await callOpenRouterAdult(
      opts.system,
      history,
      opts.model,
      TARGET,
      { charName: opts.charName, systemSplit: opts.systemSplit },
      { requestKind: "completion-heuristic-ending" }
    );
    return {
      text: r.text,
      finishReason: r.usage.finishReason ?? "stop",
      completionTokens: r.usage.outputTokens ?? 0,
    };
  }

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
      "X-Title": "completion-heuristic-investigation",
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
  if (!res.ok) {
    throw new Error(data.error?.message ?? `OpenRouter ${res.status}`);
  }
  const completion = data.choices?.[0]?.message?.content ?? "";
  const finishReason = data.choices?.[0]?.finish_reason ?? "unknown";
  return {
    text: opts.assistantPrefix + completion,
    finishReason,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

function rewriteEndingResolved(prose: string): string {
  const paras = prose.split(/\n\n+/).filter((p) => p.trim());
  if (paras.length < 2) return prose;
  const body = paras.slice(0, -1).join("\n\n");
  const resolvedTail =
    "백하율은 천천히 숨을 고르며 렌의 손목을 풀었다. 그의 시선은 여전히 렌에게 고정되어 있었지만, 말없이 기다리며 다음 반응을 지켜보았다.";
  return `${body}\n\n${resolvedTail}`;
}

function rewriteEndingUnresolved(prose: string): string {
  const paras = prose.split(/\n\n+/).filter((p) => p.trim());
  if (paras.length < 2) return prose;
  const body = paras.slice(0, -1).join("\n\n");
  const openTail =
    "백하율의 손가락이 렌의 손목에서 멈추지 않고 더 깊이 파고들었고, 아직 끝나지 않은 말이 그의 입술 끝에 걸려";
  return `${body}\n\n${openTail}`;
}

async function main() {
  const db = new Database(path.resolve("data/app.db"), { readonly: true });
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("=".repeat(80));
  push("COMPLETION HEURISTIC INVESTIGATION");
  push(`generated: ${new Date().toISOString()}`);
  push(`FLOOR=${FLOOR} TARGET=${TARGET} (not modified)`);
  push("=".repeat(80));

  // ── A. Below-FLOOR stop-structure quantification (6 elements, not length) ──
  push("", "## A. Stop-structure quantification — below-FLOOR (structure at STOP, not tokens)");

  const allAssistants = db
    .prepare(
      `SELECT m.id, m.content, m.usage, m.model FROM messages m
       WHERE m.role='assistant' AND m.model!='greeting' ORDER BY m.id DESC`
    )
    .all() as Array<{ id: number; content: string; usage: string | null; model: string }>;

  const terminalCounts: Record<StopStructure, number> = {
    dialogue_resolution: 0,
    immediate_reaction: 0,
    observer_wait_ending: 0,
    atmosphere_block: 0,
    tension_continuation: 0,
    scene_state_transition: 0,
    other: 0,
  };
  const stopAfterCounts: Record<StopStructure, number> = { ...terminalCounts };
  const chainCounts: Record<string, number> = {};
  const structurePresence: Record<StopStructure, number> = { ...terminalCounts };

  let belowFloorAll = 0;
  const byModelTerminal: Record<string, Record<StopStructure, number>> = {};

  for (const m of allAssistants) {
    const prose = displayProse(m.content);
    if (prose.length >= FLOOR) continue;
    belowFloorAll++;
    const { blocks, terminal, stopAfter, chain } = analyzeStopStructure(prose);
    terminalCounts[terminal]++;
    stopAfterCounts[stopAfter]++;
    chainCounts[chain] = (chainCounts[chain] ?? 0) + 1;
    for (const b of blocks) structurePresence[b]++;

    const fam = m.model.includes("deepseek")
      ? "deepseek"
      : m.model.includes("anthropic") || m.model.includes("claude")
        ? "anthropic"
        : m.model.includes("qwen")
          ? "qwen"
          : m.model.includes("gemini")
            ? "gemini"
            : "other";
    if (!byModelTerminal[fam]) {
      byModelTerminal[fam] = { ...terminalCounts };
      for (const k of Object.keys(byModelTerminal[fam]) as StopStructure[]) {
        byModelTerminal[fam][k] = 0;
      }
    }
    byModelTerminal[fam][terminal]++;
  }

  push(`  all assistant messages below FLOOR: ${belowFloorAll}/${allAssistants.length}`);
  push("\n  Terminal block at STOP (last paragraph structure):");
  for (const [k, v] of Object.entries(terminalCounts).sort((a, b) => b[1] - a[1])) {
    push(`    ${k}: ${v} (${pct(v, belowFloorAll)})`);
  }
  push("\n  Structure completed immediately BEFORE terminal (penultimate block):");
  for (const [k, v] of Object.entries(stopAfterCounts).sort((a, b) => b[1] - a[1])) {
    push(`    ${k}: ${v} (${pct(v, belowFloorAll)})`);
  }
  push("\n  Structure presence anywhere in response (multi-hit per message):");
  for (const [k, v] of Object.entries(structurePresence).sort((a, b) => b[1] - a[1])) {
    push(`    ${k}: ${v} (${pct(v, belowFloorAll)})`);
  }
  push("\n  Top stop chains (paragraph structure sequence):");
  for (const [k, v] of Object.entries(chainCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    push(`    ${k}: ${v} (${pct(v, belowFloorAll)})`);
  }

  push("\n  Terminal structure by model family:");
  for (const [fam, counts] of Object.entries(byModelTerminal)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}=${pct(v, total)}`)
      .join(", ");
    push(`    ${fam} (n=${total}): ${top}`);
  }

  // Completed-exchange heuristic on structure taxonomy
  let stopAfterDialogueReaction = 0;
  let stopAfterAtmosphere = 0;
  for (const m of allAssistants) {
    const prose = displayProse(m.content);
    if (prose.length >= FLOOR) continue;
    const { terminal, stopAfter } = analyzeStopStructure(prose);
    if (
      terminal === "immediate_reaction" ||
      (terminal === "dialogue_resolution" && stopAfter !== "atmosphere_block")
    )
      stopAfterDialogueReaction++;
    if (terminal === "atmosphere_block" || stopAfter === "atmosphere_block") stopAfterAtmosphere++;
  }
  push(
    `\n  Stop after dialogue/reaction phase (terminal=dialogue|reaction): ${stopAfterDialogueReaction}/${belowFloorAll} (${pct(stopAfterDialogueReaction, belowFloorAll)})`
  );
  push(
    `  Atmosphere involved at/before stop: ${stopAfterAtmosphere}/${belowFloorAll} (${pct(stopAfterAtmosphere, belowFloorAll)})`
  );

  // ── B. Legacy tail semantic (last-300 subset) ──
  push("", "## B. Legacy tail-500 semantic tags (last-300 subset, multi-label)");

  const assistants = allAssistants.slice(0, 300);

  const semanticCounts: Record<SemanticEnd, number> = {
    emotional_resolution: 0,
    dialogue_resolution: 0,
    question_answered: 0,
    action_completed: 0,
    character_waiting: 0,
    scene_stabilized: 0,
    unresolved_tension: 0,
    other: 0,
  };

  let belowFloor = 0;
  let stopFinish = 0;
  const triggerCombo: Record<string, number> = {};

  for (const m of assistants) {
    const prose = displayProse(m.content);
    const len = prose.length;
    let finish = "unknown";
    try {
      const u = JSON.parse(m.usage ?? "{}");
      finish = u.finishReason ?? u.finish_reason ?? "unknown";
    } catch {
      /* */
    }
    if (len >= FLOOR) continue;
    belowFloor++;
    if (String(finish).toLowerCase() === "stop") stopFinish++;

    const tail = prose.slice(-500);
    const tags = classifySemanticEnd(tail, len);
    for (const t of tags) semanticCounts[t]++;
    const key = tags.filter((t) => t !== "other").join("+") || "other";
    triggerCombo[key] = (triggerCombo[key] ?? 0) + 1;
  }

  push(`  last-300 subset below FLOOR: ${belowFloor}`);
  push(`  with finish_reason=stop (from usage JSON): ${stopFinish}/${belowFloor}`);
  push("\n  Semantic pattern hits (tail 500 chars, multi-label):");
  for (const [k, v] of Object.entries(semanticCounts).sort((a, b) => b[1] - a[1])) {
    push(`    ${k}: ${v} (${pct(v, belowFloor)})`);
  }
  push("\n  Top trigger combinations:");
  for (const [k, v] of Object.entries(triggerCombo).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    push(`    ${k}: ${v}`);
  }

  // "Completed exchange" trigger: dialogue_resolution AND (action_completed OR character_waiting)
  let completedExchange = 0;
  for (const m of assistants) {
    const prose = displayProse(m.content);
    if (prose.length >= FLOOR) continue;
    const tail = prose.slice(-500);
    const tags = classifySemanticEnd(tail, prose.length);
    if (
      tags.includes("dialogue_resolution") &&
      (tags.includes("action_completed") || tags.includes("character_waiting"))
    ) {
      completedExchange++;
    }
  }
  push(
    `\n  "Completed exchange" trigger (dialogue + action|wait): ${completedExchange}/${belowFloor} (${pct(completedExchange, belowFloor)})`
  );

  // ── C. FLOOR ignored — rule conflict vs completion confidence ──
  push("", "## C. Why FLOOR is ignored — rule conflict vs completion confidence");

  const { buildContext } = await import("../src/services/contextBuilder");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");
  const { rawRecentTurnsToHistory, messagesToTurns } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { isResponseNaturallyComplete } = await import("../src/lib/responseLength");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

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
  const lastUser = allRows.filter((r: { role: string }) => r.role === "user").at(-1)?.content ?? "";

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
  const floorIdx = system.indexOf("MINIMUM_FLOOR");
  const topPriorityIdx = system.indexOf("3순위: 최근 대화");
  const handoffIdx = system.lastIndexOf("FORBIDDEN EARLY STOP");
  const continuationIdx = system.lastIndexOf("SCENE CONTINUATION PRIORITY");

  push(`  System token estimate: ~${estimateTokens(system)}`);
  push(`  Char offset TOP "3순위 최근 대화": ${topPriorityIdx} (early / cached)`);
  push(`  Char offset first MINIMUM_FLOOR: ${floorIdx}`);
  push(`  Char offset SCENE CONTINUATION (last): ${continuationIdx}`);
  push(`  Char offset FORBIDDEN EARLY STOP (last): ${handoffIdx}`);
  push(
    `  → FLOOR rules sit in TAIL (~${system.length - floorIdx} chars from first FLOOR mention to end)`
  );

  let naturallyCompleteBelow = 0;
  for (const m of assistants) {
    const prose = displayProse(m.content);
    if (prose.length >= FLOOR) continue;
    if (isResponseNaturallyComplete(prose, "stop")) naturallyCompleteBelow++;
  }
  push(
    `\n  isResponseNaturallyComplete(text, stop) on below-FLOOR last-300: ${naturallyCompleteBelow}/${belowFloor} (${pct(naturallyCompleteBelow, belowFloor)})`
  );
  push(
    "  → Server treats most short outputs as 'naturally complete' (complete sentence + stop), not rule-violation incomplete"
  );

  push("\n  Rule conflict assessment:");
  push("    - Explicit FLOOR: prohibitive (FORBIDDEN EARLY STOP, not a complete scene)");
  push("    - TOP priority: '3순위 최근 대화' elevates exchange-matching over tail numerics");
  push("    - No permissive 'stop when exchange complete' in rules");
  push(
    "  Verdict: FLOOR miss is primarily **completion confidence** (grammatically complete exchange) not explicit rule permission"
  );

  const builtHistory = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // ── D. Staged continuation — all models, identical system+history ──
  push("", "## D. Staged continuation gate — all models · identical prompt+history (chat #30)");
  push("  Stages: dialogue → reaction → atmosphere → tension → scene_shift");
  push("  Gate OPEN: total≥FLOOR OR added≥500ch (finish=stop otherwise = early stop)");

  const modelId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const maxTokens = 8192;
  const stageResults: Array<{
    model: string;
    stage: string;
    prefixLen: number;
    added: number;
    total: number;
    finish: string;
    gateOpen: boolean;
    terminal: StopStructure;
  }> = [];

  const stageShort: Record<string, string> = {
    dialogue_only: "dialogue",
    dialogue_reaction: "reaction",
    dialogue_reaction_atmosphere: "atmosphere",
    dialogue_reaction_atmosphere_tension: "tension",
    dialogue_reaction_atmosphere_tension_scene_shift: "scene_shift",
  };

  if (skipApi || !process.env.OPENROUTER_API_KEY?.trim()) {
    push("  [--skip-api or no key] multi-model staged experiment skipped");
  } else {
    for (const { label, id: stagedModelId } of STAGED_MODELS) {
      push(`\n  --- ${label} (${stagedModelId}) ---`);
      let firstOpenStage: string | null = null;
      for (const stage of STAGE_ORDER) {
        const prefix = STAGE_PREFIXES[stage];
        try {
          const r = await openRouterContinue({
            model: stagedModelId,
            system,
            history: builtHistory,
            user: lastUser,
            assistantPrefix: prefix,
            maxTokens,
            systemSplit: built.openRouterSystemSplit,
            charName: String(chatRow.name),
          });
          const prefixLen = displayProse(prefix).length;
          const total = displayProse(r.text).length;
          const added = total - prefixLen;
          const { terminal } = analyzeStopStructure(displayProse(r.text));
          const gate = continuationGateOpen(total, added, r.finishReason);
          if (gate && !firstOpenStage) firstOpenStage = stage;
          stageResults.push({
            model: label,
            stage,
            prefixLen,
            added,
            total,
            finish: r.finishReason,
            gateOpen: gate,
            terminal,
          });
          push(
            `    [${stageShort[stage]}] prefix=${prefixLen} · added=${added} · total=${total} · finish=${r.finishReason} · gate=${gate ? "OPEN" : "CLOSED"} · terminal=${terminal}`
          );
          fs.writeFileSync(
            path.join("output", `completion-stage-${label}-${stage}.txt`),
            r.text,
            "utf8"
          );
        } catch (e) {
          push(`    [${stageShort[stage]}] ERROR: ${(e as Error).message}`);
        }
      }
      push(`    → first gate OPEN at: ${firstOpenStage ? stageShort[firstOpenStage] : "none"}`);
    }

    push("\n  Gate comparison matrix:");
    push("    stage | deepseek | anthropic | qwen | gemini");
    for (const stage of STAGE_ORDER) {
      const cells = STAGED_MODELS.map(({ label }) => {
        const row = stageResults.find((r) => r.model === label && r.stage === stage);
        if (!row) return "?";
        return row.gateOpen ? `OPEN(+${row.added})` : `closed(+${row.added})`;
      });
      push(`    ${stageShort[stage]} | ${cells.join(" | ")}`);
    }
  }

  // ── E. Ending-structure replay (DeepSeek baseline) ──
  push("", "## E. Ending-structure replay (same length · resolved vs unresolved tail)");

  const poolAssistants = builtHistory.filter((m) => m.role === "assistant");
  if (poolAssistants.length >= 1) {
    const lastAsst = poolAssistants[poolAssistants.length - 1];
    const resolved = rewriteEndingResolved(lastAsst.content);
    const unresolved = rewriteEndingUnresolved(lastAsst.content);
    push(
      `  Last history assistant: ${displayProse(lastAsst.content).length}ch → resolved ${displayProse(resolved).length}ch · unresolved ${displayProse(unresolved).length}ch`
    );

    const shortHist = [...builtHistory.slice(0, -1), { role: "assistant" as const, content: lastAsst.content }];
    const resolvedHist = [
      ...builtHistory.slice(0, -1),
      { role: "assistant" as const, content: resolved },
    ];
    const unresolvedHist = [
      ...builtHistory.slice(0, -1),
      { role: "assistant" as const, content: unresolved },
    ];

    if (!skipApi && process.env.OPENROUTER_API_KEY?.trim()) {
      push("\n  Running 3-arm ending-structure replay (empty prefix, full generation)…");
      const arms = [
        { label: "original_ending", history: shortHist },
        { label: "resolved_ending", history: resolvedHist },
        { label: "unresolved_ending", history: unresolvedHist },
      ];
      for (const arm of arms) {
        try {
          const r = await openRouterContinue({
            model: modelId,
            system,
            history: arm.history,
            user: lastUser,
            assistantPrefix: "",
            maxTokens,
            systemSplit: built.openRouterSystemSplit,
            charName: String(chatRow.name),
          });
          const total = displayProse(r.text).length;
          push(
            `    ${arm.label}: ${total}ch · finish=${r.finishReason} · tokens=${r.completionTokens} · tags=${classifySemanticEnd(r.text.slice(-500), total).join("+")}`
          );
          fs.writeFileSync(
            path.join("output", `completion-ending-${arm.label}.txt`),
            r.text,
            "utf8"
          );
        } catch (e) {
          push(`    ${arm.label} ERROR: ${(e as Error).message}`);
        }
      }
    }
  }

  push("", "## Summary — scene completion heuristic");
  push(
    `  1. Below-FLOOR terminal structure (all DB): dialogue_resolution=${terminalCounts.dialogue_resolution} immediate_reaction=${terminalCounts.immediate_reaction} observer_wait=${terminalCounts.observer_wait_ending} atmosphere=${terminalCounts.atmosphere_block} tension=${terminalCounts.tension_continuation} scene_shift=${terminalCounts.scene_state_transition}`
  );
  push(
    `  2. ${pct(stopAfterDialogueReaction, belowFloorAll)} stop with terminal dialogue/reaction — gate closes before atmosphere`
  );
  push(
    `  3. ${pct(naturallyCompleteBelow, belowFloor)} isResponseNaturallyComplete (last-300) — grammatical DONE heuristic`
  );
  push("  4. Multi-model staged outputs: output/completion-stage-{model}-{stage}.txt");
  if (stageResults.length > 0) {
    const gatesByModel = STAGED_MODELS.map(({ label }) => {
      const first = STAGE_ORDER.find((s) =>
        stageResults.some((r) => r.model === label && r.stage === s && r.gateOpen)
      );
      return `${label}→${first ? stageShort[first] : "none"}`;
    });
    push(`  5. First gate OPEN: ${gatesByModel.join(" · ")}`);
  }

  const outPath = path.join("output", "investigate-completion-heuristic.txt");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(lines.join("\n"));

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
