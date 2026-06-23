/**
 * Audit output compression causes — A/B/C controlled prompt variants (test-only patches).
 *
 * A = current rules
 * B = relax handoff / observer-ending / agency-yield pressure
 * C = relax relationship pacing (EARLY t, early_scene, intimacy caps)
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-output-compression-causes.ts
 *   npx.cmd tsx scripts/audit-output-compression-causes.ts --model=google/gemini-2.5-pro
 *   npx.cmd tsx scripts/audit-output-compression-causes.ts --models=google/gemini-2.5-pro,qwen/qwen3.7-max
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import {
  applyDenseNarrationPlacementP1,
  applyDenseNarrationPlacementP2,
} from "../src/lib/advancedProseNsfwGuidelines";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const VARIANTS = ["A", "B", "C", "P1", "P2"] as const;
type Variant = (typeof VARIANTS)[number];

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const BANNED_ENDING_VERB_PATTERN =
  /(?:기다리며|기다렸다|바라보았다|확인했다|지켜보았다)\s*\.?\s*$/;

const RELAXED_TURN_HANDOFF = `<TURN_HANDOFF_AND_PACING>
[TEST VARIANT B — handoff restrictions relaxed]
- Continue the in-scene beat through multiple [A] actions, dialogue exchanges, and environmental changes before ending.
- Do NOT treat 1–2 [A] actions as "moment complete" — expand scene progression first.
- Return agency to [B] eventually, but not immediately after a single micro-reaction.
- Observer-style closings (기다리며/바라보았다/지켜보았다) are discouraged, not blocking.
- Still forbid epilogue, time-skip, or narrating that the scene is over.
</TURN_HANDOFF_AND_PACING>`;

const B_AGENCY_SUPPLEMENT = `[TEST VARIANT B — SCENE PROGRESSION AUTHORITY]
Expand via [A] actions, internal monologue, and environment before yielding to [B].
Multiple in-scene beats are expected; handoff after one gesture is too early.`;

function replaceTurnHandoffRelaxed(text: string): string {
  // Match the real section block only — not inline references like "obey <TURN_HANDOFF_AND_PACING>."
  const open = "<TURN_HANDOFF_AND_PACING>\n";
  const close = "</TURN_HANDOFF_AND_PACING>";
  const start = text.indexOf(open);
  if (start < 0) return text;
  const end = text.indexOf(close, start);
  if (end < 0) return text;
  return text.slice(0, start) + RELAXED_TURN_HANDOFF + text.slice(end + close.length);
}

function applyVariant(system: string, variant: Variant): string {
  if (variant === "P1") return applyDenseNarrationPlacementP1(system);
  if (variant === "P2") return applyDenseNarrationPlacementP2(system);
  if (variant === "A") return system;

  let s = system;

  if (variant === "B") {
    s = replaceTurnHandoffRelaxed(s);
    s = s.replace(
      /Turn-end pacing: obey <TURN_HANDOFF_AND_PACING> only\./g,
      "Turn-end: expand [A]-led scene beats first; relaxed handoff policy applies for this test."
    );
    s = s.replace(
      /\[WHEN YOU MUST NOT END EARLY\][\s\S]*?\[FORBIDDEN AT END\]/,
      "[WHEN YOU MUST NOT END EARLY — RELAXED FOR TEST]\n- Prefer multi-beat expansion over immediate handoff.\n\n[FORBIDDEN AT END]"
    );
    s = `${s}\n\n${B_AGENCY_SUPPLEMENT}`;
  }

  if (variant === "C") {
    s = s.replace(/\[EARLY t=\d+\][^\n]*/g, "");
    s = s.replace(/\[early_scene t=\d+\][^\n]*/g, "");
    s = s.replace(/\[EARLY CAP t=\d+\/\d+\][\s\S]*?(?=\n\n\[|\n\n<|$)/g, "");
    s = s.replace(/\[SLOW BURN EARLY\][\s\S]*?(?=\n\n\[|\n\n<|$)/g, "");
    s = s.replace(/\[FIRST-TURN REALISM\][\s\S]*?(?=\n\n\[|\n\n<|$)/g, "");
    s = s.replace(/\[FORBIDDEN EMOTIONAL LEAPS\][\s\S]*?(?=\n\n\[|\n\n<|$)/g, "");
    s = s.replace(/strangers\. NO invented shared past\/intimacy\./gi, "early acquaintance — lore-grounded only.");
    s = s.replace(
      /Relationship stays at early stage[^\n]*/g,
      "Relationship pacing unrestricted for test — still obey lore/history."
    );
    s = `${s}\n\n[TEST VARIANT C — RELATIONSHIP PACING RELAXED]
No artificial early-turn intimacy caps. Emotional and physical escalation may follow scene logic and user input.`;
  }

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

const ACTION_VERB_PATTERN =
  /(?:잡|뻗|돌|움직|내밀|당기|밀|끌|걸|열|닫|일어나|앉|서|향하|다가|물러|옮기|만지|쓰다듬|끌어안|내려놓|확|들|놓|고개|손|손가락|무릎|다리|몸|어깨|시선|응시|바라|품|안|키스|입|혀|벗|벗기|풀|늘|접|굽|펴|쓸|문|닿|스치|밀착|감싸|안아|끌어|당겨|밀어|쓰다|내려|올려|기울|숙|일으|눕|눌|쥐|풀어|벌|맞|교차|감|쓸어|문지|삼|삼키|핥|빨|쏟|흘|번|떨|경련|떨리|떨림|떨렸|떨었다)(?:았|었|였|는|다|며|고|아|어|였다|했다|인다|ㄴ다)?/;

export type OutputMetrics = {
  output_chars: number;
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
  paragraphs_total: number;
  ends_with_observer_verb: boolean;
  ending_type: string;
  last_line_preview: string;
};

export function analyzeOutput(text: string): OutputMetrics {
  const trimmed = text.trim();
  const dialogue_count = (trimmed.match(/"[^"]*"/g) ?? []).length;
  const narrationOnly = trimmed.replace(/"[^"]*"/g, " ");
  const paragraphs = trimmed.split(/\n\n+/).filter((p) => p.trim());
  const narration_paragraph_count = paragraphs.filter((p) => {
    const withoutQuotes = p.replace(/"[^"]*"/g, "").trim();
    return withoutQuotes.length > 8;
  }).length;

  const sentences = narrationOnly
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
  const action_count = sentences.filter((s) => ACTION_VERB_PATTERN.test(s)).length;

  const lastPara = paragraphs[paragraphs.length - 1] ?? trimmed;
  const ends_with_observer_verb = BANNED_ENDING_VERB_PATTERN.test(trimmed);

  let ending_type = "narration";
  if (ends_with_observer_verb) ending_type = "observer_close";
  else if (/"[^"]*"\s*$/.test(lastPara.trim())) ending_type = "dialogue";
  else if (/(?:멈췄|멈추|일시|순간|잠시|말을|입을|시선|눈빛|손끝|손가락|숨|호흡)/.test(lastPara))
    ending_type = "handoff_pause";
  else if (ACTION_VERB_PATTERN.test(lastPara)) ending_type = "action_midbeat";

  const lastLine = trimmed.split(/\n/).filter(Boolean).pop() ?? "";

  return {
    output_chars: trimmed.length,
    action_count,
    dialogue_count,
    narration_paragraph_count,
    paragraphs_total: paragraphs.length,
    ends_with_observer_verb,
    ending_type,
    last_line_preview: lastLine.slice(0, 120),
  };
}

function probePromptFlags(system: string) {
  return {
    turn_handoff_active: system.includes("<TURN_HANDOFF_AND_PACING>"),
    early_turn_hint_active: /\[EARLY t=\d+\]/.test(system),
    early_scene_active: /\[early_scene t=\d+\]/.test(system),
    nsfw_scene_variety_active: system.includes("[SCENE VARIETY]"),
    variant_b_overlay: system.includes("[TEST VARIANT B"),
    variant_c_overlay: system.includes("[TEST VARIANT C"),
  };
}

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
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
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

type TurnLog = {
  condition: Variant;
  turn_number: number;
  model_id: string;
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
  finish_reason: string | null;
  output_chars: number;
  paragraphs_total: number;
  ends_with_observer_verb: boolean;
  ending_type: string;
  last_line_preview: string;
  prompt_flags: ReturnType<typeof probePromptFlags>;
  target_response_chars: number;
  timestamp: string;
};

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function summarize(rows: TurnLog[], condition: Variant, model: string) {
  const subset = rows.filter((r) => r.condition === condition && r.model_id === model);
  return {
    condition,
    model_id: model,
    n: subset.length,
    avg_output_chars: avg(subset.map((r) => r.output_chars)),
    avg_action_count: avg(subset.map((r) => r.action_count)),
    avg_dialogue_count: avg(subset.map((r) => r.dialogue_count)),
    avg_narration_paragraph_count: avg(subset.map((r) => r.narration_paragraph_count)),
    observer_ending_rate: subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1),
    ending_types: Object.fromEntries(
      [...new Set(subset.map((r) => r.ending_type))].map((t) => [
        t,
        subset.filter((r) => r.ending_type === t).length,
      ])
    ),
    finish_reasons: Object.fromEntries(
      [...new Set(subset.map((r) => r.finish_reason ?? "null"))].map((t) => [
        t,
        subset.filter((r) => (r.finish_reason ?? "null") === t).length,
      ])
    ),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const variantsArg = args.find((a) => a.startsWith("--variants="));
  const variants: Variant[] = variantsArg
    ? variantsArg
        .slice("--variants=".length)
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter((v): v is Variant => VARIANTS.includes(v as Variant))
    : [...VARIANTS];
  const modelsArg = args.find((a) => a.startsWith("--models="));
  const modelArg = args.find((a) => a.startsWith("--model="));
  const models = modelsArg
    ? modelsArg.slice("--models=".length).split(",").map((m) => m.trim()).filter(Boolean)
    : [
        modelArg?.slice("--model=".length) ??
          process.env.OPENROUTER_MODEL?.trim() ??
          "google/gemini-2.5-pro",
      ];

  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `compression-audit-${stamp}.jsonl`);

  const rows: TurnLog[] = [];

  console.log("=== Output compression audit (A/B/C) ===");
  console.log("Models:", models.join(", "));
  console.log("Turns:", TURNS.join(", "));
  console.log("Log:", logPath);

  console.log("Variants:", variants.join(", "));

  for (const model_id of models) {
    for (const condition of variants) {
      for (const turn_number of TURNS) {
        const f = await fixture(turn_number);
        const built = buildContext({
          ...f,
          userNickname: f.personaDisplayName,
          assetTags: undefined,
          modelId: model_id,
          provider: "openrouter",
        });
        const system = applyVariant(built.systemPrompt, condition);
        const flags = probePromptFlags(system);

        console.log(`\n→ ${condition} t=${turn_number} ${model_id} …`);
        const result = await callOpenRouterAdult(
          system,
          [{ role: "user", content: f.currentUserMessage }],
          model_id,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `compression-audit-${condition}` }
        );

        const metrics = analyzeOutput(result.text);
        const displayChars = visibleAssistantDisplayCharCount(result.text);
        const finish_reason = result.usage.finishReason ?? null;

        const row: TurnLog = {
          condition,
          turn_number,
          model_id,
          action_count: metrics.action_count,
          dialogue_count: metrics.dialogue_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          finish_reason,
          output_chars: displayChars,
          paragraphs_total: metrics.paragraphs_total,
          ends_with_observer_verb: metrics.ends_with_observer_verb,
          ending_type: metrics.ending_type,
          last_line_preview: metrics.last_line_preview,
          prompt_flags: flags,
          target_response_chars: f.targetResponseChars,
          timestamp: new Date().toISOString(),
        };
        rows.push(row);
        fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");

        console.log({
          condition,
          turn_number,
          model_id,
          ...metrics,
          output_chars: displayChars,
          finish_reason,
          prompt_flags: flags,
        });
      }
    }

    console.log(`\n--- Summary: ${model_id} ---`);
    for (const condition of variants) {
      console.log(summarize(rows, condition, model_id));
    }
  }

  console.log("\n=== Cross-condition delta (B−A, C−A, P1−P2) per model ===");
  for (const model_id of models) {
    if (!variants.includes("A")) continue;
    const a = summarize(rows, "A", model_id);
    const b = variants.includes("B") ? summarize(rows, "B", model_id) : null;
    const c = variants.includes("C") ? summarize(rows, "C", model_id) : null;
    const p1 = variants.includes("P1") ? summarize(rows, "P1", model_id) : null;
    const p2 = variants.includes("P2") ? summarize(rows, "P2", model_id) : null;
    console.log({
      model_id,
      ...(b
        ? {
            "B−A_chars": b.avg_output_chars - a.avg_output_chars,
            "B−A_actions": b.avg_action_count - a.avg_action_count,
            "B−A_dialogue": b.avg_dialogue_count - a.avg_dialogue_count,
            "B−A_narr_paras": b.avg_narration_paragraph_count - a.avg_narration_paragraph_count,
          }
        : {}),
      ...(c
        ? {
            "C−A_chars": c.avg_output_chars - a.avg_output_chars,
            "C−A_actions": c.avg_action_count - a.avg_action_count,
            "C−A_dialogue": c.avg_dialogue_count - a.avg_dialogue_count,
            "C−A_narr_paras": c.avg_narration_paragraph_count - a.avg_narration_paragraph_count,
          }
        : {}),
      ...(p1 && p2
        ? {
            "P1−P2_chars": p1.avg_output_chars - p2.avg_output_chars,
            "P1−P2_actions": p1.avg_action_count - p2.avg_action_count,
            "P1−P2_dialogue": p1.avg_dialogue_count - p2.avg_dialogue_count,
            "P1−P2_narr_paras":
              p1.avg_narration_paragraph_count - p2.avg_narration_paragraph_count,
          }
        : {}),
    });
  }

  if (variants.includes("P1") && variants.includes("P2")) {
    console.log("\n=== Dense narration placement isolation (P1 prose vs P2 dialogue) ===");
    for (const model_id of models) {
      const p1 = summarize(rows, "P1", model_id);
      const p2 = summarize(rows, "P2", model_id);
      console.log({
        model_id,
        P1: {
          chars: p1.avg_output_chars,
          actions: p1.avg_action_count,
          dialogue: p1.avg_dialogue_count,
          narr_paras: p1.avg_narration_paragraph_count,
        },
        P2: {
          chars: p2.avg_output_chars,
          actions: p2.avg_action_count,
          dialogue: p2.avg_dialogue_count,
          narr_paras: p2.avg_narration_paragraph_count,
        },
        "P1−P2_chars": p1.avg_output_chars - p2.avg_output_chars,
      });
    }
  }

  console.log(`\nFull per-turn log: ${logPath}`);
}

const isCompressionAuditMain =
  typeof process.argv[1] === "string" &&
  process.argv[1].replace(/\\/g, "/").includes("audit-output-compression-causes");

if (isCompressionAuditMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
