/**
 * sw-hud HTML history A/B — chat_id=25 production fixture, single variable.
 * A = history with bare sw-hud HTML · B = same history, sw-hud stripped (RP prose byte-identical)
 * 10 runs × 2 arms = 20 API calls max.
 *
 * Usage: npx.cmd tsx scripts/ab-sw-hud-history-deepseek.ts
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

const CHAT_ID = 25;
const MODEL_ID = "deepseek/deepseek-v4-pro";
const ARMS = ["A", "B"] as const;
const RUNS = 10;
const MAX_CALLS = 20;
const FLOOR = 2200;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;

type Arm = (typeof ARMS)[number];

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type OutputMode = "continuation-mode" | "completion-mode" | "mixed";

type Sample = {
  arm: Arm;
  run: number;
  output_chars: number;
  beat_count: number;
  finish_reason: string;
  floor_pass: boolean;
  continuation_markers: number;
  observer_wait: boolean;
  completion_mode_ratio: number;
  output_mode: OutputMode;
  terminal_structure: StopStructure;
};

const CONTINUATION_HOOK =
  /(?:하지만|그런데|아직|더 |계속|이어서|이어|다음|한참|추가로|연속|이윽고|곧바로|다시금|또 한|한층 더|더욱|연이어|멈추지|끝나지|걸려|파고들|말해지지|아직도|좀처럼|여전히|다시|한편|그러나|그 순간|그 말과 동시에|그리고|그러고|이어지|시작하|향해|다가|내밀|뻗|당기|끌어|밀어|움직|일어|들어|열리|닫히)/g;

const OPEN_LOOP =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|확인하며|시선을 고정)/;

const INCOMPLETE_END = /(?:…|,|—|\-|중이었다|하고|으며|이며|듯|채|며|자|면|게|고|며서|면서)\s*$/;

const DANGLING_DIALOGUE = /"[^"]{8,}$/;

const PAUSE_OK =
  /(?:기다렸다|기다리며|고요|정적|침묵|망설|가만히|멈춰|멈췄다|멈추었다|숨을 고|호흡|안도|편안|해결|만족|끝냈다|끝났다|사라졌|멀어지|떠나|나갔|들어갔|닫혔|열렸|완전히|드디어|마침내|그대로|일어섰다|걸어 들어|향해 걸어)/;

const ACTION_CLOSED =
  /(?:했다|하였다|했었다|말았다|끝났다|멈췄다|굳었다|정지했다|사라졌다|멀어졌다|떠났다|나갔다|들어갔다|닫혔다|열렸다|일어섰다|앉았다|잡았다|당겼다|밀었다|안았다|키스했다|돌아섰다)\s*[.!?…]?\s*$/;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function splitBareSwHud(text: string): { prose: string; html: string } {
  const swHudIdx = text.search(/sw-hud/i);
  if (swHudIdx < 0) return { prose: text, html: "" };
  const divStart = text.lastIndexOf("<div", swHudIdx);
  const start = divStart >= 0 ? divStart : swHudIdx;
  return { prose: text.slice(0, start).trimEnd(), html: text.slice(start).trim() };
}

function stripSwHudHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((m) => {
    if (m.role !== "assistant") return m;
    const { prose, html } = splitBareSwHud(m.content);
    if (html && !m.content.startsWith(prose)) {
      throw new Error("sw-hud strip would alter RP prose bytes");
    }
    return { ...m, content: prose };
  });
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/sw-hud/i);
  if (j >= 0) {
    const divStart = s.lastIndexOf("<div", j);
    if (divStart >= 0) s = s.slice(0, divStart).trimEnd();
  }
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
    /(?:공기가|분위기|향기|조명|어둠|온도|밀폐|실내|주변|철 상자|엘리베이터|아스팔트|게이트)/.test(t) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";
  if (/(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|반응을 기다|대답을 기다)/.test(t))
    return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)) return "dialogue_resolution";
  if (/(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨|금안)/.test(t))
    return "immediate_reaction";
  return "other";
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

type SentenceSignal = "continuation" | "completion" | "neutral";

function classifySentence(sent: string, isLast: boolean): SentenceSignal {
  const t = sent.trim();
  if (!t || t.length < 5) return "neutral";
  let cont = 0;
  let comp = 0;
  if (CONTINUATION_HOOK.test(t)) cont += 2;
  CONTINUATION_HOOK.lastIndex = 0;
  if (OPEN_LOOP.test(t)) cont += 2;
  if (INCOMPLETE_END.test(t)) cont += 2;
  if (DANGLING_DIALOGUE.test(t)) cont += 3;
  if (PAUSE_OK.test(t)) comp += 2;
  if (ACTION_CLOSED.test(t)) comp += 2;
  if (isLast) {
    if (PAUSE_OK.test(t) || ACTION_CLOSED.test(t)) comp += 2;
    if (INCOMPLETE_END.test(t) || DANGLING_DIALOGUE.test(t)) cont += 2;
  }
  if (cont > comp + 1) return "continuation";
  if (comp > cont + 1) return "completion";
  if (cont > comp) return "continuation";
  if (comp > cont) return "completion";
  return "neutral";
}

function classifyOutputMode(
  sentences: string[],
  finishReason: string,
  blockCount: number
): { mode: OutputMode; completionRatio: number } {
  if (sentences.length === 0) return { mode: "mixed", completionRatio: 0 };
  const signals = sentences.map((s, i) => classifySentence(s, i === sentences.length - 1));
  const comp = signals.filter((s) => s === "completion").length;
  const cont = signals.filter((s) => s === "continuation").length;
  const nonNeutral = signals.filter((s) => s !== "neutral").length;
  const completionRatio = nonNeutral > 0 ? comp / nonNeutral : comp / sentences.length;

  const last = sentences[sentences.length - 1] ?? "";
  const tailOpen =
    INCOMPLETE_END.test(last) ||
    DANGLING_DIALOGUE.test(last) ||
    OPEN_LOOP.test(last);

  if (finishReason === "length") return { mode: "continuation-mode", completionRatio };
  if (blockCount === 1) return { mode: "continuation-mode", completionRatio };
  const contPct = cont / sentences.length;
  const compPct = comp / sentences.length;
  if (contPct >= 0.25 && cont >= comp && tailOpen) return { mode: "continuation-mode", completionRatio };
  if (compPct >= 0.18 && !tailOpen) return { mode: "completion-mode", completionRatio };
  if (contPct > compPct + 0.08) return { mode: "continuation-mode", completionRatio };
  if (compPct > contPct + 0.05) return { mode: "completion-mode", completionRatio };
  return { mode: "mixed", completionRatio };
}

function countContinuationMarkers(prose: string): number {
  const m = prose.match(CONTINUATION_HOOK);
  CONTINUATION_HOOK.lastIndex = 0;
  return m?.length ?? 0;
}

function analyzeOutput(prose: string, finishReason: string) {
  const paragraphs = prose.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.map(classifyBlock);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const sentences = splitSentences(prose);
  const { mode, completionRatio } = classifyOutputMode(sentences, finishReason, paragraphs.length);
  return {
    beat_count: paragraphs.length,
    terminal_structure: terminal,
    observer_wait: terminal === "observer_wait_ending" || OPEN_LOOP.test(prose.slice(-400)),
    continuation_markers: countContinuationMarkers(prose),
    completion_mode_ratio: completionRatio,
    output_mode: mode,
  };
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

function cohensD(a: number[], b: number[]) {
  const pooled = Math.sqrt((std(a) ** 2 + std(b) ** 2) / 2);
  if (!pooled) return 0;
  return (mean(a) - mean(b)) / pooled;
}

function pct(n: number, t: number) {
  return t ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

async function buildProductionFixture() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const chat = db
    .prepare(
      `SELECT c.*, ch.name, ch.gender, ch.system_prompt, ch.world, ch.example_dialog,
              ch.setting_chunks, ch.setting_chunks_en, ch.prompt_translation_hash,
              ch.speech_profile, ch.nsfw, ch.genres, ch.status_widget_json,
              ch.status_widget_allow_user_override
       FROM chats c JOIN characters ch ON ch.id = c.character_id WHERE c.id = ?`
    )
    .get(CHAT_ID) as Record<string, unknown>;

  const user = db.prepare("SELECT id, nickname FROM users WHERE id = ?").get(chat.user_id) as {
    id: number;
    nickname: string;
  };
  const persona = db
    .prepare("SELECT * FROM user_personas WHERE id = ?")
    .get(chat.selected_persona_id) as { name: string; description: string; gender: string } | undefined;

  const allRows = db
    .prepare(`SELECT id, role, content, model FROM messages WHERE chat_id = ? AND id < 337 ORDER BY id ASC`)
    .all(CHAT_ID) as Array<{ id: number; role: string; content: string; model: string }>;

  const lastUser = allRows.filter((r) => r.role === "user").at(-1)?.content ?? "";
  const genCtx = JSON.parse(
    (db.prepare("SELECT context_json FROM message_generations WHERE message_id=337 LIMIT 1").get() as
      | { context_json: string }
      | undefined)?.context_json ?? "{}"
  ) as { targetResponseChars?: number; completedTurns?: number };

  db.close();

  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");
  const { replaceUserPlaceholder } = await import("../src/lib/userPlaceholder");
  const { buildStatusWidgetPromptBlock } = await import("../src/lib/statusWidget/prompt");
  const { resolveStatusWidgetTurn } = await import("../src/lib/statusWidget/resolve");
  const { isMemoryFeatureEnabled } = await import("../src/lib/memory/memory-feature");
  const { isMainModelRelationshipSelfExtractModel } = await import(
    "../src/lib/relationshipMemoryTailPrompt"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const personaDisplayName = persona?.name?.trim() || user.nickname;
  const turns = messagesToTurns(
    allRows.map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      model: r.model,
    }))
  );
  const completedTurns = genCtx.completedTurns ?? turns.length;
  const targetResponseChars = genCtx.targetResponseChars ?? 3000;

  const shortTermHistory = rawRecentTurnsToHistory(
    turns,
    Number(chat.memory_archived_turns ?? 0),
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", completedTurns)
  ).map((m) => ({
    ...m,
    content: replaceUserPlaceholder(m.content, personaDisplayName, user.nickname),
  }));

  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: Number(chat.character_id),
      name: String(chat.name ?? "char"),
      gender: chat.gender as string | null,
      system_prompt: String(chat.system_prompt ?? ""),
      world: String(chat.world ?? ""),
      example_dialog: String(chat.example_dialog ?? ""),
      setting_chunks: String(chat.setting_chunks ?? "[]"),
      setting_chunks_en: String(chat.setting_chunks_en ?? ""),
      prompt_translation_hash: String(chat.prompt_translation_hash ?? ""),
      speech_profile: String(chat.speech_profile ?? ""),
    },
    user.nickname,
    personaDisplayName
  );

  const statusResolved = resolveStatusWidgetTurn({
    characterWidgetJson: String(chat.status_widget_json ?? ""),
    userWidgetJson: String(chat.user_status_widget_json ?? ""),
    chatMode: String(chat.status_widget_mode ?? "off"),
    stackOrder: String(chat.status_widget_stack_order ?? ""),
    characterAllowUserOverride: Boolean(chat.status_widget_allow_user_override),
  });

  const memoryOn = isMemoryFeatureEnabled();
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(chat.name ?? "char"),
    systemPrompt: String(chat.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });
  const built = buildContext({
    charName: String(chat.name ?? "char"),
    chunks,
    userNickname: user.nickname,
    userPersona: formatSelectedPersonaForPrompt(
      personaDisplayName,
      (persona?.gender as "male" | "female" | "other") ?? "other",
      persona?.description ?? ""
    ),
    userNote: formatUserNoteForPrompt(String(chat.user_note ?? ""), personaDisplayName),
    longTermMemory: String(chat.current_summary ?? ""),
    shortTermHistory,
    currentUserMessage: replaceUserPlaceholder(lastUser, personaDisplayName, user.nickname),
    nsfw: Boolean(chat.nsfw),
    gender: (chat.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: memoryOn
      ? formatMemoryMetaForPrompt(
          normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "{}")), relationshipNames)
        )
      : "",
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName,
    targetResponseChars,
    completedTurns,
    userPersonaGender: (persona?.gender as "male" | "female" | "other") ?? "other",
    statusWidgetActive: statusResolved.active,
    statusWidgetPromptBlock: buildStatusWidgetPromptBlock(statusResolved),
    mainModelOwnsRelationshipExtract:
      memoryOn && isMainModelRelationshipSelfExtractModel(MODEL_ID),
    promptDumpSource: "db",
    promptDumpDetail: `ab-sw-hud chat=${CHAT_ID}`,
  });

  const split = built.openRouterSystemSplit!;
  const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");
  const historyA = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  for (const m of historyA) {
    if (m.role !== "assistant") continue;
    const { prose, html } = splitBareSwHud(m.content);
    if (html && m.content !== prose + (prose.endsWith("\n") ? "" : "\n") + html && !m.content.endsWith(html)) {
      // prose prefix check
      if (!m.content.startsWith(prose)) {
        throw new Error(`RP prose prefix mismatch msg assistant len=${m.content.length}`);
      }
    }
  }

  const historyB = stripSwHudHistory(historyA);

  let htmlTokA = 0;
  let htmlTokB = 0;
  let proseTokA = 0;
  for (const m of historyA) {
    if (m.role !== "assistant") continue;
    const { prose, html } = splitBareSwHud(m.content);
    htmlTokA += estimateTokens(html);
    proseTokA += estimateTokens(prose);
  }
  for (const m of historyB) {
    if (m.role !== "assistant") continue;
    htmlTokB += estimateTokens(splitBareSwHud(m.content).html);
  }

  return {
    charName: String(chat.name),
    system,
    split,
    userMessage: replaceUserPlaceholder(lastUser, personaDisplayName, user.nickname),
    historyA,
    historyB,
    targetResponseChars,
    completedTurns,
    fixtureMeta: {
      htmlTokA,
      htmlTokB,
      proseTokA,
      historyMsgs: historyA.length,
      systemChars: system.length,
    },
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample & { error?: string };
    if (typeof j.output_chars === "number") done.add(`${j.arm}|${j.run}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.output_chars !== "number") continue;
    byKey.set(`${s.arm}|${s.run}`, s);
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
  const jsonlPath = path.join(outDir, "sw-hud-history-ablation.jsonl");
  const reportPath = path.join(outDir, "sw-hud-history-ablation-report.txt");
  const done = loadDone(jsonlPath);

  const fx = await buildProductionFixture();
  console.log(
    `Fixture chat=${CHAT_ID} turns=${fx.completedTurns} target=${fx.targetResponseChars} historyMsgs=${fx.fixtureMeta.historyMsgs} htmlTok A=${fx.fixtureMeta.htmlTokA} B=${fx.fixtureMeta.htmlTokB}`
  );

  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  let apiCalls = 0;

  for (const arm of ARMS) {
    const history = arm === "A" ? fx.historyA : fx.historyB;
    console.log(`\n=== Arm ${arm} historyChars=${history.reduce((s, m) => s + m.content.length, 0)} ===`);

    for (let run = 1; run <= RUNS; run++) {
      const key = `${arm}|${run}`;
      if (done.has(key)) {
        console.log(`Arm ${arm} run ${run}/${RUNS} skip (done)`);
        continue;
      }
      if (apiCalls >= MAX_CALLS) {
        console.error(`MAX_CALLS ${MAX_CALLS} reached`);
        process.exit(3);
      }
      process.stdout.write(`Arm ${arm} run ${run}/${RUNS}\n`);
      let ok = false;
      for (let att = 1; att <= MAX_ATTEMPTS; att++) {
        await sleep(DELAY_MS);
        apiCalls++;
        try {
          const result = await callOpenRouterAdult(
            fx.system,
            [...history, { role: "user", content: fx.userMessage }],
            MODEL_ID,
            fx.targetResponseChars,
            { charName: fx.charName, systemSplit: fx.split },
            { chargeTurnBudget: false, requestKind: "sw-hud-history-ablation" }
          );
          const prose = displayProse(result.text);
          const finishReason = String(result.usage?.finishReason ?? "unknown");
          const analyzed = analyzeOutput(prose, finishReason);
          const sample: Sample = {
            arm,
            run,
            output_chars: prose.length,
            beat_count: analyzed.beat_count,
            finish_reason: finishReason,
            floor_pass: prose.length >= FLOOR,
            continuation_markers: analyzed.continuation_markers,
            observer_wait: analyzed.observer_wait,
            completion_mode_ratio: analyzed.completion_mode_ratio,
            output_mode: analyzed.output_mode,
            terminal_structure: analyzed.terminal_structure,
          };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(
            `  ok ${sample.output_chars}ch beats=${sample.beat_count} finish=${finishReason} floor=${sample.floor_pass} cont=${sample.continuation_markers} obsWait=${sample.observer_wait} compRatio=${sample.completion_mode_ratio.toFixed(2)} mode=${sample.output_mode}`
          );
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 120)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(jsonlPath, JSON.stringify({ arm, run, error: "failed" }) + "\n", "utf8");
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const a = samples.filter((s) => s.arm === "A");
  const b = samples.filter((s) => s.arm === "B");

  const lines: string[] = [
    "sw-hud HTML HISTORY A/B — chat_id=25 · DeepSeek V4 Pro",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · FLOOR=${FLOOR} · runs=${RUNS}/arm · apiCalls=${apiCalls}`,
    "single variable: assistant history bare sw-hud HTML present (A) vs stripped (B)",
    "prompt/system/user/history-turns identical except sw-hud strip in B",
    "",
    `fixture: completedTurns=${fx.completedTurns} targetResponseChars=${fx.targetResponseChars}`,
    `  history html tokens A=${fx.fixtureMeta.htmlTokA} B=${fx.fixtureMeta.htmlTokB}`,
    `  user input: ${fx.userMessage.slice(0, 60)}`,
    "",
    "### Arm A (sw-hud IN history)",
    summarizeArm(a),
    "",
    "### Arm B (sw-hud STRIPPED, RP prose byte-identical)",
    summarizeArm(b),
    "",
    "### Effect size B vs A (positive Δ = B longer / more completion)",
    effectBlock(a, b),
    "",
    "### Per-run chars",
    ...a.map((s) => `  A run${s.run}: ${s.output_chars}ch finish=${s.finish_reason} beats=${s.beat_count}`),
    ...b.map((s) => `  B run${s.run}: ${s.output_chars}ch finish=${s.finish_reason} beats=${s.beat_count}`),
  ];

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

function summarizeArm(sub: Sample[]): string {
  if (!sub.length) return "  (no samples)";
  const chars = sub.map((s) => s.output_chars);
  const beats = sub.map((s) => s.beat_count);
  const cont = sub.map((s) => s.continuation_markers);
  const comp = sub.map((s) => s.completion_mode_ratio);
  const floorN = sub.filter((s) => s.floor_pass).length;
  const obsN = sub.filter((s) => s.observer_wait).length;
  const compModeN = sub.filter((s) => s.output_mode === "completion-mode").length;
  const contModeN = sub.filter((s) => s.output_mode === "continuation-mode").length;
  const finishLen = sub.filter((s) => s.finish_reason === "length").length;

  const termDist: Record<string, number> = {};
  for (const s of sub) termDist[s.terminal_structure] = (termDist[s.terminal_structure] ?? 0) + 1;

  return [
    `  n=${sub.length} mean_chars=${mean(chars).toFixed(0)} range=${Math.min(...chars)}-${Math.max(...chars)}`,
    `  mean_beats=${mean(beats).toFixed(1)} FLOOR=${pct(floorN, sub.length)} finish=length ${pct(finishLen, sub.length)}`,
    `  mean_continuation_markers=${mean(cont).toFixed(1)} observer_wait=${pct(obsN, sub.length)}`,
    `  mean_completion_mode_ratio=${mean(comp).toFixed(3)} completion-mode=${pct(compModeN, sub.length)} continuation-mode=${pct(contModeN, sub.length)}`,
    `  terminal: ${Object.entries(termDist).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  ].join("\n");
}

function effectBlock(a: Sample[], b: Sample[]): string {
  if (!a.length || !b.length) return "  insufficient samples";
  const aChars = a.map((s) => s.output_chars);
  const bChars = b.map((s) => s.output_chars);
  const dLen = mean(bChars) - mean(aChars);
  const dBeats = mean(b.map((s) => s.beat_count)) - mean(a.map((s) => s.beat_count));
  const dCont = mean(b.map((s) => s.continuation_markers)) - mean(a.map((s) => s.continuation_markers));
  const dComp = mean(b.map((s) => s.completion_mode_ratio)) - mean(a.map((s) => s.completion_mode_ratio));
  const dFloor =
    (b.filter((s) => s.floor_pass).length / b.length -
      a.filter((s) => s.floor_pass).length / a.length) *
    100;
  const dObs =
    (b.filter((s) => s.observer_wait).length / b.length -
      a.filter((s) => s.observer_wait).length / a.length) *
    100;
  const d = cohensD(bChars, aChars);

  return [
    `  Δmean_chars (B-A): ${dLen >= 0 ? "+" : ""}${dLen.toFixed(0)}  Cohen's d=${d.toFixed(2)}`,
    `  Δmean_beats: ${dBeats >= 0 ? "+" : ""}${dBeats.toFixed(1)}`,
    `  ΔFLOOR pass rate: ${dFloor >= 0 ? "+" : ""}${dFloor.toFixed(1)}pp`,
    `  Δcontinuation_markers: ${dCont >= 0 ? "+" : ""}${dCont.toFixed(1)}`,
    `  Δobserver_wait rate: ${dObs >= 0 ? "+" : ""}${dObs.toFixed(1)}pp`,
    `  Δcompletion_mode_ratio: ${dComp >= 0 ? "+" : ""}${dComp.toFixed(3)}`,
    `  interpretation: |d|<0.2 negligible · 0.2-0.5 small · 0.5-0.8 medium · >0.8 large`,
  ].join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
