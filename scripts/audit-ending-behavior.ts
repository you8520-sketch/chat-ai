/**
 * Ending behavior audit — measurement only (no prompt patches).
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-ending-behavior.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";

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

export type StopTrigger =
  | "A_dialogue_completion"
  | "B_user_reaction_completion"
  | "C_explicit_handoff"
  | "D_scene_completion_heuristic"
  | "E_observer_description_close"
  | "F_mid_action_stop";

const HANDOFF_EXPLICIT =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|다음 (?:말|행동|반응)|멈추고.*기다|멈춘 채.*기다|렌의 반응|유저의|\[B\].*(?:반응|대답|선택))/;

const OBSERVER_CLOSE =
  /(?:바라보|응시|지켜보|확인했|응시했|시선이.*(?:고정|머물|닿)|공기가|어둠이|정적|침묵|분위기|분위|고요|달빛|밤이)/;

const SCENE_COMPLETE_TONE =
  /(?:자연스럽게|이제는|그렇게면|말을 마치|대화는 끝|순간은|한순간|그 순간이)/;

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function finalParagraph(text: string): string {
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());
  return paragraphs[paragraphs.length - 1] ?? text.trim();
}

function classifyStopTrigger(
  text: string,
  ending_type: string,
  ends_with_observer_verb: boolean
): StopTrigger {
  const trimmed = text.trim();
  const tail = trimmed.slice(-600);
  const lastPara = finalParagraph(trimmed);
  const endsOnQuote = /"[^"]*"\s*$/.test(lastPara.trim());

  if (ending_type === "action_midbeat" || (ACTION_MID.test(lastPara) && !HANDOFF_EXPLICIT.test(tail)))
    return "F_mid_action_stop";

  if (endsOnQuote || ending_type === "dialogue") return "A_dialogue_completion";

  if (ends_with_observer_verb || ending_type === "observer_close" || OBSERVER_CLOSE.test(lastPara))
    return "E_observer_description_close";

  if (HANDOFF_EXPLICIT.test(tail)) return "C_explicit_handoff";

  if (ending_type === "handoff_pause") return "D_scene_completion_heuristic";

  // [A] reacted to user's hand/fear request without yielding — short close after micro-reaction
  if (
    /(?:손|잡|무서|밤|천천히)/.test(trimmed.slice(0, 400)) &&
    !HANDOFF_EXPLICIT.test(tail) &&
    trimmed.length < 900
  )
    return "B_user_reaction_completion";

  if (SCENE_COMPLETE_TONE.test(tail)) return "D_scene_completion_heuristic";

  return "D_scene_completion_heuristic";
}

const ACTION_MID =
  /(?:멈추|멈칫|일시|순간|닿을 듯|말 듯|스치|움직|뻗|잡|쓸|향하)/;

function estimateMissedContinuation(
  text: string,
  response_chars: number,
  trigger: StopTrigger,
  metrics: ReturnType<typeof analyzeOutput>
): {
  earliest_continuation_point: string;
  estimated_additional_beats: number;
  rationale: string;
} {
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());
  const narrBlocks = metrics.narration_paragraph_count;
  const dialogues = metrics.dialogue_count;

  let earliest = "after_first_in-scene_beat";
  if (paragraphs.length >= 2) {
    const mid = Math.max(1, Math.floor(paragraphs.length / 2));
    earliest = `after_paragraph_${mid}_of_${paragraphs.length}`;
  }
  if (dialogues >= 1 && narrBlocks <= 2) {
    earliest = "after_first_dialogue_exchange_before_follow-through";
  }
  if (trigger === "C_explicit_handoff" || trigger === "D_scene_completion_heuristic") {
    earliest = "before_yield_pause — additional [A] action/env/dialogue beats still plausible";
  }

  const targetBeats =
    trigger === "A_dialogue_completion" ? dialogues + 2 : trigger === "F_mid_action_stop" ? 2 : 4;

  const currentBeats = Math.max(paragraphs.length, dialogues + narrBlocks);
  let additional = Math.max(0, targetBeats - currentBeats);
  if (response_chars < 800) additional = Math.max(additional, 3);
  if (response_chars < 1200 && trigger !== "A_dialogue_completion") additional = Math.max(additional, 2);
  if (trigger === "F_mid_action_stop") additional = Math.max(additional, 1);

  const rationale = `paragraphs=${paragraphs.length} dialogue=${dialogues} narr_paras=${narrBlocks} chars=${response_chars}`;

  return {
    earliest_continuation_point: earliest,
    estimated_additional_beats: additional,
    rationale,
  };
}

type EndingLog = {
  model_id: string;
  turn_number: number;
  finish_reason: string | null;
  ending_type: string;
  stop_trigger: StopTrigger;
  response_char_count: number;
  last_5_sentences: string[];
  final_paragraph: string;
  missed_continuation_points: {
    earliest_continuation_point: string;
    estimated_additional_beats: number;
    rationale: string;
  };
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
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

function buildReport(rows: EndingLog[]): string {
  const lines: string[] = [
    "=".repeat(72),
    "ENDING BEHAVIOR AUDIT REPORT",
    `generated: ${new Date().toISOString()}`,
    `samples: ${rows.length}`,
    "=".repeat(72),
    "",
  ];

  for (const model of MODELS) {
    const subset = rows.filter((r) => r.model_id === model);
    lines.push(`## ${model} (n=${subset.length})`);
    lines.push("");

    const dist: Record<string, number> = {};
    for (const r of subset) {
      dist[r.stop_trigger] = (dist[r.stop_trigger] ?? 0) + 1;
    }
    lines.push("### 1. Stop trigger distribution");
    for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${k}: ${v} (${Math.round((v / subset.length) * 100)}%)`);
    }
    lines.push("");

    lines.push("### 2. Average response length by stop trigger");
    for (const trigger of Object.keys(dist)) {
      const g = subset.filter((r) => r.stop_trigger === trigger);
      const avg = g.reduce((s, r) => s + r.response_char_count, 0) / g.length;
      lines.push(`  ${trigger}: ${Math.round(avg)} chars (n=${g.length})`);
    }
    lines.push("");

    lines.push("### 3. finish_reason × stop_trigger");
    const pairs = new Map<string, number>();
    for (const r of subset) {
      const key = `${r.finish_reason ?? "null"} + ${r.stop_trigger}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    for (const [k, v] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push("");

    const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0];
    const examples = subset.filter((r) => r.stop_trigger === dominant).slice(0, 2);
    lines.push(`### 4. Most common pattern: ${dominant}`);
    for (const ex of examples) {
      lines.push(`  --- t=${ex.turn_number} | ${ex.response_char_count} chars | ${ex.ending_type}`);
      lines.push(`  final: ${ex.final_paragraph.slice(0, 200).replace(/\n/g, " ")}…`);
      lines.push(`  last sentences: ${ex.last_5_sentences.slice(-2).join(" | ")}`);
      lines.push(
        `  missed: ${ex.missed_continuation_points.estimated_additional_beats} beats @ ${ex.missed_continuation_points.earliest_continuation_point}`
      );
    }
    lines.push("");
  }

  lines.push("## Global stop trigger distribution");
  const global: Record<string, number> = {};
  for (const r of rows) global[r.stop_trigger] = (global[r.stop_trigger] ?? 0) + 1;
  for (const [k, v] of Object.entries(global).sort((a, b) => b[1] - a[1])) {
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
  const logPath = path.join(outDir, `ending-behavior-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `ending-behavior-audit-${stamp}.txt`);

  const rows: EndingLog[] = [];

  console.log("=== Ending behavior audit ===");
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
        { chargeTurnBudget: false, requestKind: "ending-behavior-audit" }
      );

      const text = result.text.trim();
      const metrics = analyzeOutput(text);
      const sentences = splitSentences(text);
      const last5 = sentences.slice(-5);
      const final_para = finalParagraph(text);
      const stop_trigger = classifyStopTrigger(
        text,
        metrics.ending_type,
        metrics.ends_with_observer_verb
      );
      const missed = estimateMissedContinuation(
        text,
        visibleAssistantDisplayCharCount(text),
        stop_trigger,
        metrics
      );

      const row: EndingLog = {
        model_id,
        turn_number,
        finish_reason: result.usage.finishReason ?? null,
        ending_type: metrics.ending_type,
        stop_trigger,
        response_char_count: visibleAssistantDisplayCharCount(text),
        last_5_sentences: last5,
        final_paragraph: final_para,
        missed_continuation_points: missed,
        action_count: metrics.action_count,
        dialogue_count: metrics.dialogue_count,
        narration_paragraph_count: metrics.narration_paragraph_count,
        timestamp: new Date().toISOString(),
      };
      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log({
        model_id,
        turn_number,
        stop_trigger,
        ending_type: metrics.ending_type,
        finish_reason: row.finish_reason,
        response_char_count: row.response_char_count,
        estimated_additional_beats: missed.estimated_additional_beats,
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
