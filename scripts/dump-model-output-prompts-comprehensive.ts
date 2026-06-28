/**
 * 모든 RP 모델의 출력 관련 시스템 프롬프트 + 매턴 주입 프롬프트 종합 덤프
 *
 * Usage:
 *   npx.cmd tsx scripts/dump-model-output-prompts-comprehensive.ts
 *   npx.cmd tsx scripts/dump-model-output-prompts-comprehensive.ts --chat-id=38
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
} from "../src/lib/chatModels";

const OUTPUT = path.join("output", "model-output-prompts-comprehensive.txt");

const BODY_OUTPUT_SECTION_IDS = new Set([
  "openrouter-korean-prose-top",
  "openrouter-lang-critical",
  "openrouter-co-narration-rule",
  "no-godmodding",
  "auto-continue-handoff-hint",
  "rule-core-master",
  "rule-core-turn-hint",
  "prose-style-xml-bundle",
  "rule-advanced-prose-nsfw",
  "turn-handoff-and-pacing",
  "regenerate-divergence",
  "narrative-style",
  "state-window-policy",
  "user-persona-narration-rules",
  "novel-mode-persona-rules",
  "rule-length-control",
  "openrouter-flash-owned-firewall",
  "korean-output-directive",
  "dialogue-format-directive",
  "korean-narration-ending",
  "visual-appearance-anchor",
  "rule-terminal-length-override",
  "bilingual-dialogue",
  "controlled-possession",
  "scene-expansion",
  "input-echo-check",
  "relationship-memory-self-extract",
  "status-widget-policy",
  "html-visual-card-policy",
  "english-setting-korean-output",
  "core-identity",
  "character-critical",
]);

const MODELS: { id: string; label: string; opts?: Record<string, unknown> }[] = [
  { id: OPENROUTER_GEMINI_31_PRO_MODEL, label: "Gemini 3.1 Pro", opts: { mainModelOwnsHtmlVisualCard: true, mainModelOwnsRelationshipExtract: true } },
  { id: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5 Pro" },
  { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro (XML mode)" },
];

const SOURCE_MAP: Record<string, string> = {
  "openrouter-korean-prose-top": "src/lib/openRouterProsePolicy.ts — buildOpenRouterKoreanProseTopBlock()",
  "openrouter-lang-critical": "src/lib/bilingualDialoguePolicy.ts — buildLangCriticalRule()",
  "openrouter-co-narration-rule": "src/lib/openRouterAdult.ts — buildCoNarrationKoreanRule()",
  "no-godmodding": "src/lib/noGodmodding.ts — buildNoGodmoddingBlock()",
  "auto-continue-handoff-hint": "src/services/contextBuilder.ts — auto-continue dynamic one-liner",
  "rule-core-master": "src/lib/corePrompt.ts — buildCoreMasterPromptForCache()",
  "rule-core-turn-hint": "src/lib/corePrompt.ts — buildCoreMasterEarlyTurnHint()",
  "prose-style-xml-bundle": "src/lib/proseStyleXmlBundle.ts",
  "rule-advanced-prose-nsfw": "src/lib/advancedProseNsfwGuidelines.ts (Gemini only duplicate path)",
  "turn-handoff-and-pacing": "src/lib/turnHandoffAndPacing.ts + responseLength.ts terminal override",
  "regenerate-divergence": "src/lib/continueNarrative.ts — buildRegenerateSystemDirective()",
  "narrative-style": "src/lib/narrativeStyle.ts — buildNarrativeStyleLayer()",
  "state-window-policy": "src/lib/statusWindowNotePolicy.ts",
  "user-persona-narration-rules": "src/lib/userPersonaNarrationRules.ts",
  "novel-mode-persona-rules": "src/lib/userPersonaNarrationRules.ts — buildNovelModeUserPersonaRules()",
  "rule-length-control": "src/lib/responseLength.ts — buildLengthInstruction()",
  "openrouter-flash-owned-firewall": "src/lib/flashOwnedOutputFirewall.ts",
  "korean-output-directive": "src/lib/promptTranslation.ts — buildKoreanOutputDirective() (Gemini path)",
  "dialogue-format-directive": "src/lib/promptTranslation.ts — DIALOGUE_FORMAT_DIRECTIVE (Gemini path)",
  "korean-narration-ending": "src/lib/promptTranslation.ts — KOREAN_NARRATION_ENDING_RULE (Gemini path)",
  "visual-appearance-anchor": "src/services/contextBuilder.ts — visual anchor tail",
  "rule-terminal-length-override": "src/lib/responseLength.ts — buildTerminalLengthOverrideBlock()",
  "bilingual-dialogue": "src/lib/bilingualDialoguePolicy.ts",
  "controlled-possession": "src/lib/controlledPossession.ts",
  "scene-expansion": "src/lib/sceneExpansionPolicy.ts",
  "input-echo-check": "src/lib/inputEchoCheck.ts",
  "relationship-memory-self-extract": "src/lib/relationshipMemoryTailPrompt.ts",
  "status-widget-policy": "src/lib/statusWidget/prompt.ts",
  "html-visual-card-policy": "src/lib/htmlVisualCardPolicy.ts — buildHtmlVisualCardPolicyBlock()",
  "english-setting-korean-output": "src/lib/promptTranslation.ts — buildEnglishSettingKoreanOutputRule()",
  "core-identity": "src/lib/characterCoreIdentity.ts — buildCoreIdentityBlock()",
  "character-critical": "src/services/contextBuilder.ts — CRITICAL chunks",
};

function parseChatId(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return undefined;
}

function section(title: string, body: string, meta?: string): string {
  const metaLine = meta ? `\n${meta}\n` : "\n";
  return [
    "",
    "═".repeat(88),
    title,
    metaLine,
    "─".repeat(88),
    body.trim(),
    "",
  ].join("\n");
}

async function buildMockFixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const personaDisplayName = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.\n\n# 외형\n금발, 검은색 제복.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  return {
    source: "mock fixture (nsfw, completedTurns=12, target=3000)",
    charName,
    userNickname: personaDisplayName,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대 대학원생."),
    userNotePrompt: formatUserNoteForPrompt("[고집중] 오래 알고 지낸 친구."),
    longTermMemory: "[장기 기억] 3년 전 실종 사건.",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      { role: "assistant" as const, content: `${charName}은 조용히 고개를 끄덕였다. "…가시려면, 제 옆에 붙어 있으세요."` },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"],
    completedTurns: 12,
    userPersonaGender: "other" as const,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3000,
    contextualLore: "[CONTEXTUAL LORE] 실종 사건 관련 목격 증언.",
    recentNarrativeContext: "[RECENT NARRATIVE] 골목 입구에서 멈춰 섰다.",
  };
}

async function loadDbFixture(chatId?: number) {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  if (!fs.existsSync(dbPath)) throw new Error("no db");
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { chatAssets, parseAssets } = await import("../src/lib/characterAssets");
  const { buildHierarchicalMemoryPromptLayers } = await import("../src/lib/memory/memory-manager");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");

  const db = getDb();
  const chat = chatId
    ? (db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown> | undefined)
    : (db.prepare("SELECT * FROM chats ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined);
  if (!chat) throw new Error("no chat");

  const userId = Number(chat.user_id);
  const characterId = Number(chat.character_id);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as Record<string, unknown>;
  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<string, unknown> | null)
    : null;

  const personaDisplayName = String(personaRow?.name ?? user.nickname ?? "").trim() || "유저";
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    String(personaRow?.description ?? "")
  );
  const userNotePrompt = formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim());
  const msgRows = db
    .prepare("SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(Number(chat.id)) as { role: "user" | "assistant"; content: string }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const currentUserMessage = lastUser?.content ?? "안녕";

  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });

  const memRow = db
    .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
    .get(Number(chat.id)) as { recent_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));
  const assetTags = [...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag))];
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });
  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId: Number(chat.id),
    characterChunks: chunks,
    userMessage: currentUserMessage,
    recentContext: recentHistory.slice(-6).map((m) => m.content).join("\n"),
    completedTurns: completedTurns.length,
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    provider: "openrouter",
  });

  return {
    source: `db chat=${chat.id}`,
    charName: String(ch.name),
    userNickname: String(user.nickname),
    personaDisplayName,
    chunks,
    userPersonaPrompt,
    userNotePrompt,
    longTermMemory,
    memoryMeta: formatMemoryMetaForPrompt(
      normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
    ),
    shortTermHistory: recentHistory.slice(0, -1),
    currentUserMessage,
    nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
    gender: resolveCharacterGender(String(ch.gender)),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    completedTurns: completedTurns.length,
    userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    genres,
    userImpersonation: Number(chat.user_impersonation) === 1,
    novelModeEnabled: Number(chat.novel_mode) === 1,
    targetResponseChars: Number(chat.target_response_chars ?? 3000),
    contextualLore: memoryLayers.contextualLore || undefined,
    recentNarrativeContext: memoryLayers.recentNarrativeContext || undefined,
  };
}

async function dumpStandalonePrompts(): Promise<string[]> {
  const lines: string[] = [];
  const {
    buildLengthInstruction,
    buildTerminalLengthOverrideBlock,
    resolveResponseLengthTarget,
  } = await import("../src/lib/responseLength");
  const {
    HTML_ONLY_TURN_MAX_INPUT_TOKENS,
    HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
    HTML_FLASH_MAX_OUTPUT_TOKENS,
    HTML_ONLY_MODEL_LABEL,
  } = await import("../src/lib/htmlVisualCardRecovery");
  const { buildOpenRouterKoreanProseTopBlock } = await import("../src/lib/openRouterProsePolicy");
  const { buildProseStyleXmlBundle } = await import("../src/lib/proseStyleXmlBundle");
  const { buildNarrativeStyleLayer } = await import("../src/lib/narrativeStyle");
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");
  const {
    buildCoreMasterPrompt,
    buildCoreMasterPromptForCache,
  } = await import("../src/lib/corePrompt");
  const {
    buildSmartUserPersonaNarrationRules,
    buildNovelModeUserPersonaRules,
  } = await import("../src/lib/userPersonaNarrationRules");
  const {
    buildContinueNarrativeCommand,
    buildRegenerateSystemDirective,
    buildRegenerateOocPriorityPrompt,
  } = await import("../src/lib/continueNarrative");
  const {
    buildRecoveryContinuationSystemPrompt,
    CONTINUATION_SYSTEM_PROMPT,
  } = await import("../src/lib/turnApiBudget");
  const { buildVisibleLengthContinuationUserMessage } = await import("../src/lib/narrativeLengthContinuation");
  const {
    DEEPSEEK_BOTTOM_REMINDER,
    buildDeepSeekBottomReminderBlock,
    LTM_ABSOLUTE_FACTS_RULE,
  } = await import("../src/lib/deepseekPromptStructure");
  const { buildCoNarrationKoreanRule } = await import("../src/lib/openRouterAdult");
  const { buildPrimaryModelFlashFirewallBlock } = await import("../src/lib/flashOwnedOutputFirewall");
  const { resolveHtmlVisualCardPolicyFromSources, buildHtmlVisualCardPolicyBlock } = await import("../src/lib/htmlVisualCardPolicy");
  const { buildHtmlVisualCardFlashUserBlock } = await import("../src/lib/htmlVisualCardRecovery");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const t = resolveResponseLengthTarget(3000);
  lines.push(
    section(
      "PART A — 출력 상수·tier (responseLengthConstants.ts)",
      [
        `ABSOLUTE_MAX_RESPONSE_CHARS: ${t.max} (hardMax)`,
        `UNIFIED_TIER_MIN_CHARS (MINIMUM_FLOOR): ${t.min}`,
        `UNIFIED_TIER_AIM_CHARS (TARGET_LENGTH): ${t.aimChars}`,
        `CATASTROPHIC_MIN_RESPONSE_CHARS: import from responseLengthConstants`,
        `HTML_ONLY_TURN_MAX_INPUT_TOKENS: ${HTML_ONLY_TURN_MAX_INPUT_TOKENS.toLocaleString()} (HTML 전용 턴 입력 컨텍스트)`,
        `HTML_ONLY_TURN_MAX_OUTPUT_TOKENS: ${HTML_ONLY_TURN_MAX_OUTPUT_TOKENS.toLocaleString()} (HTML 전용 턴 출력)`,
        `HTML_FLASH_MAX_OUTPUT_TOKENS: ${HTML_FLASH_MAX_OUTPUT_TOKENS.toLocaleString()} (RP 후 2차 HTML)`,
      ].join("\n")
    )
  );

  lines.push(
    section(
      "PART B — 분량·장면 확장 (buildLengthInstruction)",
      buildLengthInstruction(3000),
      `source: src/lib/responseLength.ts · TARGET=${t.aimChars} MIN=${t.min}\nincludes: NO_INPUT_ECHO_RULE (sceneExpansionPolicy) + SCENE_CONTINUATION_PRIORITY_BLOCK (turnHandoffAndPacing)`
    ),
    section(
      "PART B3 — 턴 종료·호흡 (buildTerminalLengthOverrideBlock = buildTurnHandoffAndPacingBlock)",
      buildTerminalLengthOverrideBlock(),
      "source: src/lib/turnHandoffAndPacing.ts — system tail absolute (조기 종료 금지; SCENE CONTINUATION은 PART B에만)"
    )
  );

  lines.push(
    section(
      "PART C — OpenRouter 한국어·문체 상단 (buildOpenRouterKoreanProseTopBlock)",
      buildOpenRouterKoreanProseTopBlock(),
      "source: src/lib/openRouterProsePolicy.ts — cacheRules 첫 블록"
    ),
    section(
      "PART C2 — co-narration 규칙 (일반 / 사칭ON / 소설모드)",
      [
        "--- OFF ---",
        buildCoNarrationKoreanRule(false),
        "",
        "--- ON (userImpersonation) ---",
        buildCoNarrationKoreanRule(true),
        "",
        "--- novelMode ---",
        buildCoNarrationKoreanRule(true, true),
      ].join("\n"),
      "source: src/lib/openRouterAdult.ts — contextBuilder dynamic (OpenRouter)"
    )
  );

  lines.push(
    section(
      "PART D — prose-style bundle (OpenRouter production injection)",
      buildProseStyleXmlBundle({ nsfwEnabled: true, literaryEnhanced: true }),
      `source: buildProseStyleXmlBundle → buildAdvancedProseNsfwGuidelines · ≈${estimateTokens(
        buildProseStyleXmlBundle({ nsfwEnabled: true, literaryEnhanced: true })
      )} tok · includes [ADVANCED PROSE & NSFW GUIDELINES] + [KOREAN WEBNOVEL STYLE] once`
    ),
    section(
      "PART D2 — narrative-style layer (genre/possession hints only)",
      buildNarrativeStyleLayer({ genres: ["공포/추리"] }),
      "source: src/lib/narrativeStyle.ts — no duplicate prose/format rules"
    )
  );

  lines.push(
    section(
      "PART E — [CORE RP] master rules",
      buildCoreMasterPromptForCache({
        charName: "백하율",
        userName: "렌",
        charGender: "male",
        userGender: "other",
        nsfwEnabled: true,
        impersonationOn: false,
        completedTurns: 99,
        hasMindReading: false,
        allowsBeard: true,
        allowsBodyHair: true,
      }),
      "source: src/lib/corePrompt.ts — OpenRouter cached block"
    ),
    section(
      "PART F — [NO GODMODDING]",
      buildNoGodmoddingBlock("백하율", "렌", "standard"),
      "source: src/lib/noGodmodding.ts"
    ),
    section(
      "PART G — user persona narration (일반 / novel)",
      [
        buildSmartUserPersonaNarrationRules("백하율", "렌"),
        "",
        "--- NOVEL MODE ---",
        buildNovelModeUserPersonaRules("백하율", "렌"),
      ].join("\n\n"),
      "source: src/lib/userPersonaNarrationRules.ts"
    )
  );

  lines.push(
    section(
      "PART H — HTML OUTPUT OWNERSHIP",
      buildPrimaryModelFlashFirewallBlock(),
      "source: src/lib/flashOwnedOutputFirewall.ts"
    )
  );

  const htmlPolicy = resolveHtmlVisualCardPolicyFromSources({
    userNote: "",
    userPersona: "",
    characterSetting: "",
    userMessage: "",
    markdownStatusWindowActive: false,
  });
  lines.push(
    section(
      "PART I — HTML visual card policy block (standing OFF sample)",
      buildHtmlVisualCardPolicyBlock({ standing: false, statusFieldLabels: [] }),
      "source: src/lib/htmlVisualCardPolicy.ts"
    )
  );

  lines.push(
    section(
      "PART J — DeepSeek V4 XML bottom reminder (매 user turn prepend)",
      DEEPSEEK_BOTTOM_REMINDER,
      "source: src/lib/deepseekPromptStructure.ts — prependDeepSeekBottomReminder()"
    ),
    section(
      "PART J2 — LTM absolute facts rule (DeepSeek XML LTM wrapper)",
      LTM_ABSOLUTE_FACTS_RULE,
      "source: src/lib/deepseekPromptStructure.ts"
    ),
    section(
      "PART J3 — DeepSeek bottom reminder + appearance tail sample",
      buildDeepSeekBottomReminderBlock("[APPEARANCE LOCK] 금발 — 검은색 제복"),
      "source: src/lib/deepseekPromptStructure.ts"
    )
  );

  lines.push(
    section(
      "PART K — 매턴 user turn: 자동진행 (buildContinueNarrativeCommand)",
      buildContinueNarrativeCommand({
        personaName: "렌",
        charName: "백하율",
        novelModeEnabled: false,
        regenerate: false,
      }),
      "source: src/lib/continueNarrative.ts — DB에는 '자동진행'만 저장, API user에 위 블록 주입"
    ),
    section(
      "PART K2 — 재생성 system directive",
      buildRegenerateSystemDirective({
        charName: "백하율",
        rejectedAssistantDraft: "…(거절된 초안 샘플)…",
      }),
      "source: src/lib/continueNarrative.ts — regenerateMessageId 시 system에 주입"
    ),
    section(
      "PART K3 — 재생성 OOC 우선 user prompt",
      buildRegenerateOocPriorityPrompt({
        userMessage: "OOC: RP 중지, HTML로 상태 요약 출력",
        personaName: "렌",
        charName: "백하율",
      }),
      "source: src/lib/continueNarrative.ts"
    )
  );

  lines.push(
    section(
      "PART L — 이어쓰기 recovery system (under-length 1회)",
      buildRecoveryContinuationSystemPrompt("백하율"),
      "source: src/lib/turnApiBudget.ts — narrativeLengthContinuation"
    ),
    section(
      "PART L2 — CONTINUATION_SYSTEM_PROMPT (legacy one-liner)",
      CONTINUATION_SYSTEM_PROMPT,
      "source: src/lib/turnApiBudget.ts"
    ),
    section(
      "PART L3 — visible length continuation user message sample",
      buildVisibleLengthContinuationUserMessage(1800, 3000, 420),
      "source: src/lib/narrativeLengthContinuation.ts — sub-call user turn"
    )
  );

  // HTML-only model — import internal builder via dynamic read of exported user block + policy
  const htmlUserBlock = buildHtmlVisualCardFlashUserBlock(
    {
      chatId: 1,
      charName: "백하율",
      personaName: "렌",
      userMessage: "OOC: 장기기억·유저노트 참고해서 HTML로 캐릭터 카드 출력",
      assistantProse: "",
      userNote: "[고집중] 친구처럼 대함",
      userPersona: "20대 대학원생",
      characterSetting: "[CORE IDENTITY]\n금발, 검은 제복…",
      memoryBlock: "[장기기억] 실종 사건",
      recentHistory: [{ role: "user", content: "산책 갈래?" }],
      loreBlock: "[LORE] 도시 전설",
    },
    { standing: false, statusFieldLabels: [] },
    "bottom",
    { htmlOnlyDedicatedTurn: true, oocCreativeBrief: true }
  );

  lines.push(
    section(
      "PART M — HTML 전용 모델 (HTML전용모델 / DeepSeek V3) user block sample",
      htmlUserBlock,
      `source: src/lib/htmlVisualCardRecovery.ts — buildHtmlVisualCardFlashUserBlock() · maxOut=${HTML_ONLY_TURN_MAX_OUTPUT_TOKENS} · label=${HTML_ONLY_MODEL_LABEL}`
    ),
    section(
      "PART M2 — HTML 전용 모델 billing",
      "DeepSeek V3 API 원가 + 55% gross margin (OPENROUTER_DEEPSEEK_GROSS_MARGIN=0.55) + input 8k+ surcharge",
      "source: src/lib/points.ts — computeHtmlFlashOnlyTurnBilling()"
    )
  );

  return lines;
}

async function main() {
  const chatId = parseChatId(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { formatUserMessageForPrompt } = await import("../src/lib/userActionThoughtRules");
  const { prependDeepSeekBottomReminder } = await import("../src/lib/deepseekPromptStructure");

  let fixture: Awaited<ReturnType<typeof buildMockFixture>>;
  try {
    fixture = await loadDbFixture(chatId);
  } catch {
    fixture = await buildMockFixture();
  }

  const lines: string[] = [
    "█".repeat(88),
    "모델 출력 관련 시스템 프롬프트 · 매턴 주입 프롬프트 종합 정리",
    `generated: ${new Date().toISOString()}`,
    `fixture: ${fixture.source}`,
    `character="${fixture.charName}" persona="${fixture.personaDisplayName}" turns=${fixture.completedTurns} nsfw=${fixture.nsfw} targetChars=${fixture.targetResponseChars}`,
    "",
    "ASSEMBLY PATH: src/services/contextBuilder.ts → buildContext()",
    "PRODUCTION ROUTE: src/app/api/chat/route.ts",
    "",
    "포함 범위:",
    "  • 문체·문단·대화 구조 (prose bundle, webnovel style, advanced NSFW)",
    "  • 분량·목표 출력량 (LENGTH CONTROL, tier min/aim/max, handoff)",
    "  • 턴 종료·조기 STOP 금지 (TURN_HANDOFF_AND_PACING)",
    "  • NO GODMODDING · persona narration · co-narration",
    "  • Flash/HTML/status firewall (메인 모델 출력 경계)",
    "  • DeepSeek XML bottom reminder (매 user turn)",
    "  • 자동진행·재생성·이어쓰기 user/system 주입",
    "  • HTML 전용 턴 (V3) user block",
    "  • 모델별 buildContext() 출력 관련 섹션 전문",
    "",
    "미포함:",
    "  • speech-rewrite overlay, stream LENGTH_CAP runtime, assistant prefill (Claude recovery)",
    "  • 캐릭터별 RAG 본문·장기기억 실데이터 (fixture mock/DB snapshot)",
    "█".repeat(88),
  ];

  lines.push(...(await dumpStandalonePrompts()));

  lines.push(
    "",
    "█".repeat(88),
    "PART N — 매턴 user message 포맷 (formatUserMessageForPrompt)",
    "█".repeat(88),
    section(
      "일반 user turn (mind-reading OFF)",
      formatUserMessageForPrompt(fixture.currentUserMessage, false),
      "source: src/lib/userActionThoughtRules.ts — history + current user"
    ),
    section(
      "DeepSeek V4 — bottom reminder prepended current turn",
      prependDeepSeekBottomReminder(formatUserMessageForPrompt(fixture.currentUserMessage, false)),
      "source: src/lib/deepseekPromptStructure.ts + contextBuilder history mapping"
    )
  );

  for (const model of MODELS) {
    const built = buildContext({
      charName: fixture.charName,
      chunks: fixture.chunks,
      userNickname: fixture.userNickname,
      userPersona: fixture.userPersonaPrompt,
      userNote: fixture.userNotePrompt,
      longTermMemory: fixture.longTermMemory,
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: fixture.nsfw,
      gender: fixture.gender,
      assetTags: fixture.assetTags,
      memoryMeta: fixture.memoryMeta,
      modelId: model.id,
      userImpersonation: fixture.userImpersonation,
      novelModeEnabled: fixture.novelModeEnabled,
      personaDisplayName: fixture.personaDisplayName,
      targetResponseChars: fixture.targetResponseChars,
      completedTurns: fixture.completedTurns,
      userPersonaGender: fixture.userPersonaGender,
      provider: "openrouter",
      genres: fixture.genres,
      contextualLore: fixture.contextualLore,
      recentNarrativeContext: fixture.recentNarrativeContext,
      geminiStaticDynamicMode: false,
      ...(model.opts ?? {}),
    });

    const outputSections = (built.meta.trackedSections ?? []).filter((s) =>
      BODY_OUTPUT_SECTION_IDS.has(s.id)
    );
    const otherSections = (built.meta.trackedSections ?? []).filter(
      (s) => !BODY_OUTPUT_SECTION_IDS.has(s.id) && /length|prose|style|output|handoff|godmod|narrat|format|lang|html|status|firewall|identity|critical/i.test(s.id + s.label)
    );
    const allOutputSections = [...outputSections, ...otherSections];

    lines.push(
      "",
      "█".repeat(88),
      `PART O — MODEL: ${model.label}`,
      `modelId: ${model.id}`,
      `deepSeekXmlMode: ${built.meta.promptAudit?.deepSeekXmlMode ?? false}`,
      `output-related sections: ${allOutputSections.length} / ${(built.meta.trackedSections ?? []).length} total`,
      `full system ≈${estimateTokens(built.systemPrompt).toLocaleString()} tok`,
      "█".repeat(88),
      "",
      "── 섹션 인덱스 (출력 관련) ──"
    );

    for (const s of allOutputSections) {
      lines.push(
        `  • ${s.id.padEnd(34)} ${String(estimateTokens(s.text)).padStart(6)} tok  — ${s.label}`,
        `      ${SOURCE_MAP[s.id] ?? "see contextBuilder.ts"}`
      );
    }

    for (const s of allOutputSections) {
      lines.push(
        section(
          `[${model.id}] ${s.id} — ${s.label}`,
          s.text,
          `≈${estimateTokens(s.text)} tokens · ${s.text.length} chars · ${SOURCE_MAP[s.id] ?? ""}`
        )
      );
    }

    if (built.openRouterSystemSplit) {
      lines.push(
        section(
          `[${model.id}] OpenRouter cacheRulesBlock (cached prefix excerpt — first 4000 chars)`,
          built.openRouterSystemSplit.systemRulesBlock.slice(0, 4000) +
            (built.openRouterSystemSplit.systemRulesBlock.length > 4000 ? "\n\n… [truncated for index] …" : ""),
          `full cacheRules ≈${estimateTokens(built.openRouterSystemSplit.systemRulesBlock)} tok`
        )
      );
    }
  }

  lines.push(
    "",
    "█".repeat(88),
    "PART P — 백그라운드 HTML 전용 모델 (DeepSeek V3)",
    `model: ${OPENROUTER_DEEPSEEK_V3_MODEL}`,
    "메인 RP 미호출 HTML 전용 턴 — system prompt는 htmlVisualCardRecovery.ts buildHtmlFlashSystemPrompt()",
    "  • displayUserInputOnly / oocCreativeBrief / htmlOnlyDedicatedTurn 분기",
    "  • PART M user block 참조",
    "█".repeat(88),
    "",
    "재생성: npx.cmd tsx scripts/dump-model-output-prompts-comprehensive.ts [--chat-id=N]",
    ""
  );

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  ${lines.join("\n").length.toLocaleString()} chars · ${lines.length.toLocaleString()} lines`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
