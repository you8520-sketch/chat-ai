/**
 * Beat completion audit — measurement only (no prompt patches).
 *
 * Segments each response into narrative beats and classifies where the model stopped
 * in the beat chain (Initiation / Reaction / Follow-through / Consequence / Pause).
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-beat-completion.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

type BeatKind = "Initiation" | "Reaction" | "Follow-through" | "Consequence" | "Pause";

type StopAfter =
  | "A_initiation"
  | "B_reaction"
  | "C_follow_through"
  | "D_consequence"
  | "E_true_pause";

type NarrativeBeat = {
  index: number;
  text: string;
  kind: BeatKind;
  source: "dialogue" | "narration";
};

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
  prior: NarrativeBeat[],
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

  if (prior.length === 0) {
    return REACTION_PATTERN.test(t) ? "Reaction" : "Initiation";
  }

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

function segmentBeats(text: string): NarrativeBeat[] {
  const beats: NarrativeBeat[] = [];
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
          index: beats.length,
          text: part.text,
          kind: classifyBeat(part.text, beats, "dialogue"),
          source: "dialogue",
        });
      } else {
        for (const sent of splitSentences(part.text)) {
          beats.push({
            index: beats.length,
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

function isNaturalStop(stopAfter: StopAfter): boolean {
  return stopAfter === "D_consequence" || stopAfter === "E_true_pause";
}

function estimateRemaining(stopAfter: StopAfter): number {
  switch (stopAfter) {
    case "A_initiation":
      return 4;
    case "B_reaction":
      return 3;
    case "C_follow_through":
      return 2;
    case "D_consequence":
      return 1;
    case "E_true_pause":
      return 0;
  }
}

function analyzeBeatCompletion(text: string) {
  const beats = segmentBeats(text);
  const total_beats = beats.length;

  if (total_beats === 0) {
    return {
      beats: [],
      total_beats: 0,
      completed_beats: 0,
      omitted_beats: 4,
      estimated_remaining_beats: 4,
      final_beat_kind: null as BeatKind | null,
      final_completed_beat_kind: null as BeatKind | null,
      stop_after: "A_initiation" as StopAfter,
      partial_chain_stop: true,
      natural_stop: false,
    };
  }

  const finalBeat = beats[beats.length - 1];
  const stop_after = beatKindToStopAfter(finalBeat.kind);
  const natural_stop = isNaturalStop(stop_after);
  const partial_chain_stop = !natural_stop;

  const completed_beats = natural_stop ? total_beats : Math.max(0, total_beats - 1);
  const estimated_remaining_beats = estimateRemaining(stop_after);
  const omitted_beats = estimated_remaining_beats;

  const final_completed_beat_kind =
    completed_beats > 0 ? beats[completed_beats - 1].kind : null;

  return {
    beats,
    total_beats,
    completed_beats,
    omitted_beats,
    estimated_remaining_beats,
    final_beat_kind: finalBeat.kind,
    final_completed_beat_kind,
    stop_after,
    partial_chain_stop,
    natural_stop,
  };
}

type BeatLog = {
  model_id: string;
  turn_number: number;
  finish_reason: string | null;
  response_char_count: number;
  beats: Array<{ index: number; kind: BeatKind; source: string; text_preview: string }>;
  total_beats: number;
  completed_beats: number;
  omitted_beats: number;
  estimated_remaining_beats: number;
  final_beat_kind: BeatKind | null;
  final_completed_beat_kind: BeatKind | null;
  stop_after: StopAfter;
  partial_chain_stop: boolean;
  natural_stop: boolean;
  timestamp: string;
};

async function fixture(t: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: t,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

function buildReport(rows: BeatLog[]): string {
  const lines: string[] = [
    "=".repeat(72),
    "BEAT COMPLETION AUDIT REPORT",
    `generated: ${new Date().toISOString()}`,
    `samples: ${rows.length}`,
    "=".repeat(72),
    "",
    "Stop-after key: A=Initiation B=Reaction C=Follow-through D=Consequence E=True Pause",
    "partial_chain_stop = stopped before D or E (incomplete narrative arc)",
    "",
  ];

  for (const model of MODELS) {
    const subset = rows.filter((r) => r.model_id === model);
    lines.push(`## ${model} (n=${subset.length})`);
    lines.push("");

    const stopDist: Record<string, number> = {};
    for (const r of subset) stopDist[r.stop_after] = (stopDist[r.stop_after] ?? 0) + 1;

    lines.push("### Stop-after distribution");
    for (const [k, v] of Object.entries(stopDist).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${k}: ${v} (${Math.round((v / subset.length) * 100)}%)`);
    }
    lines.push("");

    const partial = subset.filter((r) => r.partial_chain_stop).length;
    lines.push(`### Partial chain stops: ${partial}/${subset.length} (${Math.round((partial / subset.length) * 100)}%)`);
    lines.push("");

    const avgTotal = subset.reduce((s, r) => s + r.total_beats, 0) / subset.length;
    const avgCompleted = subset.reduce((s, r) => s + r.completed_beats, 0) / subset.length;
    const avgOmitted = subset.reduce((s, r) => s + r.omitted_beats, 0) / subset.length;
    const avgRemaining = subset.reduce((s, r) => s + r.estimated_remaining_beats, 0) / subset.length;

    lines.push("### Beat counts (averages)");
    lines.push(`  total_beats: ${avgTotal.toFixed(1)}`);
    lines.push(`  completed_beats: ${avgCompleted.toFixed(1)}`);
    lines.push(`  omitted_beats: ${avgOmitted.toFixed(1)}`);
    lines.push(`  estimated_remaining_beats: ${avgRemaining.toFixed(1)}`);
    lines.push("");

    const beatKindDist: Record<string, number> = {};
    for (const r of subset) {
      for (const b of r.beats) beatKindDist[b.kind] = (beatKindDist[b.kind] ?? 0) + 1;
    }
    lines.push("### Beat kind distribution (all beats)");
    for (const [k, v] of Object.entries(beatKindDist).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push("");

    const dominant = Object.entries(stopDist).sort((a, b) => b[1] - a[1])[0]?.[0];
    const examples = subset.filter((r) => r.stop_after === dominant).slice(0, 2);
    lines.push(`### Examples — dominant stop: ${dominant}`);
    for (const ex of examples) {
      const chain = ex.beats.map((b) => b.kind).join(" → ");
      lines.push(`  --- t=${ex.turn_number} | ${ex.response_char_count} chars | partial=${ex.partial_chain_stop}`);
      lines.push(`  chain: ${chain}`);
      lines.push(
        `  final_completed=${ex.final_completed_beat_kind ?? "—"} | remaining≈${ex.estimated_remaining_beats}`
      );
      const tail = ex.beats.slice(-3);
      for (const b of tail) {
        lines.push(`    [${b.kind}] ${b.text_preview}`);
      }
    }
    lines.push("");
  }

  lines.push("## Global aggregates");
  const globalPartial = rows.filter((r) => r.partial_chain_stop).length;
  lines.push(
    `partial_chain_stop: ${globalPartial}/${rows.length} (${Math.round((globalPartial / rows.length) * 100)}%)`
  );

  const globalStop: Record<string, number> = {};
  for (const r of rows) globalStop[r.stop_after] = (globalStop[r.stop_after] ?? 0) + 1;
  lines.push("stop_after distribution:");
  for (const [k, v] of Object.entries(globalStop).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v} (${Math.round((v / rows.length) * 100)}%)`);
  }

  return lines.join("\n");
}

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `beat-completion-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `beat-completion-audit-${stamp}.txt`);

  const rows: BeatLog[] = [];

  console.log("=== Beat completion audit ===");
  console.log("Models:", MODELS.join(", "));
  console.log("Log:", logPath);

  for (const model_id of MODELS) {
    for (const turn_number of TURNS) {
      const f = await fixture(turn_number);
      const built = buildContext({
        ...f,
        userNickname: f.personaDisplayName,
        assetTags: undefined,
        modelId: model_id,
        provider: "openrouter",
      });

      console.log(`→ ${model_id} t=${turn_number} …`);
      const result = await callOpenRouterAdult(
        built.systemPrompt,
        [{ role: "user", content: f.currentUserMessage }],
        model_id,
        f.targetResponseChars,
        { charName: f.charName },
        { chargeTurnBudget: false, requestKind: "beat-completion-audit" }
      );

      const text = result.text.trim();
      const analysis = analyzeBeatCompletion(text);

      const row: BeatLog = {
        model_id,
        turn_number,
        finish_reason: result.usage.finishReason ?? null,
        response_char_count: visibleAssistantDisplayCharCount(text),
        beats: analysis.beats.map((b) => ({
          index: b.index,
          kind: b.kind,
          source: b.source,
          text_preview: b.text.slice(0, 100),
        })),
        total_beats: analysis.total_beats,
        completed_beats: analysis.completed_beats,
        omitted_beats: analysis.omitted_beats,
        estimated_remaining_beats: analysis.estimated_remaining_beats,
        final_beat_kind: analysis.final_beat_kind,
        final_completed_beat_kind: analysis.final_completed_beat_kind,
        stop_after: analysis.stop_after,
        partial_chain_stop: analysis.partial_chain_stop,
        natural_stop: analysis.natural_stop,
        timestamp: new Date().toISOString(),
      };

      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log({
        model_id,
        turn_number,
        stop_after: row.stop_after,
        total_beats: row.total_beats,
        completed_beats: row.completed_beats,
        partial_chain_stop: row.partial_chain_stop,
        response_char_count: row.response_char_count,
      });
    }
  }

  const report = buildReport(rows);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
