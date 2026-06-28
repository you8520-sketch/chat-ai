/**
 * Where models learn "one completed exchange = valid stop" — evidence only.
 *
 * Usage:
 *   npx.cmd tsx scripts/investigate-stopping-signal.ts
 *   npx.cmd tsx scripts/investigate-stopping-signal.ts --skip-api
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
const skipApi = process.argv.includes("--skip-api");

// ── Beat / structure helpers (from audit-beat-completion) ──
type BeatKind = "Initiation" | "Reaction" | "Follow-through" | "Consequence" | "Pause";
type StopAfter =
  | "A_initiation"
  | "B_reaction"
  | "C_follow_through"
  | "D_consequence"
  | "E_true_pause";

const PAUSE_PATTERN =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시하며|호흡.*(?:들|확인)|침묵|정적|고요|망설|가늠|질문이었다|재촉이 아닌|멈춘 채|멈추고)/;

const CONSEQUENCE_PATTERN =
  /(?:번져|흔들|떨리|떨렸|경련|반응이|몸이|속눈썹|숨소리|체온|열띤|차가|떨림|느껴졌|감지|스쳐|일그러|파르르|삐걱|좁혀|섞이|적응)/;

const REACTION_PATTERN =
  /(?:렌의|상대의|그의 말|그 말|요청|무서|긴장|표정|눈동자|시선이|떨|말투|대답|말을 듣|입에서|속삭|고개를)/;

const INITIATION_PATTERN =
  /(?:한 걸음|내밀|잡|쥐|다가|향하|말을 꺼|입을 열|손을|뻗|당기|끌|밀|쓸|맞추|키스|안아|품|기울|숙|일으|벗|풀|열|닫|물러|서서|앉|일어)/;

const FOLLOW_PATTERN =
  /(?:더|계속|천천히|아주|조금|미세|힘을 주|움직|쓸었|당겨|끌어|밀어|느리게|한 번|다시|반복)/;

const CONTINUATION_PATTERN =
  /(?:이어서|그리고 나|한참|계속해서|더 깊이|추가로|연속으로|차례로|그 뒤|그 후|이윽고|곧바로|다시금|또 한|한층 더|더욱|연이어)/;

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function beatKindToStopAfter(kind: BeatKind): StopAfter {
  switch (kind) {
    case "Initiation":
      return "A_initiation";
    case "Reaction":
      return "B_reaction";
    case "Follow-through":
      return "C_follow_through";
    case "Consequence":
      return "D_consequence";
    case "Pause":
      return "E_true_pause";
  }
}

function classifyBeat(
  text: string,
  prior: { kind: BeatKind }[],
  source: "dialogue" | "narration"
): BeatKind {
  const t = text.trim();
  if (!t) return "Follow-through";
  if (PAUSE_PATTERN.test(t)) return "Pause";
  if (CONSEQUENCE_PATTERN.test(t) && !PAUSE_PATTERN.test(t)) return "Consequence";
  if (source === "dialogue") {
    const last = prior[prior.length - 1]?.kind;
    if (last === "Initiation" || last === "Follow-through") return "Follow-through";
    if (REACTION_PATTERN.test(t)) return "Reaction";
    return "Initiation";
  }
  if (prior.length === 0) return REACTION_PATTERN.test(t) ? "Reaction" : "Initiation";
  const last = prior[prior.length - 1]?.kind;
  if (FOLLOW_PATTERN.test(t) && last !== "Pause") return "Follow-through";
  if (INITIATION_PATTERN.test(t) && last !== "Initiation") return "Initiation";
  if (REACTION_PATTERN.test(t) && (last === "Initiation" || last === "Follow-through"))
    return "Consequence";
  const progression: BeatKind[] = [
    "Reaction",
    "Initiation",
    "Follow-through",
    "Consequence",
    "Pause",
  ];
  const idx = progression.indexOf(last);
  if (idx >= 0 && idx < progression.length - 1) return progression[idx + 1];
  if (last === "Pause") return "Initiation";
  return "Follow-through";
}

function segmentBeats(text: string) {
  const beats: { kind: BeatKind; source: string; text: string }[] = [];
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());
  for (const para of paragraphs) {
    const parts: { type: "dialogue" | "narration"; text: string }[] = [];
    let lastIndex = 0;
    const dialogueRegex = /"[^"]*"/g;
    let match: RegExpExecArray | null;
    while ((match = dialogueRegex.exec(para)) !== null) {
      if (match.index > lastIndex) {
        const narr = para.slice(lastIndex, match.index).trim();
        if (narr) parts.push({ type: "narration", text: narr });
      }
      parts.push({ type: "dialogue", text: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < para.length) {
      const narr = para.slice(lastIndex).trim();
      if (narr) parts.push({ type: "narration", text: narr });
    }
    if (parts.length === 0) parts.push({ type: "narration", text: para });
    for (const part of parts) {
      if (part.type === "dialogue") {
        beats.push({
          text: part.text,
          kind: classifyBeat(part.text, beats, "dialogue"),
          source: "dialogue",
        });
      } else {
        for (const sent of splitSentences(part.text)) {
          beats.push({
            text: sent,
            kind: classifyBeat(sent, beats, "narration"),
            source: "narration",
          });
        }
      }
    }
  }
  return beats;
}

function displayProse(content: string): string {
  let s = content ?? "";
  const statusIdx = s.search(/<<<STATUS_VALUES/i);
  if (statusIdx >= 0) s = s.slice(0, statusIdx);
  const relIdx = s.search(/\{"honorifics"/);
  if (relIdx >= 0) s = s.slice(0, relIdx);
  return s.trim();
}

type StructureClass = "single-beat" | "multi-beat" | "scene-continuation";

function classifyStructure(prose: string): StructureClass {
  const chars = prose.length;
  const dialogueCount = (prose.match(/"[^"]{3,}"/g) ?? []).length;
  const paragraphs = prose.split(/\n\n+/).filter((p) => p.trim()).length;
  const beats = segmentBeats(prose);
  const stopAfter =
    beats.length > 0 ? beatKindToStopAfter(beats[beats.length - 1].kind) : "A_initiation";

  // scene-continuation: meets floor or sustained multi-exchange development
  if (
    chars >= FLOOR ||
    (dialogueCount >= 5 && paragraphs >= 7) ||
    (beats.length >= 6 && stopAfter === "D_consequence")
  ) {
    return "scene-continuation";
  }

  // single-beat: stops after initiation/reaction OR one tight exchange
  if (
    stopAfter === "A_initiation" ||
    stopAfter === "B_reaction" ||
    (dialogueCount <= 2 && paragraphs <= 4 && chars < 2000)
  ) {
    return "single-beat";
  }

  // multi-beat: follow-through/consequence but below scene-continuation thresholds
  return "multi-beat";
}

function analyzeEnding(prose: string) {
  const lastPara = prose.split(/\n\n+/).filter((p) => p.trim()).pop()?.trim() ?? prose.trim();
  const tail = prose.slice(-400);
  return {
    observer_wait: PAUSE_PATTERN.test(lastPara) || PAUSE_PATTERN.test(tail),
    dialogue_complete: /"[^"]{4,}"\s*[.!?…]?\s*$/.test(lastPara.trim()) || /"[^"]{4,}"/.test(tail),
    action_complete:
      /(?:했다|했다\.|말았다|끝냈다|돌아|걸어|나가|들어|앉|일어|잡|당기|밀|안아|키스|문을|엘리베이터|떠나|향해)/.test(
        lastPara
      ),
    explicit_continuation:
      CONTINUATION_PATTERN.test(lastPara) ||
      /(?:아직|더 |계속|이어|다음|한참|추가|연속)/.test(lastPara),
  };
}

function pct(n: number, total: number) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "0%";
}

function countPhrases(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const m = text.match(p);
    n += m?.length ?? 0;
  }
  return n;
}

async function main() {
  const db = new Database(path.resolve("data/app.db"), { readonly: true });
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("=".repeat(80));
  push("STOPPING SIGNAL INVESTIGATION — where one exchange feels complete");
  push(`generated: ${new Date().toISOString()}`);
  push("=".repeat(80));

  const allAssistants = db
    .prepare(
      `SELECT m.id, m.chat_id, m.content, m.model, m.created_at
       FROM messages m WHERE m.role = 'assistant' AND m.model != 'greeting' ORDER BY m.id`
    )
    .all() as Array<{ id: number; chat_id: number; content: string; model: string }>;

  const last300 = allAssistants.slice(-300);

  // ── 1. History structure (messages that enter raw pool = sent back) ──
  push("", "## 1. History structure — assistant messages in raw pool (few-shot exemplars)");

  function messagesToTurns(rows: Array<{ role: string; content: string; model?: string; id?: number }>) {
    const turns: Array<{ user: string; assistant: string; assistantId: number }> = [];
    let u: string | null = null;
    for (const r of rows) {
      if (r.role === "user") u = r.content;
      else if (r.role === "assistant" && r.model !== "greeting" && u && r.id) {
        turns.push({ user: u, assistant: r.content, assistantId: r.id });
        u = null;
      }
    }
    return turns;
  }

  const poolMessages: Array<{ id: number; prose: string; chat_id: number }> = [];
  const memoryChats = db
    .prepare("SELECT chat_id, summarized_turn_count FROM chat_memories WHERE summarized_turn_count > 0")
    .all() as Array<{ chat_id: number; summarized_turn_count: number }>;

  for (const mc of memoryChats) {
    const rows = db
      .prepare("SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id")
      .all(mc.chat_id);
    const turns = messagesToTurns(rows as Array<{ role: string; content: string; model: string; id: number }>);
    for (const t of turns.slice(mc.summarized_turn_count)) {
      const prose = displayProse(t.assistant);
      poolMessages.push({ id: t.assistantId, prose, chat_id: mc.chat_id });
    }
  }

  // Also include chats without memory summarization but with history
  for (const row of db.prepare("SELECT id FROM chats").all() as Array<{ id: number }>) {
    if (memoryChats.some((m) => m.chat_id === row.id)) continue;
    const rows = db
      .prepare("SELECT id, role, content, model FROM messages WHERE chat_id = ? ORDER BY id")
      .all(row.id);
    const turns = messagesToTurns(rows as Array<{ role: string; content: string; model: string; id: number }>);
    for (const t of turns) {
      poolMessages.push({ id: t.assistantId, prose: displayProse(t.assistant), chat_id: row.id });
    }
  }

  const poolStruct = { single: 0, multi: 0, scene: 0 };
  for (const m of poolMessages) {
    const c = classifyStructure(m.prose);
    if (c === "single-beat") poolStruct.single++;
    else if (c === "multi-beat") poolStruct.multi++;
    else poolStruct.scene++;
  }
  const poolN = poolMessages.length;

  push(`  Raw-pool assistant messages (would be sent as history): n=${poolN}`);
  push(`    single-beat: ${poolStruct.single} (${pct(poolStruct.single, poolN)})`);
  push(`    multi-beat: ${poolStruct.multi} (${pct(poolStruct.multi, poolN)})`);
  push(`    scene-continuation: ${poolStruct.scene} (${pct(poolStruct.scene, poolN)})`);

  const allStruct = { single: 0, multi: 0, scene: 0 };
  for (const m of allAssistants) {
    const prose = displayProse(m.content);
    const c = classifyStructure(prose);
    if (c === "single-beat") allStruct.single++;
    else if (c === "multi-beat") allStruct.multi++;
    else allStruct.scene++;
  }
  push(`\n  ALL saved assistants (reference): n=${allAssistants.length}`);
  push(`    single-beat: ${allStruct.single} (${pct(allStruct.single, allAssistants.length)})`);
  push(`    multi-beat: ${allStruct.multi} (${pct(allStruct.multi, allAssistants.length)})`);
  push(`    scene-continuation: ${allStruct.scene} (${pct(allStruct.scene, allAssistants.length)})`);

  // Below floor in pool
  const poolBelow = poolMessages.filter((m) => m.prose.length < FLOOR);
  const poolBelowStruct = { single: 0, multi: 0, scene: 0 };
  for (const m of poolBelow) {
    const c = classifyStructure(m.prose);
    if (c === "single-beat") poolBelowStruct.single++;
    else if (c === "multi-beat") poolBelowStruct.multi++;
    else poolBelowStruct.scene++;
  }
  push(`\n  Raw-pool messages below FLOOR (${FLOOR}): n=${poolBelow.length}`);
  push(`    single-beat: ${pct(poolBelowStruct.single, poolBelow.length)} · multi: ${pct(poolBelowStruct.multi, poolBelow.length)} · scene: ${pct(poolBelowStruct.scene, poolBelow.length)}`);

  // ── 2. Last 300 assistant endings ──
  push("", "## 2. Last 300 assistant message endings");

  const endCounts = {
    observer_wait: 0,
    dialogue_complete: 0,
    action_complete: 0,
    explicit_continuation: 0,
  };
  const belowFloorEnds = { ...endCounts };

  for (const m of last300) {
    const prose = displayProse(m.content);
    const e = analyzeEnding(prose);
    for (const k of Object.keys(endCounts) as Array<keyof typeof endCounts>) {
      if (e[k]) endCounts[k]++;
      if (prose.length < FLOOR && e[k]) belowFloorEnds[k]++;
    }
  }

  push(`  n=${last300.length}`);
  for (const [k, v] of Object.entries(endCounts)) {
    push(`    ${k}: ${v} (${pct(v, last300.length)})`);
  }
  const belowN = last300.filter((m) => displayProse(m.content).length < FLOOR).length;
  push(`\n  below FLOOR (${belowN} messages):`);
  for (const [k, v] of Object.entries(belowFloorEnds)) {
    push(`    ${k}: ${v} (${pct(v, belowN)})`);
  }

  // ── 3. Training signal hierarchy ──
  push("", "## 3. Training signal hierarchy (relative stopping vs continuation cues)");

  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");
  const { buildTerminalLengthOverrideBlock } = await import("../src/lib/responseLength");
  const { buildTurnHandoffAndPacingBlock } = await import("../src/lib/turnHandoffAndPacing");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");
  const { rawRecentTurnsToHistory, messagesToTurns: msgToTurns, resolveRawRecentTurnPool } = await import(
    "../src/lib/hybridMemory"
  );
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { sanitizePrimaryModelHistoryMessages } = await import("../src/lib/flashOwnedOutputFirewall");

  const chatId = 30;
  const chatRow = db
    .prepare(
      `SELECT c.*, ch.name, ch.gender, ch.system_prompt, ch.world, ch.example_dialog,
              ch.setting_chunks, ch.setting_chunks_en, ch.prompt_translation_hash,
              ch.speech_profile, ch.nsfw, ch.genres, ch.status_widget_json,
              ch.status_widget_allow_user_override
       FROM chats c JOIN characters ch ON ch.id = c.character_id WHERE c.id = ?`
    )
    .get(chatId) as Record<string, unknown>;

  const mem = db.prepare("SELECT summarized_turn_count, recent_summary FROM chat_memories WHERE chat_id=?").get(chatId) as
    | { summarized_turn_count: number; recent_summary: string }
    | undefined;

  const allRows = db
    .prepare("SELECT role, content, model, id FROM messages WHERE chat_id = ? ORDER BY id")
    .all(chatId);
  const turns = msgToTurns(
    allRows.map((r: { role: string; content: string; model: string }) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      model: r.model,
    }))
  );
  const summarized = mem?.summarized_turn_count ?? 0;
  const completedTurns = turns.length;
  const rawWindow = resolveRawRecentTurnWindowForHistory(
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    "openrouter",
    completedTurns
  );
  const historyRaw = rawRecentTurnsToHistory(turns, summarized, rawWindow);
  const historySanitized = sanitizePrimaryModelHistoryMessages(
    historyRaw.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    {}
  );

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

  const lastUser = allRows.filter((r: { role: string }) => r.role === "user").at(-1)?.content ?? "";

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
    completedTurns,
    longTermMemory: mem?.recent_summary ?? "",
    statusWidgetActive: false,
    mainModelOwnsRelationshipExtract: false,
  });

  const system = built.systemPrompt;
  const terminalBlock = buildTerminalLengthOverrideBlock();
  const handoffBlock = buildTurnHandoffAndPacingBlock();

  const assistantHistoryChars = historySanitized
    .filter((m) => m.role === "assistant")
    .reduce((s, m) => s + m.content.length, 0);
  const userHistoryChars = historySanitized
    .filter((m) => m.role === "user")
    .reduce((s, m) => s + m.content.length, 0);

  const characterText = chunks.map((c) => c.content).join("\n\n");
  const exampleDialog = String(chatRow.example_dialog ?? "");
  const summaryText = mem?.recent_summary ?? "";

  const sources = [
    {
      name: "assistant_history (sanitized pool)",
      chars: assistantHistoryChars,
      tokens: estimateTokens(
        historySanitized.filter((m) => m.role === "assistant").map((m) => m.content).join("\n")
      ),
      text: historySanitized.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n---\n\n"),
    },
    {
      name: "rolling_summary (LTM lorebook)",
      chars: summaryText.length,
      tokens: estimateTokens(summaryText),
      text: summaryText,
    },
    {
      name: "terminal_length_block",
      chars: terminalBlock.length,
      tokens: estimateTokens(terminalBlock),
      text: terminalBlock,
    },
    {
      name: "handoff_block",
      chars: handoffBlock.length,
      tokens: estimateTokens(handoffBlock),
      text: handoffBlock,
    },
    {
      name: "character_chunks (all)",
      chars: characterText.length,
      tokens: estimateTokens(characterText),
      text: characterText,
    },
    {
      name: "example_dialog only",
      chars: exampleDialog.length,
      tokens: estimateTokens(exampleDialog),
      text: exampleDialog,
    },
  ];

  const stopPermissive = [
    /Handoff is permitted/gi,
    /PERMITTED FINAL CUT/gi,
    /natural early stop/gi,
    /natural scene completion/gi,
  ];
  const stopProhibitive = [
    /FORBIDDEN EARLY STOP/gi,
    /not a complete scene/gi,
    /MINIMUM_FLOOR/gi,
    /Do not stop at the first valid handoff/gi,
    /Below MINIMUM_FLOOR/gi,
    /조기 종료/gi,
  ];
  const continuationCues = [
    /SCENE CONTINUATION/gi,
    /continue through multiple narrative beats/gi,
    /scene segment rather than a short exchange/gi,
    /Do not stop because/gi,
  ];

  push("\n  Source size (chat #30, DeepSeek path, widget OFF for isolate):");
  let totalTok = 0;
  for (const s of sources) {
    totalTok += s.tokens;
    push(`    ${s.name}: ${s.chars} chars · ~${s.tokens} tok`);
  }
  push(`    full system prompt: ${system.length} chars · ~${estimateTokens(system)} tok`);
  push(`    user history in messages: ${userHistoryChars} chars`);

  push("\n  Cue phrase counts by source:");
  for (const s of sources) {
    const perm = countPhrases(s.text, stopPermissive);
    const prohib = countPhrases(s.text, stopProhibitive);
    const cont = countPhrases(s.text, continuationCues);
    push(
      `    ${s.name}: permissive_stop=${perm} · prohibitive_early_stop=${prohib} · continuation=${cont}`
    );
  }
  const sysPerm = countPhrases(system, stopPermissive);
  const sysProhib = countPhrases(system, stopProhibitive);
  const sysCont = countPhrases(system, continuationCues);
  push(`    full_system: permissive=${sysPerm} · prohibitive=${sysProhib} · continuation=${sysCont}`);

  // Empirical single-beat exemplars in history
  const histAssistants = historySanitized.filter((m) => m.role === "assistant");
  let histSingle = 0;
  for (const m of histAssistants) {
    if (classifyStructure(m.content) === "single-beat") histSingle++;
  }
  push(
    `  Empirical single-beat exemplars IN current history: ${histSingle}/${histAssistants.length} (${pct(histSingle, histAssistants.length)})`
  );

  // Stop-after distribution in history
  const stopDist: Record<string, number> = {};
  for (const m of histAssistants) {
    const beats = segmentBeats(m.content);
    const sa =
      beats.length > 0 ? beatKindToStopAfter(beats[beats.length - 1].kind) : "A_initiation";
    stopDist[sa] = (stopDist[sa] ?? 0) + 1;
  }
  push(`  History stop-after distribution: ${JSON.stringify(stopDist)}`);

  // Weighted "exemplar exposure" — recency-weighted assistant chars
  let weightedChars = 0;
  const assistantsOnly = histAssistants.map((m) => m.content);
  for (let i = 0; i < assistantsOnly.length; i++) {
    const weight = 1 + i * 0.25; // later turns heavier
    weightedChars += assistantsOnly[i].length * weight;
  }

  const signalScores = [
    {
      name: "assistant_history (recency-weighted chars)",
      score: weightedChars,
    },
    { name: "rolling_summary", score: summaryText.length },
    { name: "terminal_length_block", score: terminalBlock.length * 2 },
    { name: "handoff_block (in terminal)", score: handoffBlock.length },
    { name: "character_chunks", score: characterText.length * 0.3 },
    { name: "example_dialog", score: exampleDialog.length * 0.5 },
  ].sort((a, b) => b.score - a.score);

  push("\n  Estimated relative stopping-signal exposure (heuristic weights):");
  for (const s of signalScores) {
    push(`    ${s.name}: ${Math.round(s.score)}`);
  }
  push(
    `  → Top exemplar source: ${signalScores[0].name} (history prose duplicates complete-exchange shape)`
  );

  // Classify example_dialog turns
  if (exampleDialog.trim()) {
    const exStruct = classifyStructure(exampleDialog);
    push(`\n  example_dialog structure class: ${exStruct} (${exampleDialog.length} chars)`);
  }

  // ── 4. Synthetic replay ──
  push("", "## 4. Synthetic replay — history exemplar isolation (chat #30)");

  const longExemplars = db
    .prepare(
      `SELECT m.id, m.content, m.chat_id FROM messages m
       WHERE m.role='assistant' AND m.model!='greeting' AND length(m.content)>3000
       ORDER BY length(m.content) DESC LIMIT 20`
    )
    .all() as Array<{ id: number; content: string; chat_id: number }>;

  push(`  Long exemplars available (>3000 raw chars): ${longExemplars.length}`);
  if (longExemplars.length > 0) {
    push(`    top: msg#${longExemplars[0].id} ${displayProse(longExemplars[0].content).length} display chars`);
  }

  const builtHistory = built.history.slice(0, -1); // exclude current user
  const longHistory = builtHistory.map((m) => {
    if (m.role !== "assistant") return m;
    const idx = builtHistory.filter((x) => x.role === "assistant").indexOf(m);
    const exemplar = longExemplars[idx % longExemplars.length];
    return { role: m.role as "assistant", content: displayProse(exemplar.content) };
  });

  const shortAssistAvg =
    builtHistory.filter((m) => m.role === "assistant").reduce((s, m) => s + m.content.length, 0) /
    (builtHistory.filter((m) => m.role === "assistant").length || 1);
  const longAssistAvg =
    longHistory.filter((m) => m.role === "assistant").reduce((s, m) => s + m.content.length, 0) /
    (longHistory.filter((m) => m.role === "assistant").length || 1);

  push(`  A short history: ${builtHistory.length} msgs · assistant avg ${Math.round(shortAssistAvg)} chars`);
  push(`  B long history: ${longHistory.length} msgs · assistant avg ${Math.round(longAssistAvg)} chars`);
  push(`  Same system prompt + last user (${lastUser.slice(0, 60)}…)`);

  if (skipApi) {
    push("\n  [--skip-api] API replay skipped");
  } else if (!process.env.OPENROUTER_API_KEY?.trim()) {
    push("\n  OPENROUTER_API_KEY missing — API replay skipped");
  } else {
    const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
    const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

    const modelId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
    const targetChars = Number(chatRow.target_response_chars ?? 3300);

    push("\n  Calling API (2 runs, no prompt changes)…");

    const runA = await callOpenRouterAdult(
      system,
      builtHistory,
      modelId,
      targetChars,
      { charName: String(chatRow.name), systemSplit: built.openRouterSystemSplit },
      { requestKind: "stopping-signal-replay-short-hist" }
    );
    const runB = await callOpenRouterAdult(
      system,
      longHistory,
      modelId,
      targetChars,
      { charName: String(chatRow.name), systemSplit: built.openRouterSystemSplit },
      { requestKind: "stopping-signal-replay-long-hist" }
    );

    const charsA = visibleAssistantDisplayCharCount(runA.text);
    const charsB = visibleAssistantDisplayCharCount(runB.text);
    push(`\n  REPLAY RESULTS (${modelId.split("/").pop()}):`);
    push(`    A original short history: ${charsA} display chars · ${runA.usage.outputTokens} output tokens`);
    push(`    B long exemplar history:  ${charsB} display chars · ${runB.usage.outputTokens} output tokens`);
    push(`    Δ chars: ${charsB - charsA} (${charsA > 0 ? ((charsB / charsA - 1) * 100).toFixed(1) : "n/a"}%)`);
    push(
      `    → ${charsB > charsA + 500 ? "History exemplars STRONGLY shift length" : charsB > charsA ? "History exemplars modestly shift length" : "History exemplars did NOT increase length"}`
    );

    fs.writeFileSync(
      path.join("output", "stopping-signal-replay-A.txt"),
      runA.text,
      "utf8"
    );
    fs.writeFileSync(
      path.join("output", "stopping-signal-replay-B.txt"),
      runB.text,
      "utf8"
    );
  }

  push("", "## 5. Conclusion — strongest learning source for one-exchange stop");
  push(
    `  Raw pool is ${pct(poolStruct.single, poolN)} single-beat · below-FLOOR outputs ${pct(belowFloorEnds.dialogue_complete, belowN)} dialogue-end · ${pct(belowFloorEnds.action_complete, belowN)} action-end`
  );
  push(
    `  Explicit rules: prohibitive cues in system (${sysProhib}) >> permissive (${sysPerm}); rules say don't stop early`
  );
  push(
    `  Empirical history: ${pct(histSingle, histAssistants.length)} single-beat exemplars in live history — models see completed micro-exchange shape repeatedly`
  );
  push(
    `  Rolling summary removes long prose exemplars; pool avg structure is single-beat dominant`
  );

  const outPath = path.join("output", "investigate-stopping-signal.txt");
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
