/**
 * Offline prompt-driver audit — reconstruct production final provider requests
 * for baseline Turn 1/2 without new model calls.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/prompt-driver-audit.ts
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "../src/lib/sceneDirective";
import { loadCharacterChunks } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { resolveCharacterGender } from "../src/lib/characterGender";
import { sanitizeCharacterGenres } from "../src/lib/characterGenres";
import { estimateTokens } from "../src/lib/tokenEstimate";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_USER_TURN_BLOCK,
  resolveDeepSeekShortHistoryLengthExtra,
  resolveDeepSeekShortUserTurnExtra,
} from "../src/lib/deepseekPromptStructure";
import { buildDeepSeekOpeningSceneContextBlock } from "../src/lib/deepseekOpeningSceneContext";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { buildCompactTerminalLayoutRecencyLine } from "../src/lib/webnovelOutputFormat";
import { NARRATIVE_DENSITY_BLOCK } from "../src/lib/sceneExpansionPolicy";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const BASELINE =
  process.env.BASELINE_DIR ||
  path.join(ART, "19-dialogue-resume/post_fix_production_baseline");
const OUT =
  process.env.OUT_DIR || path.join(ART, "23-prompt-driver-audit");

const TURNS = [
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
  "같이갈래?*두리번 거리면서 다가오는 사람들을 보다가 다시 라이크를 쳐다본다*",
];

const SEARCH_TERMS = [
  "새 인물",
  "다른 인물",
  "주변 인물",
  "외부 사건",
  "세계의 움직임",
  "장면 진행",
  "서사 진행",
  "새 변화",
  "개입",
  "방해",
  "호출",
  "직원",
  "등록",
  "검사",
  "보고",
  "업무",
  "임무",
  "위협",
  "환경 반응",
  "주도적으로",
  "멈추지 말고",
  "NPC",
  "세계 반응",
];

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function charLen(s: string) {
  return [...s].length;
}

type Block = {
  block_id: string;
  role: "system" | "user" | "assistant";
  injection_order: number;
  turn_condition: string;
  model_condition: string;
  character_condition: string;
  exact_literal_text: string;
  content_hash: string;
  approx_tokens: number;
  chars: number;
  search_hits: string[];
};

function hitsIn(text: string): string[] {
  return SEARCH_TERMS.filter((t) => text.includes(t));
}

function loadDbCharacter() {
  // Local id 11 = 라이크 (production chat uses id 18; content family matches greeting dump).
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(path.join(process.cwd(), "data/app.db"), { readonly: true });
  const row = db.prepare("SELECT * FROM characters WHERE id=?").get(11) as Record<string, unknown>;
  db.close();
  if (!row) throw new Error("local character id=11 (라이크) missing");
  return row;
}

function loadPersona() {
  const p = JSON.parse(
    fs.readFileSync("/tmp/prompt-driver/persona-61.json", "utf8")
  ) as {
    id: number;
    name: string;
    gender?: string;
    description?: string;
  };
  return p;
}

function rebuild(opts: {
  turn: number;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentUserMessage: string;
  greeting: string;
  character: Record<string, unknown>;
  persona: { id: number; name: string; gender?: string; description?: string };
}) {
  const ch = opts.character;
  const chunks = loadCharacterChunks(ch as never);
  const personaDisplayName = opts.persona.name || "렌";
  const userPersona = formatSelectedPersonaForPrompt(
    personaDisplayName,
    opts.persona.gender || "other",
    opts.persona.description || ""
  );
  const userPersonaGender = resolveCharacterGender(opts.persona.gender || "other");
  const genres = sanitizeCharacterGenres(
    typeof ch.genres === "string" ? JSON.parse(ch.genres as string) : ch.genres
  );

  // History for SceneDirective includes greeting as first assistant (production chat).
  const promptHistory = [
    { role: "assistant" as const, content: opts.greeting },
    ...opts.history,
  ];

  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: promptHistory,
    currentUserMessage: opts.currentUserMessage,
    memoryText: "",
    relationshipMemoryText: "",
    lorebookText: "",
    triggeredEventText: "",
    chatId: 0,
    currentTurn: opts.turn,
    progressionHistory: [],
    contentKind: "character",
    primaryCharacterName: String(ch.name),
  });
  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(directive);

  const shortTermHistory = [
    { role: "assistant" as const, content: opts.greeting },
    ...opts.history,
  ];

  const built = buildContext({
    charName: String(ch.name),
    characterSetting: "",
    chunks,
    userPersona,
    personaDisplayName,
    userNote: "",
    memory: "",
    shortTermHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: false,
    targetResponseChars: 3200,
    completedTurns: opts.turn - 1,
    userPersonaGender,
    provider: "cheaperinference",
    modelId: "deepseek-v4-pro",
    contentKind: "character",
    genres,
    userId: 34,
    chatId: 0,
    systemPrompt: String(ch.system_prompt || ""),
    world: String(ch.world || ""),
    exampleDialog: String(ch.example_dialog || ""),
    sceneDirectiveBlock,
  });

  const system = built.systemPrompt;
  const lastUser = built.history.filter((m) => m.role === "user").pop()?.content ?? "";
  const opening = buildDeepSeekOpeningSceneContextBlock(opts.greeting) || "";
  const shortHist = resolveDeepSeekShortHistoryLengthExtra(shortTermHistory) || "";
  const shortUser = resolveDeepSeekShortUserTurnExtra(opts.currentUserMessage) || "";
  const layout = buildCompactTerminalLayoutRecencyLine();
  const lengthOwner = USER_TAIL_LENGTH_OWNER_SENTENCE;

  const blocks: Block[] = [];
  let order = 0;
  const push = (
    id: string,
    role: Block["role"],
    text: string,
    turnCond: string,
    present: boolean
  ) => {
    if (!present || !text.trim()) return;
    order += 1;
    blocks.push({
      block_id: id,
      role,
      injection_order: order,
      turn_condition: turnCond,
      model_condition: "deepseek-v4-pro / cheaperinference",
      character_condition: "single_primary character (라이크)",
      exact_literal_text: text,
      content_hash: sha(text),
      approx_tokens: estimateTokens(text),
      chars: charLen(text),
      search_hits: hitsIn(text),
    });
  };

  // System: treat full system as COMMON + extract known sub-blocks by marker.
  push("COMMON_RP_SYSTEM", "system", system, "every turn", true);
  push(
    "CHARACTER_CREATOR_DATA",
    "system",
    [
      String(ch.system_prompt || ""),
      String(ch.world || ""),
      String(ch.example_dialog || ""),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "every turn (cached character)",
    true
  );
  push("SCENE_DIRECTIVE", "system", sceneDirectiveBlock, "every turn (dynamic)", true);
  push(
    "PROGRESSION_AXIS",
    "system",
    `전개 방향: ${directive.progressionTypes.join(" + ")}\n정체: ${directive.recentStagnation}\n강도: ${directive.recommendedIntensity}\navoid: ${directive.avoid.join(", ")}`,
    "derived each turn from recent messages + user input",
    true
  );

  // Extract SCENE EXPANSION / NARRATIVE DENSITY if present in system or user
  const combined = `${system}\n${lastUser}`;
  const sceneExpMatch = combined.match(/\[SCENE EXPANSION\][\s\S]*?(?=\n\[|$)/);
  push(
    "SCENE_EXPANSION",
    sceneExpMatch && system.includes("[SCENE EXPANSION]") ? "system" : "user",
    sceneExpMatch?.[0] || "",
    "when terra/length stack injects it",
    Boolean(sceneExpMatch)
  );
  push(
    "NARRATIVE_DENSITY",
    combined.includes("[NARRATIVE DENSITY]") && system.includes("[NARRATIVE DENSITY]")
      ? "system"
      : "user",
    NARRATIVE_DENSITY_BLOCK,
    "length/density stack (if injected)",
    combined.includes("[NARRATIVE DENSITY]")
  );

  push(
    "DEEPSEEK_PRO_OPENING_OR_XML_WRAPPER",
    "user",
    opening,
    "turn 1 (opening context) / when greeting in history",
    Boolean(opening) && opts.turn === 1
  );
  // Opening may also appear via short-history path on early turns — record presence in user turn
  if (lastUser.includes("[OPENING SCENE CONTEXT")) {
    const m = lastUser.match(/\[OPENING SCENE CONTEXT[^\]]*\][\s\S]*?(?=\n\[CURRENT USER INPUT\]|\n\[SHORT|\n레이아웃|$)/);
    if (m && opts.turn !== 1) {
      push(
        "DEEPSEEK_PRO_OPENING_OR_XML_WRAPPER",
        "user",
        m[0],
        "early turns while opening still attached",
        true
      );
    }
  }

  push(
    "DEEPSEEK_PRO_MOMENTUM_PROGRESSION_EXTRA",
    "user",
    // Momentum only when predicate eligible — capture from user turn if present
    (lastUser.match(/\[SCENE MOMENTUM\][\s\S]*?(?=\n\[|$)/)?.[0] ||
      lastUser.match(/\[SCENE STATE[^\]]*\][\s\S]*?(?=\n\[|$)/)?.[0] ||
      "") as string,
    "when thin-history momentum predicate true",
    /\[SCENE MOMENTUM\]|\[SCENE STATE/.test(lastUser)
  );

  push(
    "SHORT_USER_EXPANSION_EXTRA",
    "user",
    shortUser || DEEPSEEK_SHORT_USER_TURN_BLOCK,
    "when user turn ≤ short-user char threshold",
    Boolean(shortUser) || lastUser.includes("[SHORT USER TURN]")
  );
  push(
    "SHORT_HISTORY_EXTRA",
    "user",
    shortHist || DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
    "when recent assistant avg no-ws < threshold",
    Boolean(shortHist) || lastUser.includes("[SHORT HISTORY]")
  );
  push(
    "BOTTOM_REMINDER",
    "user",
    DEEPSEEK_BOTTOM_REMINDER,
    "DeepSeek Pro xml/user-tail every turn",
    lastUser.includes("[System Reminder:") || lastUser.includes("[DEEPSEEK LENGTH — SINGLE CALL]")
  );
  push(
    "CURRENT_USER_INPUT",
    "user",
    opts.currentUserMessage,
    `turn ${opts.turn}`,
    true
  );
  push(
    "LAYOUT_OWNER",
    "user",
    layout,
    "every turn (user-tail, before length)",
    lastUser.includes("빈 줄")
  );
  push(
    "TERMINAL_LENGTH_OWNER",
    "user",
    lengthOwner,
    "every turn (user-tail absolute end)",
    lastUser.includes("3,200~4,200")
  );

  const finalPrompt = `${system}\n\n===== HISTORY+USER =====\n${built.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}`;

  return {
    turn: opts.turn,
    completedTurns: opts.turn - 1,
    progression_types: directive.progressionTypes,
    recent_stagnation: directive.recentStagnation,
    recommended_intensity: directive.recommendedIntensity,
    avoid: directive.avoid,
    next_beat_hint: directive.nextBeatHint,
    scene_directive_literal: sceneDirectiveBlock,
    scene_directive_hash: sha(sceneDirectiveBlock),
    system_hash: sha(system),
    user_turn_hash: sha(lastUser),
    final_prompt_hash: sha(finalPrompt),
    short_history_extra_present: Boolean(shortHist) || lastUser.includes("[SHORT HISTORY]"),
    short_user_extra_present: Boolean(shortUser) || lastUser.includes("[SHORT USER TURN]"),
    bottom_reminder_present:
      lastUser.includes("[System Reminder:") ||
      lastUser.includes("[DEEPSEEK LENGTH — SINGLE CALL]"),
    opening_present: lastUser.includes("[OPENING SCENE CONTEXT"),
    momentum_present: /\[SCENE MOMENTUM\]|\[SCENE STATE/.test(lastUser),
    pro_extras_fingerprint: sha(
      [
        lastUser.includes("[SHORT HISTORY]") ? "SHORT_HISTORY" : "",
        lastUser.includes("[SHORT USER TURN]") ? "SHORT_USER" : "",
        lastUser.includes("[System Reminder:") ? "BOTTOM" : "",
        lastUser.includes("[OPENING SCENE CONTEXT") ? "OPENING" : "",
        /\[SCENE MOMENTUM\]|\[SCENE STATE/.test(lastUser) ? "MOMENTUM" : "",
      ].join("|")
    ),
    blocks,
    system_prompt: system,
    user_turn: lastUser,
    final_prompt: finalPrompt,
  };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const character = loadDbCharacter();
  const persona = loadPersona();
  const greeting = String(character.greeting || "");

  const reconstructions: Array<Record<string, unknown>> = [];
  for (const run of [1, 2, 3]) {
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const turn of [1, 2]) {
      const metrics = JSON.parse(
        fs.readFileSync(path.join(BASELINE, `run${run}`, `turn${turn}-metrics.json`), "utf8")
      ) as {
        npc_subplot?: boolean;
        external_dialogue_blocks?: number;
        provider_raw_ws?: number;
      };
      const raw = fs.readFileSync(
        path.join(BASELINE, `run${run}`, `turn${turn}-provider-raw.txt`),
        "utf8"
      );
      const rebuilt = rebuild({
        turn,
        history: [...history],
        currentUserMessage: TURNS[turn - 1]!,
        greeting,
        character,
        persona,
      });
      reconstructions.push({
        id: `run${run}/turn${turn}`,
        run,
        turn,
        npc_subplot: Boolean(metrics.npc_subplot),
        external_dialogue_blocks: metrics.external_dialogue_blocks ?? 0,
        output_chars: metrics.provider_raw_ws ?? charLen(raw),
        ...rebuilt,
        // drop huge blobs from comparison file later
      });
      history.push({ role: "user", content: TURNS[turn - 1]! });
      history.push({ role: "assistant", content: raw });
    }
  }

  // Write per-output block maps (compact)
  const blockMaps = reconstructions.map((r) => ({
    id: r.id,
    npc_subplot: r.npc_subplot,
    final_prompt_hash: r.final_prompt_hash,
    system_hash: r.system_hash,
    user_turn_hash: r.user_turn_hash,
    scene_directive_hash: r.scene_directive_hash,
    progression_types: r.progression_types,
    recent_stagnation: r.recent_stagnation,
    completedTurns: r.completedTurns,
    pro_extras_fingerprint: r.pro_extras_fingerprint,
    short_history_extra_present: r.short_history_extra_present,
    short_user_extra_present: r.short_user_extra_present,
    bottom_reminder_present: r.bottom_reminder_present,
    opening_present: r.opening_present,
    momentum_present: r.momentum_present,
    blocks: (r.blocks as Block[]).map((b) => ({
      block_id: b.block_id,
      role: b.role,
      injection_order: b.injection_order,
      turn_condition: b.turn_condition,
      model_condition: b.model_condition,
      character_condition: b.character_condition,
      content_hash: b.content_hash,
      approx_tokens: b.approx_tokens,
      chars: b.chars,
      search_hits: b.search_hits,
      exact_literal_text:
        b.exact_literal_text.length > 2500
          ? `${b.exact_literal_text.slice(0, 2500)}\n…[truncated ${b.exact_literal_text.length} chars]`
          : b.exact_literal_text,
    })),
  }));

  // Turn-1 NPC vs non-NPC (cleanest — history only greeting)
  const t1 = reconstructions.filter((r) => r.turn === 1);
  const t1Npc = t1.filter((r) => r.npc_subplot);
  const t1Non = t1.filter((r) => !r.npc_subplot);

  const same = (key: string) => {
    const vals = t1.map((r) => String(r[key]));
    return vals.every((v) => v === vals[0]);
  };

  const turn1Comparison = {
    npc_ids: t1Npc.map((r) => r.id),
    non_npc_ids: t1Non.map((r) => r.id),
    final_prompt_hash_identical: same("final_prompt_hash"),
    system_hash_identical: same("system_hash"),
    user_turn_hash_identical: same("user_turn_hash"),
    scene_directive_hash_identical: same("scene_directive_hash"),
    progression_types_identical: same("progression_types"),
    pro_extras_fingerprint_identical: same("pro_extras_fingerprint"),
    hashes: t1.map((r) => ({
      id: r.id,
      npc: r.npc_subplot,
      final_prompt_hash: r.final_prompt_hash,
      system_hash: r.system_hash,
      user_turn_hash: r.user_turn_hash,
      scene_directive_hash: r.scene_directive_hash,
      progression_types: r.progression_types,
      pro_extras_fingerprint: r.pro_extras_fingerprint,
      completedTurns: r.completedTurns,
    })),
  };

  // Turn-2: history differs by prior assistant — expect divergent hashes; still compare axis/extras presence
  const t2 = reconstructions.filter((r) => r.turn === 2);
  const turn2Comparison = {
    note: "Turn 2 histories diverge (different Turn 1 assistant text), so final prompt hash differs by construction.",
    rows: t2.map((r) => ({
      id: r.id,
      npc: r.npc_subplot,
      final_prompt_hash: r.final_prompt_hash,
      scene_directive_hash: r.scene_directive_hash,
      progression_types: r.progression_types,
      recent_stagnation: r.recent_stagnation,
      pro_extras_fingerprint: r.pro_extras_fingerprint,
      completedTurns: r.completedTurns,
    })),
  };

  // Suspect blocks: any block with NPC-bias search hits present on all Turn-1 prompts
  const t1Blocks = (t1[0]?.blocks as Block[]) || [];
  const suspect = t1Blocks
    .filter((b) => b.search_hits.length > 0)
    .map((b) => ({
      block_id: b.block_id,
      role: b.role,
      search_hits: b.search_hits,
      content_hash: b.content_hash,
      why: "Contains NPC/progression/world-motion cue language present on identical Turn-1 prompts",
      snippet: b.exact_literal_text.slice(0, 400).replace(/\n/g, " "),
    }));

  let verdict: string;
  let explanation: string;
  if (
    turn1Comparison.final_prompt_hash_identical &&
    turn1Comparison.scene_directive_hash_identical &&
    turn1Comparison.pro_extras_fingerprint_identical
  ) {
    verdict = "NPC_AND_NON_NPC_PROMPTS_IDENTICAL";
    explanation =
      "Turn 1 NPC (run1, run3) and non-NPC (run2) share identical final prompt / SceneDirective / Pro-extras fingerprints. NPC occurrence is therefore not explained by a resolver branch difference on that turn — common cue language + model stochasticity are the leading candidates.";
  } else {
    const differing: string[] = [];
    if (!turn1Comparison.scene_directive_hash_identical) differing.push("SCENE_DIRECTIVE");
    if (!turn1Comparison.progression_types_identical) differing.push("PROGRESSION_AXIS");
    if (!turn1Comparison.pro_extras_fingerprint_identical) differing.push("DEEPSEEK_PRO_EXTRAS");
    if (!turn1Comparison.system_hash_identical) differing.push("COMMON_RP_SYSTEM");
    if (differing.length === 1) {
      verdict = `NPC_CORRELATED_WITH_${differing[0]}`;
      explanation = `Turn 1 NPC vs non-NPC prompts differ specifically in ${differing[0]}.`;
    } else if (differing.length > 1) {
      verdict = "PROMPT_DRIVER_INCONCLUSIVE";
      explanation = `Turn 1 prompts differ across multiple blocks (${differing.join(", ")}); cannot isolate a single driver.`;
    } else {
      verdict = "PROMPT_DRIVER_INCONCLUSIVE";
      explanation = "Could not establish identity or a single differing block.";
    }
  }

  // FINAL_PROMPT_BLOCK_MAP.md
  const mapMd = `# Final Prompt Block Map

Reconstructed offline for production-equivalent path:
user **34** · character **18** (local content twin id **11** 라이크) · persona **61** 렌 · **deepseek-v4-pro** · **single_primary** · canary OFF.

## Canonical injection order (Turn 1)

| order | block_id | role | turn condition |
|---:|---|---|---|
${t1Blocks
  .map(
    (b) =>
      `| ${b.injection_order} | \`${b.block_id}\` | ${b.role} | ${b.turn_condition} |`
  )
  .join("\n")}

## Search-term hits (Turn 1 representative)

${t1Blocks
  .filter((b) => b.search_hits.length)
  .map((b) => `- **${b.block_id}**: ${b.search_hits.join(", ")}`)
  .join("\n") || "(none)"}

## SceneDirective literal (Turn 1 — shared)

\`\`\`
${String(t1[0]?.scene_directive_literal || "")}
\`\`\`

## Pro extras presence (Turn 1)

| flag | value |
|---|---|
| opening | ${t1[0]?.opening_present} |
| short_history | ${t1[0]?.short_history_extra_present} |
| short_user | ${t1[0]?.short_user_extra_present} |
| bottom_reminder | ${t1[0]?.bottom_reminder_present} |
| momentum | ${t1[0]?.momentum_present} |

## Per-output hashes

| id | npc | final_prompt_hash | scene_directive_hash | progression | pro_extras |
|---|---|---|---|---|---|
${reconstructions
  .map(
    (r) =>
      `| ${r.id} | ${r.npc_subplot} | \`${r.final_prompt_hash}\` | \`${r.scene_directive_hash}\` | ${(r.progression_types as string[]).join("+")} | \`${r.pro_extras_fingerprint}\` |`
  )
  .join("\n")}
`;

  const suspectMd = `# Suspect Blocks

## Verdict context
\`${verdict}\`

${explanation}

## Blocks with NPC / progression cue language (present on Turn 1)

${suspect
  .map(
    (s) => `### ${s.block_id}
- hits: ${s.search_hits.join(", ")}
- hash: \`${s.content_hash}\`
- why: ${s.why}
- snippet: ${s.snippet}
`
  )
  .join("\n")}

## Interpretation
- Do **not** treat SceneDirective removal as the next experiment (forbidden / already failed via relationship-axis compression).
- Prefer a **narrow system-level external-intervention gate** that owns only cast/external-start conditions, placed after SceneDirective.
- Length / prose density remain owned by existing terminal length owner.
`;

  const comparison = {
    method:
      "Offline rebuild via buildContext + buildSceneDirective; local character id=11 content twin of production character 18; persona 61; no model calls",
    turn1: turn1Comparison,
    turn2: turn2Comparison,
    baseline_npc_labels: reconstructions.map((r) => ({
      id: r.id,
      npc_subplot: r.npc_subplot,
      external_dialogue_blocks: r.external_dialogue_blocks,
    })),
  };

  const verdictObj = {
    prompt_driver_verdict: verdict,
    explanation,
    suspect_blocks: suspect.map((s) => s.block_id),
    turn1_final_prompt_identical: turn1Comparison.final_prompt_hash_identical,
    turn1_scene_directive_identical: turn1Comparison.scene_directive_hash_identical,
    turn1_pro_extras_identical: turn1Comparison.pro_extras_fingerprint_identical,
    next: "early_external_intervention_gate_system (system block after SceneDirective; fail-closed)",
    pr_234: "close without merge — superseded by system-level external-intervention gate audit",
  };

  fs.writeFileSync(path.join(OUT, "FINAL_PROMPT_BLOCK_MAP.md"), mapMd);
  fs.writeFileSync(path.join(OUT, "NPC_VS_NON_NPC_COMPARISON.json"), JSON.stringify(comparison, null, 2));
  fs.writeFileSync(path.join(OUT, "SUSPECT_BLOCKS.md"), suspectMd);
  fs.writeFileSync(path.join(OUT, "VERDICT.json"), JSON.stringify(verdictObj, null, 2));
  fs.writeFileSync(
    path.join(OUT, "BLOCK_MAP_DETAIL.json"),
    JSON.stringify(blockMaps, null, 2)
  );
  // Keep one full Turn-1 prompt for manual review
  fs.writeFileSync(
    path.join(OUT, "turn1_reconstructed_system.txt"),
    String(t1[0]?.system_prompt || "")
  );
  fs.writeFileSync(
    path.join(OUT, "turn1_reconstructed_user_turn.txt"),
    String(t1[0]?.user_turn || "")
  );

  console.log(JSON.stringify(verdictObj, null, 2));
  console.log(`wrote ${OUT}`);
}

main();
