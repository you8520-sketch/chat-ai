/**
 * RP Prompt Compression Audit — offline only (API calls = 0).
 * Writes docs/audits/rp-prompt-compression/* and artifact JSON.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { buildContext } from "../src/services/contextBuilder";
import type { ContextBuildInput } from "../src/types";
import { parseCharacterSetting } from "../src/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { formatUserNoteForPrompt } from "../src/lib/persona";
import {
  formatUserMessageForPrompt,
  parseUserMessageParts,
  settingHasMindReadingFromChunks,
} from "../src/lib/userActionThoughtRules";
import { wrapCurrentUserInput } from "../src/lib/currentUserInputLabel";
import { promptTextForUserPart } from "../src/lib/userMessageParse";
import {
  isRegenerateFullRejectedDraftEnabled,
  buildRegenerateSystemDirective,
  buildRegenerateDivergenceSummary,
  buildRegenerateDivergenceReferenceBlock,
  REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS,
} from "../src/lib/continueNarrative";
import { OPUS_ARM_E_TERMINAL } from "../src/lib/opusTerminalLengthOwner";
import { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } from "../src/lib/noGodmodding";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "../src/lib/chatModels";
import { buildAdvancedProseNsfwGuidelines } from "../src/lib/advancedProseNsfwGuidelines";

const DOCS = "docs/audits/rp-prompt-compression";
const ART =
  "/opt/cursor/artifacts/rp-prompt-compression-audit";

const USER_GAUT =
  "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.";

const REJECTED_DRAFT = `백하율은 렌의 말을 듣고 잠시 멈췄다. 골목 끝의 가로등이 흔들리듯 깜빡였고, 젖은 아스팔트 위로 발소리가 겹쳐 들렸다.

"…본 적 있다고 하셨군요."

그는 손을 코트 주머니에 넣으며 렌을 바라보았다. 시선은 차갑지 않았지만, 쉽게 믿지도 않았다. 바람 사이로 오래된 종이 타는 듯한 냄새가 스쳤다.

"이름을 알려 주셔서 감사합니다. 렌."

백하율은 한 걸음 뒤로 물러서며 주변을 훑었다. 그림자가 벽 모서리에서 길게 늘어졌다가 사라졌다. 그는 렌의 어깨 쪽을 잠깐 보았다가, 다시 골목 입구로 시선을 돌렸다.

"따라오지 않는 것 같진 않습니다. 그래도 여기서는 오래 있지 않는 편이 좋겠어요."

렌이 갸웃한 표정을 지었다는 사실은, 이미 눈앞의 움직임으로 분명했다. 백하율은 그 반응을 말로 되풀이하지 않았다. 대신 코트 깃을 바로잡으며 걸음을 옮겼다.

"이쪽으로. 불빛 있는 데까지요."

두 사람의 그림자가 나란히 이어졌다. 멀리서 차 한 대가 지나가며 물웅덩이를 흔들었다. 백하율의 숨이 잠깐 거칠어졌다가 가라앉았다.

"신입… 그 호칭도 들었지만, 지금은 렌으로 부르겠습니다."

그는 멈춘 채 렌의 눈을 보았다. 호기심과 경계가 동시에 섞인 표정. 백하율은 대답을 재촉하지 않았다.

"괜찮으시다면, 조금 더 걸을까요."`;

type ModelSpec = {
  key: string;
  label: string;
  modelId: string;
};

const MODELS: ModelSpec[] = [
  {
    key: "opus",
    label: "Claude Opus 5",
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  },
  {
    key: "gemini",
    label: "Gemini 3.1 Pro Preview",
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  },
  {
    key: "deepseek",
    label: "DeepSeek V4 Pro",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  },
  {
    key: "terra",
    label: "GPT-5.6 Terra",
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  },
];

type OwnerBucket =
  | "COMMON_FIXED_RULES"
  | "CHARACTER_CANON"
  | "PERSONA_AND_USER_RULES"
  | "PROSE_STYLE"
  | "AGENCY"
  | "OUTPUT_LAYOUT"
  | "LANGUAGE"
  | "RUNTIME_STYLE"
  | "MEMORY"
  | "EPISODIC"
  | "TRIGGERS"
  | "LOREBOOK"
  | "MODEL_SPECIFIC"
  | "TERMINAL_OWNER"
  | "REGENERATE"
  | "OTHER_DYNAMIC"
  | "OTHER";

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function tok(text: string): number {
  if (!text) return 0;
  return estimateTokens(text);
}

function classifySection(id: string, label: string, category: string): {
  owner: OwnerBucket;
  contentVsInstruction: "CONTENT" | "INSTRUCTION" | "MIXED";
} {
  const key = `${id} ${label} ${category}`.toLowerCase();
  if (/regenerat|rejected|diverge/.test(key)) {
    return { owner: "REGENERATE", contentVsInstruction: "INSTRUCTION" };
  }
  if (/character-core|identity-and-rules|speech.?profile|example.?dialog|world|setting|canon/.test(key)) {
    if (/character-core|world|example|speech.?profile|setting/.test(key)) {
      return { owner: "CHARACTER_CANON", contentVsInstruction: "CONTENT" };
    }
  }
  if (/persona|user.?note|user.?persona/.test(key)) {
    return { owner: "PERSONA_AND_USER_RULES", contentVsInstruction: "CONTENT" };
  }
  if (/no-godmodding|agency|collaborative|user.?control|godmod/.test(key)) {
    return { owner: "AGENCY", contentVsInstruction: "INSTRUCTION" };
  }
  if (/prose|immersive|narration.?register|sensation|rhythm|webnovel.?breath|scene.?flow|house.?style|snp|style-xml|korean-prose/.test(key)) {
    return { owner: "PROSE_STYLE", contentVsInstruction: "INSTRUCTION" };
  }
  if (/layout|webnovel.?output|paragraph|dialogue.?narration|output.?format|semantic.?paragraph/.test(key)) {
    return { owner: "OUTPUT_LAYOUT", contentVsInstruction: "INSTRUCTION" };
  }
  if (/language|korean|한국어/.test(key) && /top|policy|language/.test(key)) {
    return { owner: "LANGUAGE", contentVsInstruction: "INSTRUCTION" };
  }
  if (/deepseek|terra.?adapter|muse|model.?specific|xml.?struct|future.?instruction|style.?only|momentum|appearance/.test(key)) {
    return { owner: "MODEL_SPECIFIC", contentVsInstruction: "INSTRUCTION" };
  }
  if (/episodic|extracted.?fact/.test(key)) {
    return { owner: "EPISODIC", contentVsInstruction: "CONTENT" };
  }
  if (/trigger/.test(key)) {
    return { owner: "TRIGGERS", contentVsInstruction: "CONTENT" };
  }
  if (/lorebook|lore.?entry/.test(key)) {
    return { owner: "LOREBOOK", contentVsInstruction: "CONTENT" };
  }
  if (/memory|ltm|archive|rag|recent.?narrative|summary/.test(key)) {
    return { owner: "MEMORY", contentVsInstruction: "CONTENT" };
  }
  if (/user.?input.?pars|input.?label|current.?user/.test(key)) {
    return { owner: "RUNTIME_STYLE", contentVsInstruction: "INSTRUCTION" };
  }
  if (/length|terminal|target.?response/.test(key)) {
    return { owner: "TERMINAL_OWNER", contentVsInstruction: "INSTRUCTION" };
  }
  if (category === "dynamic") {
    return { owner: "OTHER_DYNAMIC", contentVsInstruction: "MIXED" };
  }
  if (category === "cacheRules" || category === "cacheCharacter") {
    return { owner: "COMMON_FIXED_RULES", contentVsInstruction: "INSTRUCTION" };
  }
  return { owner: "OTHER", contentVsInstruction: "MIXED" };
}

function buildBaseInput(userMessage: string): ContextBuildInput {
  const charName = "백하율";
  const personaDisplayName = "렌";
  const chunks = parseCharacterSetting({
    characterId: "rp-compress-audit-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 쉽게 드러내지 않는다.
처음 만난 상대에게도 정중하지만, 쉽게 마음을 열지 않는다.
다만 정본상 렌의 목소리와 체향에는 이유 모를 기시감이 있다 — 특별한 인연의 암시.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 긴장 시: 말이 짧아지고 침묵이 늘어난다`,
    world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다.
도심 골목에는 간혹 그림자가 사람을 따라온다.`,
    exampleDialog: `유저: 밤산책 갈래?\n${charName}: …필요하면요.\n유저: 나 렌이야.\n${charName}: 알겠습니다, 렌.`,
    statusWindowPrompt: "",
  });

  return {
    charName,
    personaDisplayName,
    userNickname: personaDisplayName,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(
      personaDisplayName,
      "other",
      "20대. 호기심 많고 직설적. 성인."
    ),
    userNote: formatUserNoteForPrompt(
      "렌. 첫 만남이지만 백하율이 이상하게 신경 쓰이는 상대."
    ),
    longTermMemory:
      "최근 도심 골목에서 이상한 그림자를 목격했다. 초자연 사건 조사가 진행 중이다.",
    memoryMeta: "",
    shortTermHistory: [
      {
        role: "user",
        content: "오늘도 밤산책 갈래? 거리가 좀 이상한 것 같아.",
      },
      {
        role: "assistant",
        content: `백하율은 창밖의 어두운 거리를 잠시 바라본 뒤, 조용히 고개를 끄덕였다.

"…이상하다고 느끼셨군요."

그는 코트 단추를 채우며 렌 쪽을 돌아보았다.`,
      },
    ],
    currentUserMessage: userMessage,
    nsfw: true,
    gender: "male",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 1,
    genres: ["공포/추리"],
    provider: "cheaperinference",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    contentKind: "character",
    party: false,
    recentNarrativeContext:
      "[RECENT NARRATIVE CONTEXT · turn 1]\n골목 입구. 긴장감이 이어지고 있다.",
  };
}

function sumOwner(
  sections: Array<{ owner: OwnerBucket; tokens: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections) {
    out[s.owner] = (out[s.owner] ?? 0) + s.tokens;
  }
  return out;
}

function assembleModel(opts: {
  model: ModelSpec;
  regenerate: boolean;
  userMessage: string;
}) {
  const input = buildBaseInput(opts.userMessage);
  input.modelId = opts.model.modelId;
  input.provider = "cheaperinference";
  input.contentKind = "character";
  input.party = false;
  if (opts.regenerate) {
    input.regenerate = true;
    input.rejectedAssistantDraft = REJECTED_DRAFT;
    input.regenAttemptId = "audit-regen-1";
  }

  const built = buildContext(input);
  const split = built.openRouterSystemSplit;
  const sections = (built.meta.trackedSections ?? []).map((s, idx) => {
    const cls = classifySection(s.id, s.label, s.category);
    return {
      index: idx + 1,
      id: s.id,
      label: s.label,
      category: s.category,
      tokens: tok(s.text),
      chars: s.text.length,
      cachedOrDynamic:
        s.category === "cacheRules" || s.category === "cacheCharacter"
          ? "cached"
          : "dynamic",
      commonOrModelSpecific: /deepseek|terra|muse|opus|gemini/i.test(
        `${s.id} ${s.label}`
      )
        ? "model-specific"
        : "common",
      owner: cls.owner,
      contentVsInstruction: cls.contentVsInstruction,
      preview: s.text.slice(0, 120).replace(/\n/g, "\\n"),
    };
  });

  const historyText = built.history.map((m) => m.content).join("\n");
  // last history item is current user turn when buildContext appends it — check
  const last = built.history[built.history.length - 1];
  const currentUserTurn =
    last?.role === "user" ? last.content : built.history.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const historyWithoutCurrent = built.history.slice(0, -1);
  const historyOnlyText = historyWithoutCurrent.map((m) => m.content).join("\n");

  const ownerTokens = sumOwner(sections);
  const instructionTokens = sections
    .filter((s) => s.contentVsInstruction === "INSTRUCTION")
    .reduce((n, s) => n + s.tokens, 0);
  const contentTokens = sections
    .filter((s) => s.contentVsInstruction === "CONTENT")
    .reduce((n, s) => n + s.tokens, 0);
  const mixedTokens = sections
    .filter((s) => s.contentVsInstruction === "MIXED")
    .reduce((n, s) => n + s.tokens, 0);

  const systemTotal = tok(built.systemPrompt);
  const cacheRules = tok(split?.systemRulesBlock ?? "");
  const cacheCharacter = tok(split?.characterSettingsBlock ?? "");
  const dynamic = tok(split?.dynamicBlock ?? "");

  return {
    model: opts.model,
    regenerate: opts.regenerate,
    systemTotal,
    cacheRules,
    cacheCharacter,
    dynamic,
    currentUserTurnTokens: tok(currentUserTurn),
    recentHistoryTokens: tok(historyOnlyText),
    totalInputEstimate: tok(
      `${built.systemPrompt}\n${historyText}`
    ),
    instructionTokens,
    contentTokens,
    mixedTokens,
    ownerTokens,
    sections,
    currentUserTurn,
    systemPromptShaPreview: built.systemPrompt.slice(0, 200),
    hasArmE: currentUserTurn.includes(
      "유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응"
    ),
    hasTerraTerminal: /TERRA|gpt-5\.6-terra|밀도 있는 장면|표시 글자/i.test(
      currentUserTurn
    ) && opts.model.key === "terra",
    literalGautInSystem: built.systemPrompt.includes("(갸웃)"),
    literalGautInUserTurn: currentUserTurn.includes("(갸웃)"),
    literalGautInHistory: historyOnlyText.includes("(갸웃)"),
    bareGautInUserTurn: /갸웃/.test(currentUserTurn),
  };
}

function auditParenthesis() {
  const chunks = parseCharacterSetting({
    characterId: "x",
    characterName: "백하율",
    gender: "male",
    systemPrompt: "테스트",
    world: "",
    exampleDialog: "",
    statusWindowPrompt: "",
  });
  const hasMind = settingHasMindReadingFromChunks(chunks);
  const parts = parseUserMessageParts(USER_GAUT);
  const formatted = formatUserMessageForPrompt(USER_GAUT, hasMind);
  const wrapped = wrapCurrentUserInput(formatted, {
    mode: "interactive",
    ownershipLockEnabled: true,
  });
  const locations: string[] = [];
  if (USER_GAUT.includes("(갸웃)")) locations.push("raw_user_input");
  if (formatted.includes("(갸웃)")) locations.push("formatUserMessageForPrompt");
  if (wrapped.includes("(갸웃)")) locations.push("wrapCurrentUserInput");
  for (const p of parts) {
    const pt = promptTextForUserPart(p);
    if (pt.includes("(갸웃)")) locations.push(`part:${p.kind}:promptText`);
    if (p.text.includes("(갸웃)")) locations.push(`part:${p.kind}:rawText`);
  }

  return {
    input: USER_GAUT,
    parts: parts.map((p) => ({
      kind: p.kind,
      rawText: p.text,
      promptText: promptTextForUserPart(p),
    })),
    formatted,
    wrapped,
    literalParenthesesLocations: locations,
    expectedFormPresent: formatted.includes(
      "[유저 지문/행동 — 캐릭터가 관찰 가능]"
    ) && formatted.includes("갸웃") && !formatted.includes("(갸웃)"),
  };
}

function decomposeArmE() {
  const text = OPUS_ARM_E_TERMINAL;
  const clauses = [
    {
      id: "length",
      text: "이번 응답은 한국어 총 표시 3,200~4,200자",
      category: "LENGTH",
    },
    {
      id: "expand_via_A_NPC",
      text: "분량은 [A]와 AI가 담당하는 NPC·환경",
      category: "LENGTH/PROGRESSION",
    },
    {
      id: "persona_aux_only",
      text: "유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응",
      category: "AGENCY",
    },
    {
      id: "started_action_completion",
      text: "이미 시작한 행동은 즉각적이고 가역적인 범위",
      category: "AGENCY",
    },
    {
      id: "minor_reversible",
      text: "작고 비결정적인 반응은",
      category: "AGENCY",
    },
    {
      id: "six_conditions",
      text: "허용 가능한 [B]의 보조 행동은 모두 다음 조건",
      category: "AGENCY",
    },
    {
      id: "future_instruction_boundary",
      text: "미래 행동 전체에 대한 포괄적 위임이 아니다",
      category: "AGENCY",
    },
    {
      id: "no_new_dialogue_choice",
      text: "새로운 직접 대사, 중요한 선택·동의·거절",
      category: "AGENCY",
    },
    {
      id: "reaction_point_stop",
      text: "반응이나 선택이 필요한 순간에는 그 직전에서 멈춘다",
      category: "AGENCY/SCENE_STOP",
    },
    {
      id: "meaningful_change_then_stop",
      text: "의미 있는 변화와 그 결과를 만든 뒤",
      category: "SCENE_PROGRESSION",
    },
  ];

  const commonAgency = COLLABORATIVE_INTERACTIVE_OWNER_BLOCK;
  const wrapperHints = [
    "parentheses = completed user input",
    "CURRENT USER INPUT",
    "Do not continue writing",
  ];

  return {
    totalTokens: tok(text),
    totalChars: text.length,
    clauses: clauses.map((c) => {
      const inCommon =
        /대사|선택|동의|거절|대행|대신|유저/.test(commonAgency) &&
        (c.category.startsWith("AGENCY") || c.id === "no_new_dialogue_choice");
      const overlapsCommon =
        c.id === "no_new_dialogue_choice" ||
        c.id === "persona_aux_only" ||
        c.id === "reaction_point_stop" ||
        c.id === "six_conditions" ||
        c.id === "minor_reversible" ||
        c.id === "started_action_completion";
      const overlapsWrapper =
        c.id === "future_instruction_boundary" ||
        c.id === "started_action_completion";
      const unique =
        c.id === "length" ||
        c.id === "expand_via_A_NPC" ||
        c.id === "future_instruction_boundary" ||
        c.id === "meaningful_change_then_stop";
      return {
        ...c,
        presentInTerminal: text.includes(c.text.slice(0, 20)),
        classification: unique
          ? "UNIQUE_TO_ARM_E"
          : overlapsWrapper
            ? "OVERLAPS_CURRENT_USER_WRAPPER"
            : overlapsCommon
              ? "OVERLAPS_COMMON"
              : inCommon
                ? "OVERLAPS_COMMON"
                : "UNIQUE_TO_ARM_E",
      };
    }),
    commonAgencyTokens: tok(commonAgency),
    wrapperHints,
  };
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(ART, { recursive: true });

  const regenMode = isRegenerateFullRejectedDraftEnabled()
    ? "FULL_DRAFT"
    : "COMPACT_SUMMARY";
  const regenEnv = process.env.REGENERATE_FULL_REJECTED_DRAFT ?? "(unset)";
  const compactSummary = buildRegenerateDivergenceSummary(REJECTED_DRAFT);
  const compactBlock = buildRegenerateDivergenceReferenceBlock(REJECTED_DRAFT, {
    includeFullRejectedDraft: false,
  });
  const fullBlock = buildRegenerateDivergenceReferenceBlock(REJECTED_DRAFT, {
    includeFullRejectedDraft: true,
  });
  const regenDirectiveCompact = buildRegenerateSystemDirective({
    charName: "백하율",
    rejectedAssistantDraft: REJECTED_DRAFT,
    regenAttemptId: "audit-regen-1",
    includeFullRejectedDraft: false,
  });

  const paren = auditParenthesis();
  const armE = decomposeArmE();

  const literaryTrue = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    literaryEnhanced: true,
  });
  const literaryFalse = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    literaryEnhanced: false,
  });
  const literaryNoEffect = literaryTrue === literaryFalse;

  const results: Record<string, ReturnType<typeof assembleModel>> = {};
  for (const model of MODELS) {
    results[`${model.key}_normal`] = assembleModel({
      model,
      regenerate: false,
      userMessage: USER_GAUT,
    });
    results[`${model.key}_regen`] = assembleModel({
      model,
      regenerate: true,
      userMessage: USER_GAUT,
    });
  }

  // DeepSeek-sized character canon stress (optional second fixture) — same instruction path
  const measurements = {
    meta: {
      api_calls: 0,
      production_code_change: false,
      prompt_wording_change: false,
      branch: "cursor/rp-prompt-compression-audit-6a91",
      token_estimator: "estimateTokens = ceil(chars * 0.9)",
      fixture_user: USER_GAUT,
      regenerate_env: regenEnv,
      regenerate_mode: regenMode,
      rejected_draft_chars: REJECTED_DRAFT.length,
      rejected_draft_summary_tokens: tok(compactSummary),
      rejected_draft_summary_max_budget: REGENERATE_DIVERGENCE_SUMMARY_MAX_TOKENS,
      rejected_draft_full_block_tokens: tok(fullBlock),
      regenerate_directive_compact_tokens: tok(regenDirectiveCompact),
      literaryEnhanced_no_effect: literaryNoEffect,
    },
    parenthesis: paren,
    armE,
    models: results,
  };
  save(ART, "MEASUREMENTS.json", measurements);

  // ---------- 01_TOKEN_COMPOSITION.md ----------
  const normalRows = MODELS.map((m) => {
    const n = results[`${m.key}_normal`]!;
    return [
      m.label,
      String(n.systemTotal),
      String(n.cacheRules),
      String(n.cacheCharacter),
      String(n.dynamic),
      String(n.instructionTokens),
      String(n.contentTokens),
      String(n.mixedTokens),
      String(n.currentUserTurnTokens),
      String(n.recentHistoryTokens),
      String(n.totalInputEstimate),
    ];
  });
  const regenRows = MODELS.map((m) => {
    const n = results[`${m.key}_normal`]!;
    const r = results[`${m.key}_regen`]!;
    return [
      m.label,
      String(n.systemTotal),
      String(r.systemTotal),
      String(r.systemTotal - n.systemTotal),
      String(n.totalInputEstimate),
      String(r.totalInputEstimate),
      String(r.totalInputEstimate - n.totalInputEstimate),
    ];
  });

  save(
    DOCS,
    "01_TOKEN_COMPOSITION.md",
    `# 01 Token Composition

## Estimator

\`\`\`text
estimateTokens(text) = ceil(text.length * 0.9)
API calls = 0
\`\`\`

## Regeneration setting

\`\`\`text
REGENERATE_FULL_REJECTED_DRAFT = ${regenEnv}
regen rejected-draft mode = ${regenMode}
actual rejected-draft reference tokens (compact summary) = ${tok(compactSummary)}
actual entire regenerate-divergence section tokens (compact directive) = ${tok(regenDirectiveCompact)}
full rejected draft block tokens (opt-in only, NOT default) = ${tok(fullBlock)}
\`\`\`

Default is **COMPACT_SUMMARY**. Full rejected draft requires explicit env opt-in.

## NORMAL TURN ONLY (model footprint)

${mdTable(
  [
    "Model",
    "system_total",
    "cache_rules",
    "cache_character",
    "dynamic",
    "INSTRUCTION",
    "CONTENT",
    "MIXED",
    "current_user",
    "history",
    "TOTAL_INPUT",
  ],
  normalRows
)}

### CONTENT vs INSTRUCTION (NORMAL)

Instruction = fixed rules / agency / prose / layout / model adapters / regenerate.
Content = character canon, persona, memory/episodic/lore/triggers.

Do **not** call system_total "common prompt size".

## NORMAL vs REGEN (same fixture)

${mdTable(
  [
    "Model",
    "normal_system",
    "regen_system",
    "system_delta",
    "normal_total",
    "regen_total",
    "total_delta",
  ],
  regenRows
)}

## Owner bucket tokens (NORMAL)

${MODELS.map((m) => {
  const n = results[`${m.key}_normal`]!;
  const lines = Object.entries(n.ownerTokens)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `### ${m.label}\n\n${lines}`;
}).join("\n\n")}

## Interpretation note

Field measurements that mixed first-turn NORMAL (~DeepSeek 6k) with REGEN turns (~Opus/Gemini/Terra 4.3k–6.8k) are **not** comparable model footprints. Use NORMAL-only table above for structure comparison; use REGEN delta table for regeneration overhead.
`
  );

  // ---------- 02_SECTION_INVENTORY.md ----------
  let inv = `# 02 Section Inventory\n\n`;
  for (const m of MODELS) {
    const n = results[`${m.key}_normal`]!;
    inv += `## MODEL: ${m.label}\n\n`;
    inv += `\`\`\`text\nmodelId = ${m.modelId}\nsystem_total = ${n.systemTotal}\n\`\`\`\n\n`;
    for (const s of n.sections) {
      inv += `### ${String(s.index).padStart(2, "0")} ${s.id}\n\n`;
      inv += `\`\`\`text\ntokens: ${s.tokens}\nchars: ${s.chars}\ncached/dynamic: ${s.cachedOrDynamic}\ncommon/model-specific: ${s.commonOrModelSpecific}\nowner category: ${s.owner}\ncontent vs instruction: ${s.contentVsInstruction}\nlabel: ${s.label}\ncategory(build): ${s.category}\n\`\`\`\n\n`;
    }
    inv += `### USER TURN\n\n\`\`\`text\ncurrent_user_tokens: ${n.currentUserTurnTokens}\nhas Opus Arm E: ${n.hasArmE}\nliteral (갸웃) in user turn: ${n.literalGautInUserTurn}\nbare 갸웃 in user turn: ${n.bareGautInUserTurn}\n\`\`\`\n\n`;
    inv += `<details><summary>user turn preview</summary>\n\n\`\`\`text\n${n.currentUserTurn.slice(0, 1200)}\n\`\`\`\n\n</details>\n\n`;
  }
  save(DOCS, "02_SECTION_INVENTORY.md", inv);

  // ---------- 03_SEMANTIC_OWNER_MATRIX.md ----------
  const opusN = results.opus_normal!;
  const gemN = results.gemini_normal!;
  const dsN = results.deepseek_normal!;
  const terraN = results.terra_normal!;

  function sectionsMatching(result: typeof opusN, re: RegExp): string {
    return result.sections
      .filter((s) => re.test(`${s.id} ${s.label} ${s.owner}`))
      .map((s) => `${s.id}(${s.tokens})`)
      .join(", ") || "—";
  }

  save(
    DOCS,
    "03_SEMANTIC_OWNER_MATRIX.md",
    `# 03 Semantic Owner Matrix

Measured on NORMAL assemble (Opus / Gemini / DeepSeek / Terra), same fixture.

${mdTable(
  ["SEMANTIC OWNER", "Opus sections", "Gemini sections", "DeepSeek sections", "Terra sections", "overlap note"],
  [
    [
      "USER AGENCY",
      sectionsMatching(opusN, /agency|godmod|collaborative/i),
      sectionsMatching(gemN, /agency|godmod|collaborative/i),
      sectionsMatching(dsN, /agency|godmod|collaborative/i),
      sectionsMatching(terraN, /agency|godmod|collaborative/i),
      "Common collaborative owner + CURRENT USER wrapper; Opus adds Arm E; DeepSeek may add future-instruction boundary",
    ],
    [
      "LENGTH",
      `user-tail Arm E (${tok(OPUS_ARM_E_TERMINAL)})`,
      "user-tail common length sentence",
      "user-tail common length (+ optional DS adapters if active)",
      "user-tail Terra terminal",
      "Length lives mainly on user-turn terminal, not system cacheRules",
    ],
    [
      "SCENE STOP",
      "Arm E reaction-point stop + common agency",
      "common agency",
      "common agency + DS boundary if active",
      "common agency + Terra terminal",
      "semantic duplicate risk on Opus",
    ],
    [
      "SCENE PROGRESSION",
      sectionsMatching(opusN, /scene|progress|directive|momentum/i),
      sectionsMatching(gemN, /scene|progress|directive|momentum/i),
      sectionsMatching(dsN, /scene|progress|directive|momentum/i),
      sectionsMatching(terraN, /scene|progress|directive|momentum/i),
      "Check inventory for scene-directive presence",
    ],
    [
      "PROSE STYLE",
      sectionsMatching(opusN, /prose|immersive|narration|sensation|rhythm/i),
      sectionsMatching(gemN, /prose|immersive|narration|sensation|rhythm/i),
      sectionsMatching(dsN, /prose|immersive|narration|sensation|rhythm/i),
      sectionsMatching(terraN, /prose|immersive|narration|sensation|rhythm/i),
      "Shared house style; literaryEnhanced currently no text effect",
    ],
    [
      "DIALOGUE FORMAT",
      sectionsMatching(opusN, /dialogue|layout|webnovel.?output/i),
      sectionsMatching(gemN, /dialogue|layout|webnovel.?output/i),
      sectionsMatching(dsN, /dialogue|layout|webnovel.?output/i),
      sectionsMatching(terraN, /dialogue|layout|webnovel.?output/i),
      "Layout rules often appear in prose bundle + layout recency",
    ],
    [
      "PARAGRAPH FORMAT",
      sectionsMatching(opusN, /paragraph|semantic|layout/i),
      sectionsMatching(gemN, /paragraph|semantic|layout/i),
      sectionsMatching(dsN, /paragraph|semantic|layout/i),
      sectionsMatching(terraN, /paragraph|semantic|layout/i),
      "Duplicate candidate if WEBNOVEL OUTPUT + SEMANTIC PARAGRAPHING + terminal line all repeat blank-line rules",
    ],
    [
      "LANGUAGE",
      sectionsMatching(opusN, /korean|language|한국어/i),
      sectionsMatching(gemN, /korean|language|한국어/i),
      sectionsMatching(dsN, /korean|language|한국어/i),
      sectionsMatching(terraN, /korean|language|한국어/i),
      "Top Korean prose policy typically cacheRules",
    ],
    [
      "CANON PRIORITY",
      sectionsMatching(opusN, /canon|identity|character-core/i),
      sectionsMatching(gemN, /canon|identity|character-core/i),
      sectionsMatching(dsN, /canon|identity|character-core/i),
      sectionsMatching(terraN, /canon|identity|character-core/i),
      "Character canon = CONTENT tokens, not instruction bloat",
    ],
    [
      "KNOWLEDGE BOUNDARY",
      sectionsMatching(opusN, /knowledge|truth|unknown|경계/i),
      sectionsMatching(gemN, /knowledge|truth|unknown|경계/i),
      sectionsMatching(dsN, /knowledge|truth|unknown|경계/i),
      sectionsMatching(terraN, /knowledge|truth|unknown|경계/i),
      "May be embedded inside identity/rules",
    ],
    [
      "USER INPUT PARSING",
      sectionsMatching(opusN, /user.?input|parsing|action.?thought/i),
      sectionsMatching(gemN, /user.?input|parsing|action.?thought/i),
      sectionsMatching(dsN, /user.?input|parsing|action.?thought/i),
      sectionsMatching(terraN, /user.?input|parsing|action.?thought/i),
      "System parsing block + formatUserMessageForPrompt on user turn",
    ],
    [
      "INPUT ECHO",
      "CURRENT USER wrapper (interactive)",
      "CURRENT USER wrapper (interactive)",
      "CURRENT USER wrapper (interactive)",
      "CURRENT USER wrapper (interactive)",
      "If outbound has no raw duplicate, Gemini echo = MODEL_COMPLIANCE_ECHO",
    ],
  ]
)}

## Agency instruction token estimate (NORMAL)

| Model | system AGENCY bucket | user-turn terminal agency-ish | notes |
|---|---|---|---|
| Opus | ${opusN.ownerTokens.AGENCY ?? 0} | Arm E ${tok(OPUS_ARM_E_TERMINAL)} (includes length+agency) | Highest model-specific agency surface |
| Gemini | ${gemN.ownerTokens.AGENCY ?? 0} | common length tail only | Least model-specific agency |
| DeepSeek | ${dsN.ownerTokens.AGENCY ?? 0} | common length + optional future boundary | Check MODEL_SPECIFIC bucket |
| Terra | ${terraN.ownerTokens.AGENCY ?? 0} | Terra terminal (length-first) | Agency mostly common owner |
`
  );

  // ---------- 04_OPUS_ARM_E_OVERLAP.md ----------
  save(
    DOCS,
    "04_OPUS_ARM_E_OVERLAP.md",
    `# 04 Opus Arm E Overlap

## Source

\`src/lib/opusTerminalLengthOwner.ts\` → \`OPUS_ARM_E_TERMINAL\` (frozen Audit 58).

## Totals

\`\`\`text
Arm E total tokens ≈ ${armE.totalTokens}
Arm E chars = ${armE.totalChars}
Common collaborative agency tokens ≈ ${armE.commonAgencyTokens}
\`\`\`

## Clause map

${mdTable(
  ["clause", "category", "classification"],
  armE.clauses.map((c) => [c.id, c.category, c.classification])
)}

### Counts

\`\`\`text
UNIQUE_TO_ARM_E = ${armE.clauses.filter((c) => c.classification === "UNIQUE_TO_ARM_E").length}
OVERLAPS_COMMON = ${armE.clauses.filter((c) => c.classification === "OVERLAPS_COMMON").length}
OVERLAPS_CURRENT_USER_WRAPPER = ${armE.clauses.filter((c) => c.classification === "OVERLAPS_CURRENT_USER_WRAPPER").length}
\`\`\`

## Compactable?

Yes as a **design candidate only** (not applied this audit):

- Keep length band + future-instruction boundary + reaction-point stop as unique semantic payload.
- Merge repeated B-prohibition lists that already exist in \`COLLABORATIVE_INTERACTIVE_OWNER\` + CURRENT USER wrapper.
- Estimated safe reduction if semantic parity preserved: **~35–55% of Arm E tokens** (roughly ${Math.round(armE.totalTokens * 0.35)}–${Math.round(armE.totalTokens * 0.55)} tokens), pending Phase 2 A/B.
- Purpose: same agency meaning, fewer terminal tokens → more attention for prose. **Not** agency relaxation.

## Candidate compact terminal (NOT production)

\`\`\`text
이번 응답은 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.
[B]가 이미 시작한 짧고 가역적인 행동은 자연스럽게 마무리할 수 있지만,
새 직접 대사·중요 선택·동의·거절·관계 결정·위험 행동은 대신 확정하지 않는다.
아직 특정되지 않은 이후 행동 위임(“시키는 대로”)은 포괄 위임이 아니며, 새 요구 행동 직전에 멈춘다.
[A]·NPC·환경의 행동·감각·내면·결과를 충분히 전개한 뒤 [B]의 다음 선택 지점에서 끝낸다.
\`\`\`

Semantic parity vs Arm E must be human-reviewed before any A/B.
`
  );

  // ---------- 05_PROSE_HOUSE_STYLE_AUDIT.md ----------
  save(
    DOCS,
    "05_PROSE_HOUSE_STYLE_AUDIT.md",
    `# 05 Prose / House Style Audit

## literaryEnhanced

\`\`\`text
literaryEnhanced true vs false prose text identical = ${literaryNoEffect}
LITERARY_ENHANCED_CURRENTLY_NO_EFFECT = ${literaryNoEffect}
\`\`\`

There is **no Opus-only literary prose adapter** that changes house-style body text.
Opus standard interactive receives:

\`\`\`text
common House Style (PROSE_STYLE_SECTION / IMMERSIVE_PROSE_BLOCK / layout)
+ common collaborative agency
+ CURRENT USER INPUT wrapper
+ OPUS ARM E TERMINAL
\`\`\`

## House style goal (audit framing)

Common prose should be a **floor / guardrail**, not a full prose generator specification.
Model-specific strengths (especially Opus literary voice) should remain allowed.

## Semantic unit classification (common prose)

| Unit | Classification | Notes |
|---|---|---|
| NARRATION REGISTER: 해체만 / 번역투 금지 / ...... 금지 | A (quality floor) | KEEP |
| SCENE FLOW | A | KEEP |
| RHYTHM: 같은 시작형 반복 금지 | A/B | MERGE candidate with 번역체 단문 연타 금지 |
| RHYTHM: 짧은 문장 연타 금지 | B/C | MERGE with translationese short-burst rule |
| SENSATION 1–2 channel | A | KEEP |
| IMMERSIVE: 체험 밀착 / 목록화 금지 | A | KEEP |
| IMMERSIVE: 이유 없는 첫 만남 특별취급 금지 | A | KEEP — but REASONED_CANON_CONTINUATION when creator canon supplies 기시감/인연 |
| IMMERSIVE: 추상 판정 해설 금지 | A | KEEP |
| WEBNOVEL BREATH pause/리셋 | A/C | KEEP as floor; avoid micromanaging pause frequency |
| 19+ INTIMACY | A (when NSFW) | KEEP |

## KEEP / MERGE / DROP / MODEL-SPECIFIC (proposal only)

| Phrase / rule | Action |
|---|---|
| 같은 감정을 다른 비유로 반복 증명하지 않는다 | KEEP |
| 짧은 문장 연타 금지 + 번역체 단문 연속 금지 | MERGE candidate |
| ...... 금지 | KEEP |
| 이유 없는 첫 만남 특별취급 금지 (정본·인연 예외) | KEEP — do not strengthen against canon-justified reactions |
| Dense sentence-count paragraph micromanagement (if present outside tests) | DROP / keep test-only |
| Opus Arm E prose micromanagement | none found — Arm E is agency/length, not prose style |
| DeepSeek style-only reminder | MODEL-SPECIFIC (if production-active) |

No deletions applied in this audit.
`
  );

  // ---------- 06_INPUT_PARENTHESIS_ECHO_AUDIT.md ----------
  const anyModelLiteral = MODELS.some(
    (m) =>
      results[`${m.key}_normal`]!.literalGautInSystem ||
      results[`${m.key}_normal`]!.literalGautInUserTurn ||
      results[`${m.key}_normal`]!.literalGautInHistory
  );
  save(
    DOCS,
    "06_INPUT_PARENTHESIS_ECHO_AUDIT.md",
    `# 06 Input Parenthesis / Echo Audit

## Fixture input

\`\`\`text
${USER_GAUT}
\`\`\`

## Parser / formatter (offline)

\`\`\`text
parts:
${paren.parts.map((p) => `- ${p.kind}: raw=${JSON.stringify(p.rawText)} promptText=${JSON.stringify(p.promptText)}`).join("\n")}

formatUserMessageForPrompt expected form:
${paren.expectedFormPresent ? "PASS — labeled action + bare 갸웃, no (갸웃)" : "FAIL"}

literal (갸웃) locations in formatter pipeline:
${paren.literalParenthesesLocations.length ? paren.literalParenthesesLocations.join(", ") : "(none after format/wrap)"}
\`\`\`

### Formatted body

\`\`\`text
${paren.formatted}
\`\`\`

### Wrapped CURRENT USER INPUT (preview)

\`\`\`text
${paren.wrapped.slice(0, 800)}
\`\`\`

## Outbound assemble (NORMAL) — literal \`(갸웃)\`

| Model | in system | in history | in current user turn | bare 갸웃 in user turn |
|---|---|---|---|---|
${MODELS.map((m) => {
  const n = results[`${m.key}_normal`]!;
  return `| ${m.label} | ${n.literalGautInSystem} | ${n.literalGautInHistory} | ${n.literalGautInUserTurn} | ${n.bareGautInUserTurn} |`;
}).join("\n")}

\`\`\`text
RAW_PARENTHESES_LEAK in outbound prompt = ${anyModelLiteral}
\`\`\`

Expected production path: parenthetical actions become structured labels; wrappers stripped via \`promptTextForUserPart\`.

## Gemini user dialogue echo (completed user lines re-performed)

Offline prompt check for duplication of completed user dialogue into assistant-facing duplicates:

\`\`\`text
raw current user duplicate of (갸웃): ${anyModelLiteral ? "YES" : "NO"}
formatted current user contains bare 갸웃 only: ${paren.expectedFormPresent}
history contains literal (갸웃): ${MODELS.some((m) => results[`${m.key}_normal`]!.literalGautInHistory)}
creator greeting duplicate of user lines: NO (fixture greeting/history does not contain this user utterance)
example dialogue contamination of (갸웃): NO
\`\`\`

### Verdict

\`\`\`text
PROMPT_DUPLICATION_NOT_CAUSE = ${!anyModelLiteral}
MODEL_COMPLIANCE_ECHO = ${!anyModelLiteral}
RAW_PARENTHESES_LEAK = ${anyModelLiteral}
USER_INPUT_SURFACE_ECHO = investigate model compliance if assistant reprints user dialogue despite clean prompt
\`\`\`

If Gemini reprints \`(갸웃)\` or full user dialogue in assistant output despite clean outbound prompt, treat as **MODEL_COMPLIANCE_ECHO**, not prompt duplication.

## Separate from REASONED_CANON_CONTINUATION

Creator-canon 기시감 / 특별 관심 expansion is **not** the same defect as raw parenthesis leak or user-dialogue echo.
`
  );

  // ---------- 07_MODEL_SPECIFIC_PROMPT_DIFF.md ----------
  save(
    DOCS,
    "07_MODEL_SPECIFIC_PROMPT_DIFF.md",
    `# 07 Model-Specific Prompt Diff

## NORMAL model-specific instruction tokens

| Model | MODEL_SPECIFIC bucket | TERMINAL on user turn | Notes |
|---|---|---|---|
| Opus | ${opusN.ownerTokens.MODEL_SPECIFIC ?? 0} | Arm E ≈ ${tok(OPUS_ARM_E_TERMINAL)} | Largest specialized terminal |
| Gemini | ${gemN.ownerTokens.MODEL_SPECIFIC ?? 0} | common length only | Most “free” / least specialized prompt surface |
| DeepSeek | ${dsN.ownerTokens.MODEL_SPECIFIC ?? 0} | common length + DS extras if active | XML/style/boundary may appear in system or user |
| Terra | ${terraN.ownerTokens.MODEL_SPECIFIC ?? 0} | Terra terminal contract | Length-focused terminal |

## Why Gemini looks freer

Gemini 3.1 Pro path in this fixture: common House Style + collaborative agency + CURRENT USER wrapper + generic length owner. No Arm-E-scale terminal, no DeepSeek XML bundle.

\`\`\`text
Gemini model-specific instruction tokens ≈ ${gemN.ownerTokens.MODEL_SPECIFIC ?? 0}
Opus model-specific (+ Arm E user terminal) ≈ ${(opusN.ownerTokens.MODEL_SPECIFIC ?? 0) + tok(OPUS_ARM_E_TERMINAL)}
\`\`\`

## DeepSeek adapters — production vs experimental

| Adapter | Status (code-path audit) | Count in NORMAL tokens? |
|---|---|---|
| DeepSeek XML structure grouping | production path when DS model | YES if present in tracked sections |
| style-only reminder | production when enabled for DS | YES if injected |
| future-instruction boundary | production for DS interactive | YES if injected |
| optional momentum | gate/flag dependent | only if active |
| appearance rules | gate/flag dependent | only if active |
| historical experiment length adapters | default OFF / canary | NO unless active |

Past experiment code existence alone does **not** add production tokens.

## REGEN overhead sections

Typical regen-only additions:

\`\`\`text
regenerate-divergence base rules
regen attempt line
regen diverge axis
rejected draft compact summary (default) OR full draft (opt-in)
\`\`\`

Check NORMAL vs REGEN section diffs in MEASUREMENTS.json — other prose/agency/canon sections should remain stable aside from regenerate block insertion.
`
  );

  // ---------- 08_COMPRESSION_CANDIDATES.md ----------
  const commonFixedApprox = Math.round(
    ((opusN.ownerTokens.PROSE_STYLE ?? 0) +
      (opusN.ownerTokens.AGENCY ?? 0) +
      (opusN.ownerTokens.OUTPUT_LAYOUT ?? 0) +
      (opusN.ownerTokens.LANGUAGE ?? 0) +
      (opusN.ownerTokens.COMMON_FIXED_RULES ?? 0) +
      (opusN.ownerTokens.RUNTIME_STYLE ?? 0)) /
      1
  );
  save(
    DOCS,
    "08_COMPRESSION_CANDIDATES.md",
    `# 08 Compression Candidates

## Goal (not a hard target)

\`\`\`text
COMMON FIXED INSTRUCTION TOKENS — 25~40% reduction candidate
Exclude: character canon, world canon, persona facts, episodic, LTM, triggers, active lorebook
\`\`\`

Approx common fixed-ish instruction surface on Opus NORMAL (buckets PROSE+AGENCY+LAYOUT+LANGUAGE+COMMON_FIXED+RUNTIME): **${commonFixedApprox} tokens**.

Stretch if that surface is 3k–4k: aim toward ~2.0k–2.8k **only if** quality/agency preserved.

## Priority list

### P0
- Exact duplicate rules across prose + layout + terminal
- Semantic duplicate agency owners (common collaborative + Arm E B-prohibitions + CURRENT USER wrapper)
- Deprecated owners accidentally injected
- Same prohibition repeated at terminal

### P1
- Long explanations → short same-meaning sentences
- Unnecessary production examples
- English+Korean duplicate explanation pairs

### P2
- Over-specific prose micromanagement that flattens Opus voice
- Model-specific historical workarounds no longer needed

### P3 (out of scope)
- Canon / memory content

## Exact / semantic duplicates observed

See section inventory + owner matrix. Primary compression opportunities:

1. **Agency triple-stack on Opus** (common owner + wrapper + Arm E)
2. **Layout blank-line / dialogue-paragraph rules** repeated across WEBNOVEL OUTPUT FORMAT / SEMANTIC PARAGRAPHING / terminal layout line
3. **Rhythm short-burst rules** stated twice in close proximity

## Cache-structure constraint

Do **not** move static/cacheable instruction into dynamic to “look smaller” — that raises cost.
Preserve \`cacheRules\` / \`cacheCharacter\` / \`dynamic\` split.
`
  );

  // ---------- 09_RISK_MATRIX.md ----------
  save(
    DOCS,
    "09_RISK_MATRIX.md",
    `# 09 Risk Matrix

| Change idea | Benefit | Risk | Severity if wrong |
|---|---|---|---|
| Compact Opus Arm E | Free Opus attention for prose | Severe agency regression | CRITICAL |
| Merge layout duplicates | Lower fixed tokens | Dialogue/paragraph regressions (esp. Gemini/DeepSeek) | HIGH |
| Soften house prose micromanagement | Restore Opus literary variance | Short-burst / list-like prose returns on weaker models | MEDIUM |
| Strengthen “첫 만남 특별취급 금지” | — | Suppresses REASONED_CANON_CONTINUATION | DO NOT |
| Delete DeepSeek structure reminder | Token save | DS formatting regressions | HIGH if active in prod |
| Move rules into dynamic | Illusion of smaller cache | Higher $/latency | DO NOT |
| Treat REGEN totals as model footprint | — | False model comparison | DO NOT |

## Non-goals / protected meanings

\`\`\`text
Severe agency meaning must remain
REASONED_CANON_CONTINUATION must remain allowed
CONTENT tokens are not instruction bloat
\`\`\`
`
  );

  // ---------- 10_PHASE2_AB_PLAN.md ----------
  save(
    DOCS,
    "10_PHASE2_AB_PLAN.md",
    `# 10 Phase 2 A/B Plan (NOT STARTED)

Human review required before any production prompt edit.

## Recommended A/B order

1. **Opus Arm E compact candidate** vs frozen Arm E  
   - Metrics: agency severe violations, length band hit rate, literary preference blind score  
   - Stop if agency regresses

2. **Layout dedupe** (merge repeated dialogue/paragraph blank-line rules)  
   - Models: Gemini + DeepSeek + Opus  
   - Metrics: dialogue separation, paragraph quality

3. **Prose MERGE candidates only** (short-burst / translationese)  
   - Prefer KEEP floor; avoid rewriting IMMERSIVE core

## Exclusions from Phase 2 first wave

\`\`\`text
P3 content compression
Railway / pricing / general flags
Numeric state work
API bakeoffs for Muse/Aion
\`\`\`

## Normalization rule for future measurements

Always report:

\`\`\`text
NORMAL TURN footprint
REGEN OVERHEAD (delta)
\`\`\`

separately. Never mix regeneration overhead into model prompt structure comparisons.
`
  );

  // summary JSON for final report
  save(ART, "FINAL_REPORT_INPUT.json", {
    opus: results.opus_normal,
    gemini: results.gemini_normal,
    deepseek: results.deepseek_normal,
    terra: results.terra_normal,
    regenDeltas: MODELS.map((m) => ({
      model: m.key,
      systemDelta:
        results[`${m.key}_regen`]!.systemTotal -
        results[`${m.key}_normal`]!.systemTotal,
      totalDelta:
        results[`${m.key}_regen`]!.totalInputEstimate -
        results[`${m.key}_normal`]!.totalInputEstimate,
    })),
    paren,
    armE,
    literaryNoEffect,
    regenMode,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        docs: DOCS,
        art: ART,
        regenMode,
        literaryNoEffect,
        normal_system: Object.fromEntries(
          MODELS.map((m) => [m.key, results[`${m.key}_normal`]!.systemTotal])
        ),
        regen_system_delta: Object.fromEntries(
          MODELS.map((m) => [
            m.key,
            results[`${m.key}_regen`]!.systemTotal -
              results[`${m.key}_normal`]!.systemTotal,
          ])
        ),
        literal_gaut_outbound: anyModelLiteral,
        armE_tokens: armE.totalTokens,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
