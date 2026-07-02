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
  { id: OPENROUTER_GEMINI_31_PRO_MODEL, label: "Gemini 3.1 Pro", opts: { mainModelOwnsRelationshipExtract: true } },
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
  "turn-handoff-and-pacing": "src/lib/turnHandoffAndPacing.ts — buildTurnHandoffAndPacingBlock()",
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
  "rule-terminal-length-override": "src/lib/responseLength.ts — buildTerminalLengthOverrideBlock() (compact tail only)",
  "bilingual-dialogue": "src/lib/bilingualDialoguePolicy.ts",
  "controlled-possession": "src/lib/controlledPossession.ts",
  "scene-expansion": "src/lib/sceneExpansionPolicy.ts",
  "input-echo-check": "src/lib/inputEchoCheck.ts",
  "relationship-memory-self-extract": "src/lib/relationshipMemoryTailPrompt.ts",
  "status-widget-policy": "src/lib/statusWidget/prompt.ts",
  "html-visual-card-policy": "src/lib/htmlVisualCardPolicy.ts — buildHtmlVisualCardPolicyBlock()",
  "english-setting-korean-output": "src/lib/promptTranslation.ts — buildEnglishSettingKoreanOutputRule()",
  "core-identity": "src/lib/bodyHairRules.ts — buildCharacterCanonBlock()",
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

const PLACEHOLDER_CHAR = "[A]";
const PLACEHOLDER_USER = "[B]";
const PLACEHOLDER_DYNAMIC = "(dynamic — filled at runtime)";

const HTML_FLASH_USER_BLOCK_SCHEMA = `[CHARACTER CANON — FLASH CONTEXT]
${PLACEHOLDER_DYNAMIC}

[USER PERSONA]
${PLACEHOLDER_DYNAMIC}

[LONG-TERM MEMORY]
${PLACEHOLDER_DYNAMIC}

[USER NOTE — reference RAG]
${PLACEHOLDER_DYNAMIC}

[ACTIVE LORE / LOREBOOK — contextual RAG]
${PLACEHOLDER_DYNAMIC}

[CHARACTER] ${PLACEHOLDER_DYNAMIC}
[USER PERSONA NAME] ${PLACEHOLDER_DYNAMIC}

[RECENT CHAT HISTORY]
${PLACEHOLDER_DYNAMIC}

[USER MESSAGE — this turn]
${PLACEHOLDER_DYNAMIC}

[ASSISTANT REPLY — prose only]
${PLACEHOLDER_DYNAMIC}

[TASK]
Generate the \`\`\`html visual card for this turn per policy above.`;

const USER_MESSAGE_FORMAT_SCHEMA = `[유저 대사]
${PLACEHOLDER_DYNAMIC}

[유저 지문/행동 — 캐릭터가 관찰 가능]
${PLACEHOLDER_DYNAMIC}

[유저 속마음 — ( ) 안 · 캐릭터는 인지 불가]
${PLACEHOLDER_DYNAMIC}

Single plain dialogue lines may pass through unlabeled.
formatUserMessageForPrompt() injects labels from actual user input each turn.`;

async function buildMockFixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = PLACEHOLDER_CHAR;
  const personaDisplayName = PLACEHOLDER_USER;
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n${PLACEHOLDER_DYNAMIC}\n\n# 외형\n${PLACEHOLDER_DYNAMIC}`,
    world: `# 세계관\n${PLACEHOLDER_DYNAMIC}`,
    exampleDialog: `유저: ${PLACEHOLDER_DYNAMIC}\n${charName}: ${PLACEHOLDER_DYNAMIC}`,
    statusWindowPrompt: "",
  });

  return {
    source: "mock fixture (generic placeholders, nsfw, completedTurns=12, target=3000)",
    charName,
    userNickname: personaDisplayName,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(personaDisplayName, "other", PLACEHOLDER_DYNAMIC),
    userNotePrompt: formatUserNoteForPrompt(PLACEHOLDER_DYNAMIC),
    longTermMemory: PLACEHOLDER_DYNAMIC,
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 0, trust: 0 }))),
    shortTermHistory: [
      { role: "user" as const, content: PLACEHOLDER_DYNAMIC },
      { role: "assistant" as const, content: PLACEHOLDER_DYNAMIC },
    ],
    currentUserMessage: PLACEHOLDER_DYNAMIC,
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"],
    completedTurns: 12,
    userPersonaGender: "other" as const,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3000,
    recentNarrativeContext: PLACEHOLDER_DYNAMIC,
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
  } = await import("../src/lib/turnApiBudget");
  const {
    DEEPSEEK_BOTTOM_REMINDER,
    LTM_ABSOLUTE_FACTS_RULE,
  } = await import("../src/lib/deepseekPromptStructure");
  const { buildCoNarrationKoreanRule } = await import("../src/lib/openRouterAdult");
  const { buildPrimaryModelFlashFirewallBlock } = await import("../src/lib/flashOwnedOutputFirewall");
  const { resolveHtmlVisualCardPolicyFromSources, buildHtmlVisualCardPolicyBlock } = await import("../src/lib/htmlVisualCardPolicy");
  const { buildHtmlFlashSystemPrompt } = await import("../src/lib/htmlVisualCardRecovery");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const t = resolveResponseLengthTarget(3000);
  lines.push(
    section(
      "PART A — 출력 상수·tier (responseLengthConstants.ts)",
      [
        `aim: ${t.aimChars} · minimum: ${t.min} (no output char cap — billed by actual length)`,
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
      "PART B3 — compact tail 절대 끝 (buildTerminalLengthOverrideBlock)",
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
        charName: PLACEHOLDER_CHAR,
        userName: PLACEHOLDER_USER,
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
      buildNoGodmoddingBlock(PLACEHOLDER_CHAR, PLACEHOLDER_USER, "standard"),
      "source: src/lib/noGodmodding.ts"
    ),
    section(
      "PART G — user persona narration (일반 / novel)",
      [
        buildSmartUserPersonaNarrationRules(PLACEHOLDER_CHAR, PLACEHOLDER_USER),
        "",
        "--- NOVEL MODE ---",
        buildNovelModeUserPersonaRules(PLACEHOLDER_CHAR, PLACEHOLDER_USER),
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

  const turnPolicy = resolveHtmlVisualCardPolicyFromSources({
  });
  lines.push(
    section(
      "PART I — V3 HTML system brief (turn-trigger, no PART I templates)",
      buildHtmlFlashSystemPrompt(turnPolicy, "top"),
      "source: src/lib/htmlVisualCardRecovery.ts — buildHtmlFlashV3SystemBrief()"
    )
  );
  lines.push(
    section(
      "PART I-legacy — buildHtmlVisualCardPolicyBlock (deprecated empty)",
      buildHtmlVisualCardPolicyBlock({ standing: false, statusFieldLabels: [] }),
      "source: removed — policyBlock always empty; V3 uses brief above + user block"
    )
  );

  lines.push(
    section(
      "PART J — DeepSeek V4 XML bottom reminder (매 user turn prepend)",
      DEEPSEEK_BOTTOM_REMINDER,
      "source: src/lib/deepseekPromptStructure.ts — prependDeepSeekBottomReminder(); APPEARANCE LOCK은 Core Identity에만"
    ),
    section(
      "PART J2 — LTM absolute facts rule (DeepSeek XML LTM wrapper)",
      LTM_ABSOLUTE_FACTS_RULE,
      "source: src/lib/deepseekPromptStructure.ts"
    )
  );

  lines.push(
    section(
      "PART K — 매턴 user turn: 자동진행 (buildContinueNarrativeCommand)",
      buildContinueNarrativeCommand({
        personaName: PLACEHOLDER_USER,
        charName: PLACEHOLDER_CHAR,
        novelModeEnabled: false,
        regenerate: false,
      }),
      "source: src/lib/continueNarrative.ts — DB에는 '자동진행'만 저장, API user에 위 블록 주입"
    ),
    section(
      "PART K2 — 재생성 system directive",
      buildRegenerateSystemDirective({
        charName: PLACEHOLDER_CHAR,
        rejectedAssistantDraft: PLACEHOLDER_DYNAMIC,
      }),
      "source: src/lib/continueNarrative.ts — regenerateMessageId 시 system에 주입"
    ),
    section(
      "PART K3 — 재생성 OOC 우선 user prompt",
      buildRegenerateOocPriorityPrompt({
        userMessage: PLACEHOLDER_DYNAMIC,
        personaName: PLACEHOLDER_USER,
        charName: PLACEHOLDER_CHAR,
      }),
      "source: src/lib/continueNarrative.ts"
    )
  );

  lines.push(
    section(
      "PART L — 이어쓰기 recovery system (under-length 1회)",
      buildRecoveryContinuationSystemPrompt(),
      "source: src/lib/turnApiBudget.ts — narrativeLengthContinuation · L3 user message is built dynamically at runtime (not documented here)"
    )
  );

  lines.push(
    section(
      "PART M — HTML 전용 모델 (DeepSeek V3) user block schema",
      HTML_FLASH_USER_BLOCK_SCHEMA,
      `source: src/lib/htmlVisualCardRecovery.ts — buildHtmlVisualCardFlashUserBlock() · maxOut=${HTML_ONLY_TURN_MAX_OUTPUT_TOKENS} · label=${HTML_ONLY_MODEL_LABEL} · no sample lore/names in prompt`
    )
  );

  return lines;
}

async function main() {
  const chatId = parseChatId(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

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
    "PART N — 매턴 user message 포맷 (formatUserMessageForPrompt schema)",
    "█".repeat(88),
    section(
      "Labeled user turn structure (no sample dialogue)",
      USER_MESSAGE_FORMAT_SCHEMA,
      "source: src/lib/userActionThoughtRules.ts — labels injected from actual user input; DeepSeek bottom reminder is PART J only (not duplicated here)"
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

    if (built.openRouterSystemSplit) {
      const split = built.openRouterSystemSplit;
      lines.push(
        "",
        "── OpenRouter canonical system (API payload = rules + character + dynamic, each rule once) ──",
        section(
          `[${model.id}] OpenRouter systemRulesBlock (cached breakpoint 1)`,
          split.systemRulesBlock,
          `≈${estimateTokens(split.systemRulesBlock)} tok`
        ),
        section(
          `[${model.id}] OpenRouter characterSettingsBlock (cached breakpoint 2)`,
          split.characterSettingsBlock,
          `≈${estimateTokens(split.characterSettingsBlock)} tok`
        ),
        section(
          `[${model.id}] OpenRouter dynamicBlock (non-cached tail)`,
          split.dynamicBlock,
          `≈${estimateTokens(split.dynamicBlock)} tok`
        )
      );
    } else {
      for (const s of allOutputSections) {
        lines.push(
          section(
            `[${model.id}] ${s.id} — ${s.label}`,
            s.text,
            `≈${estimateTokens(s.text)} tokens · ${s.text.length} chars · ${SOURCE_MAP[s.id] ?? ""}`
          )
        );
      }
    }
  }

  lines.push(
    "",
    "█".repeat(88),
    "PART P — 백그라운드 HTML 전용 모델 (DeepSeek V3)",
    `model: ${OPENROUTER_DEEPSEEK_V3_MODEL}`,
    "메인 RP 미호출 HTML 전용 턴 — system prompt는 htmlVisualCardRecovery.ts buildHtmlFlashSystemPrompt()",
    "  • displayUserInputOnly / oocCreativeBrief / htmlOnlyDedicatedTurn 분기",
    "  • PART M user block schema 참조",
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
