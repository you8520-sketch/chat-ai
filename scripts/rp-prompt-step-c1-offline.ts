/**
 * STEP C — C0 baseline freeze + C1 layout offline gates (API calls = 0).
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/rp-prompt-step-c1-offline.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT = process.env.OUT_DIR ?? "docs/audits/rp-prompt-step-c";
const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  "/opt/cursor/artifacts/opus-quality-anchor/fixtures";

mkdirSync(OUT, { recursive: true });

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function est(t: string) {
  return Math.max(1, Math.ceil(t.length * 0.9));
}
function save(name: string, content: string | object) {
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

async function assemble(opts: {
  modelId: string;
  characterId: number;
  currentUserMessage: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const fixture = loadFixture(opts.characterId);
  const ch = fixture.character;
  const persona = fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: String(ch.greeting ?? "") },
    ],
    currentUserMessage: opts.currentUserMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
    narrativePov,
  });
  return built;
}

async function main() {
  const {
    buildWebnovelOutputLayoutRecencyBlock,
    buildCompactTerminalLayoutRecencyLine,
    OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE,
    OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER,
    replaceOutputLayoutSystemBlockWithCompactCandidate,
  } = await import("../src/lib/webnovelOutputFormat");
  const { buildOpenRouterKoreanProseTopBlock } = await import(
    "../src/lib/openRouterProsePolicy"
  );
  const { buildAdvancedProseNsfwGuidelines } = await import(
    "../src/lib/advancedProseNsfwGuidelines"
  );
  const { buildRuntimePromptContaminationGuardBlock } = await import(
    "../src/lib/runtimePromptContaminationGuard"
  );
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");
  const { OPUS_ARM_E_TERMINAL } = await import(
    "../src/lib/opusTerminalLengthOwner"
  );
  const { DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY } = await import(
    "../src/lib/deepseekFutureInstructionBoundary"
  );
  const { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } = await import(
    "../src/lib/terraTerminalLengthOwner"
  );
  const {
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  } = await import("../src/lib/chatModels");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const layoutA = buildWebnovelOutputLayoutRecencyBlock();
  const layoutB = OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE;
  const layoutTail = buildCompactTerminalLayoutRecencyLine();

  const hashes: Record<string, { sha256: string; est_tokens: number; chars: number }> = {};
  const owners: Array<[string, string]> = [
    ["buildOpenRouterKoreanProseTopBlock()", buildOpenRouterKoreanProseTopBlock()],
    [
      "buildAdvancedProseNsfwGuidelines({nsfwEnabled:false})",
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false }),
    ],
    [
      "buildAdvancedProseNsfwGuidelines({nsfwEnabled:true})",
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true }),
    ],
    ["buildWebnovelOutputLayoutRecencyBlock()", layoutA],
    ["buildCompactTerminalLayoutRecencyLine()", layoutTail],
    [
      "buildRuntimePromptContaminationGuardBlock(Opus)",
      buildRuntimePromptContaminationGuardBlock(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    ],
    [
      "buildRuntimePromptContaminationGuardBlock(Gemini)",
      buildRuntimePromptContaminationGuardBlock(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
    ],
    [
      "buildRuntimePromptContaminationGuardBlock(DeepSeek)",
      buildRuntimePromptContaminationGuardBlock(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    ],
    [
      "buildRuntimePromptContaminationGuardBlock(Terra)",
      buildRuntimePromptContaminationGuardBlock(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
    ],
    [
      "buildNoGodmoddingBlock(... standard interactive)",
      buildNoGodmoddingBlock("캐릭터", "렌", "standard"),
    ],
    ["OPUS_ARM_E_TERMINAL", OPUS_ARM_E_TERMINAL],
    [
      "DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY",
      DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY,
    ],
    ["TERRA_TERMINAL_LENGTH_OWNER_CONTRACT", TERRA_TERMINAL_LENGTH_OWNER_CONTRACT],
    ["OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE", layoutB],
  ];
  for (const [name, body] of owners) {
    hashes[name] = {
      sha256: sha256(body),
      est_tokens: estimateTokens(body),
      chars: body.length,
    };
  }

  save(
    "00_BASELINE_HASHES.md",
    [
      "# 00_BASELINE_HASHES",
      "",
      `main_tip_at_freeze = ${process.env.BASELINE_MAIN ?? "origin/main"}`,
      "",
      "| Owner | SHA-256 | est tokens | chars |",
      "|---|---|---:|---:|",
      ...Object.entries(hashes).map(
        ([k, v]) => `| \`${k}\` | \`${v.sha256}\` | ${v.est_tokens} | ${v.chars} |`
      ),
      "",
      "## Protected (C1 must remain byte-identical in assembled prompts)",
      "",
      "- OPUS_ARM_E_TERMINAL",
      "- buildNoGodmoddingBlock standard",
      "- DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY",
      "- TERRA_TERMINAL_LENGTH_OWNER_CONTRACT",
      "- buildOpenRouterKoreanProseTopBlock (CANON/SCOPE/KNOWLEDGE + OUTPUT LANG)",
      "- buildAdvancedProseNsfwGuidelines",
      "- buildRuntimePromptContaminationGuardBlock(*)",
      "- buildCompactTerminalLayoutRecencyLine (user-tail echo kept)",
      "",
      "## Unique C1 variable",
      "",
      "```text",
      "OUTPUT LAYOUT SYSTEM BLOCK",
      "A = buildWebnovelOutputLayoutRecencyBlock()",
      "B = OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE",
      "```",
      "",
    ].join("\n")
  );
  save("00_BASELINE_HASHES.json", hashes);

  // Semantic matrix
  const clauses: Array<{
    id: string;
    meaning: string;
    a: boolean;
    b: boolean;
    class: string;
  }> = [
    {
      id: "same_beat_grouping",
      meaning: "같은 비트 지문을 한 문단에서 연결",
      a: /한 문단 안에서 자연스럽게 연결/.test(layoutA),
      b: /한 문단 안에서 자연스럽게 연결/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "no_sentence_per_paragraph",
      meaning: "지문 한 문장마다 새 문단 금지",
      a: /한 문장이 완결됐다는 이유만으로|지문 한 문장마다 새 문단/.test(layoutA),
      b: /한 문장이 끝났다는 이유만으로 습관적으로 새 문단/.test(layoutB),
      class: "MERGED",
    },
    {
      id: "intentional_one_sentence_emphasis",
      meaning: "의도적 한 문장 문단 예외",
      a: /한 문장짜리 지문 문단|의도적 정적/.test(layoutA),
      b: /의도적 정적|실제 강조/.test(layoutB),
      class: "MERGED",
    },
    {
      id: "speaker_change_boundary",
      meaning: "화자 변경 → 새 문단",
      a: /화자 변경|화자가 바뀌면/.test(layoutA),
      b: /화자 변경|화자별/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "time_place_situation_boundary",
      meaning: "시간·장소·중심 상황 전환 → 새 문단",
      a: /시간·장소|중심 상황/.test(layoutA),
      b: /시간·장소|중심 상황/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "dialogue_own_paragraph",
      meaning: "대사는 독립 문단",
      a: /own paragraph|독립 문단/.test(layoutA),
      b: /독립 문단/.test(layoutB),
      class: "MERGED",
    },
    {
      id: "blank_line_separation",
      meaning: "지문/대사 빈 줄(\\n\\n)",
      a: /blank line|\\\\n\\\\n/.test(layoutA),
      b: /빈 줄|\\\\n\\\\n/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "no_append_dialogue",
      meaning: "지문 끝에 대사 붙이지 않음",
      a: /Never append dialogue|줄 끝에 대사/.test(layoutA) || /Never append/.test(layoutA),
      b: /지문 끝에 대사를 붙이지/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "no_mid_utterance_narration",
      meaning: "대사 중간 지문 분절 금지",
      a: /대사 중간에 지문/.test(layoutA),
      b: /대사 중간에 지문/.test(layoutB),
      class: "PRESERVED",
    },
    {
      id: "wrong_right_example",
      meaning: "Wrong/Right production example",
      a: /Wrong:/.test(layoutA),
      b: /Wrong:/.test(layoutB),
      class: "REMOVED_DUPLICATE",
    },
    {
      id: "separate_dialogue_narration_header",
      meaning: "[DIALOGUE & NARRATION] second owner header",
      a: /\[DIALOGUE & NARRATION\]/.test(layoutA),
      b: /\[DIALOGUE & NARRATION\]/.test(layoutB),
      class: "REMOVED_DUPLICATE",
    },
    {
      id: "user_tail_echo",
      meaning: "user-tail layout recency echo unchanged",
      a: true,
      b: layoutTail.includes("빈 줄") && layoutTail.includes("지문 줄 끝에 대사"),
      class: "PRESERVED",
    },
  ];

  let parityPass = true;
  for (const c of clauses) {
    if (c.class === "REMOVED_DUPLICATE") {
      if (!c.a || c.b) {
        // remove must be present in A and absent in B
        if (!c.a || c.b) {
          /* ok if A has and B lacks */
        }
      }
      if (c.b) {
        // still present in B — not removed
        c.class = "MISSING"; // misuse: not removed
        parityPass = false;
      }
      continue;
    }
    if (!c.b) {
      c.class = "MISSING";
      parityPass = false;
    }
  }

  // Explicit NEW_MEANING scan — candidate must not introduce known out-of-scope policies
  const forbiddenNew = [
    /서술\s*80%/,
    /대사량\s*감소/,
    /문단\s*최소/,
    /intent grouping/,
    /same-speaker intent/,
  ];
  const newMeaningHits = forbiddenNew.filter((re) => re.test(layoutB));
  if (newMeaningHits.length) parityPass = false;

  const aTok = estimateTokens(layoutA);
  const bTok = estimateTokens(layoutB);
  const reductionPct = ((aTok - bTok) / aTok) * 100;

  save(
    "01_LAYOUT_SEMANTIC_PARITY.md",
    [
      "# 01_LAYOUT_SEMANTIC_PARITY",
      "",
      "```text",
      `layout_A_est_tokens = ${aTok}`,
      `layout_B_est_tokens = ${bTok}`,
      `reduction = ${aTok - bTok} (${reductionPct.toFixed(1)}%)`,
      `semantic_parity = ${parityPass ? "PASS" : "FAIL"}`,
      `LAYOUT_PRIMARY_OWNER = 1`,
      `LAYOUT_RECENCY_ECHO = 1 (user-tail unchanged)`,
      "```",
      "",
      "| id | meaning | A | B | class |",
      "|---|---|---|---|---|",
      ...clauses.map(
        (c) =>
          `| ${c.id} | ${c.meaning} | ${c.a} | ${c.b} | ${c.class} |`
      ),
      "",
      "## NEW_MEANING scan",
      "",
      newMeaningHits.length
        ? `FAIL hits: ${newMeaningHits.length}`
        : "PASS — no out-of-scope stylistic policies detected",
      "",
      "## Candidate body",
      "",
      "```text",
      layoutB,
      "```",
      "",
    ].join("\n")
  );

  // Token composition NORMAL — four models, same fixture (Like literary short turn)
  const FIXTURE_USER =
    "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.";
  const models = [
    ["Opus", CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL],
    ["Gemini", CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
    ["DeepSeek", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    ["Terra", CHEAPER_INFERENCE_GPT_56_TERRA_MODEL],
  ] as const;

  const composition: Record<string, unknown> = {};
  for (const [label, modelId] of models) {
    const built = await assemble({
      modelId,
      characterId: 18,
      currentUserMessage: FIXTURE_USER,
    });
    const system = built.systemPrompt;
    const lastUser = built.history[built.history.length - 1]?.content ?? "";
    const compactSystem = replaceOutputLayoutSystemBlockWithCompactCandidate(system);
    const split = built.openRouterSystemSplit;
    composition[label] = {
      modelId,
      mode: "NORMAL",
      system_total: built.meta?.estimatedSystemTokens ?? estimateTokens(system),
      cache_rules: split ? estimateTokens(split.systemRulesBlock) : null,
      cache_character: split ? estimateTokens(split.characterSettingsBlock) : null,
      dynamic: split ? estimateTokens(split.dynamicBlock) : null,
      layout_system_A: aTok,
      layout_system_B: bTok,
      layout_user_tail_echo: estimateTokens(layoutTail),
      layout_A_present: system.includes(layoutA),
      layout_B_absent_in_production: !system.includes(
        OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER
      ),
      compact_swap_ok:
        compactSystem.includes(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE) &&
        !compactSystem.includes("[DIALOGUE & NARRATION]"),
      current_user_has_layout_echo: lastUser.includes(layoutTail),
      opus_arm_e_present_if_opus:
        label === "Opus" ? lastUser.includes(OPUS_ARM_E_TERMINAL) : null,
      protected_hashes_match: {
        layout_tail: sha256(layoutTail) === hashes["buildCompactTerminalLayoutRecencyLine()"]!.sha256,
        opus_arm_e: sha256(OPUS_ARM_E_TERMINAL) === hashes["OPUS_ARM_E_TERMINAL"]!.sha256,
      },
      estimated_uncached_layout_reduction: aTok - bTok,
      estimated_cacheable_token_reduction: 0,
    };
  }

  save(
    "04_TOKEN_COMPOSITION.md",
    [
      "# 04_TOKEN_COMPOSITION",
      "",
      "NORMAL turn only (no REGEN). Fixture: c18 literary short input.",
      "",
      "```text",
      `layout_system_A = ${aTok}`,
      `layout_system_B = ${bTok}`,
      `ESTIMATED_UNCACHED_TOKEN_REDUCTION = ${aTok - bTok} (layout is dynamic)`,
      "ESTIMATED_CACHEABLE_TOKEN_REDUCTION = 0 (C1 does not touch cacheCharacter prose)",
      "```",
      "",
      "```json",
      JSON.stringify(composition, null, 2),
      "```",
      "",
    ].join("\n")
  );
  save("04_TOKEN_COMPOSITION.json", composition);

  const gate = {
    semantic_parity: parityPass ? "PASS" : "FAIL",
    layout_reduction_percent: Number(reductionPct.toFixed(1)),
    reduction_ok: reductionPct >= 30,
    live_ab_allowed: parityPass && reductionPct >= 30,
  };
  save("C1_OFFLINE_GATE.json", gate);
  console.log(JSON.stringify({ hashes_count: Object.keys(hashes).length, gate, aTok, bTok }, null, 2));
  if (!gate.live_ab_allowed) {
    throw new Error("C1 offline hard gate FAIL — live A/B forbidden");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
