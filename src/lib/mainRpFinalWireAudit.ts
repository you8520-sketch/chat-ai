/**
 * Offline Main RP final-wire audit.
 *
 * Replays the production assembly order from buildContext() through
 * convertToOpenRouterFormat, cache/prefill, and assemblePrimaryRpRequest.
 * Does not open a network socket and does not read provider credentials.
 *
 * Token figures from estimateTokens() are local (ceil(chars * 0.9)).
 * They are not provider-counted usage.
 */
import { createHash } from "node:crypto";

import { buildContext } from "@/services/contextBuilder";
import { auditAssembledPrompt } from "@/services/promptAudit";
import {
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { OOC_HTML_MODE_SYSTEM_DIRECTIVE } from "@/lib/oocHtmlRequest";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";
import type { UserAuthoringLevel } from "@/lib/userAuthoringPolicy";
import {
  buildContinueNarrativeCommand,
  buildRegenerateUserPrompt,
  CONTINUE_USER_DISPLAY,
} from "@/lib/continueNarrative";
import {
  buildSceneDirective,
  buildSceneDirectivePromptBlock,
  type SceneDirective,
} from "@/lib/sceneDirective";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { ChatMsg } from "@/lib/ai";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import {
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
  buildOpenRouterMessages,
  convertToOpenRouterFormat,
} from "@/lib/openRouterAdult";
import {
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import {
  applyStatusWidgetSystemPromptOverrides,
  patchOpenRouterSplitForStatusWidget,
} from "@/lib/statusWidget/promptOverrides";
import { serializeJsxComponentCatalog } from "@/lib/jsxComponent/catalog";
import { buildPitWallFixtureRecord } from "@/lib/jsxComponent/pitWallFixture";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import type { ContextBuildInput } from "@/types";

export const MAIN_RP_FINAL_WIRE_AUDIT_BASELINE = "386b23dc6d5a4b4aba28e06a9e57ba2ea882b0fa";

export type CacheBucket = "cacheRules" | "cacheCharacter" | "dynamic" | "userTurn" | "unplaced";

export type WireSectionRow = {
  id: string;
  label: string;
  category: string;
  role: "system" | "user";
  cacheBucket: CacheBucket;
  chars: number;
  localEstimateTokens: number;
  sha256: string;
};

export type WireCaseResult = {
  id: string;
  selectedModelId: SelectedAI;
  wireModelId: string;
  transport: "openrouter" | "cheaperinference";
  turnKind: "interactive" | "auto" | "regen";
  authoringLevel: UserAuthoringLevel;
  adult: boolean;
  statusWidget: boolean;
  oocHtml: boolean;
  jsx: boolean;
  sectionIds: string[];
  sections: WireSectionRow[];
  localEstimateTokens: {
    cacheRules: number;
    cacheCharacter: number;
    dynamic: number;
    userTurn: number;
    historyExcludingCurrent: number;
    promptAuditTotal: number;
  };
  wire: {
    roles: string[];
    assistantPrefill: boolean;
    systemBlocks: Array<{ chars: number; cached: boolean; sha256: string }>;
    systemFlatSha256: string;
    historyCacheBreakpoint: boolean;
    scenePacingInsideCachedCharacterBlock: boolean;
    sceneFlowInsideCachedCharacterBlock: boolean;
    sceneDirectiveSection: boolean;
    requestBodyKeys: string[];
    model: string;
    reasoningEffort: unknown;
    providerOnly: string | null;
    serviceTier: unknown;
    sessionIdPresent: boolean;
    productionOrderMatchesAssembleOnly: boolean;
    oocHtmlReachedProviderSystem: boolean;
    oocHtmlDirectiveInCachedBlocks: boolean;
    temperaturePresent: boolean;
  };
  heuristicDuplicateUpperBound: number;
  statusWidgetPatchChangedSplit: boolean;
  anchors: {
    lengthOwnerOnUserTurn: number;
    lengthOwnerOnSystem: number;
    commonProseInSystem: number;
    gemini31Agency: number;
    autoProgressionTitle: number;
    collaborativeInteractiveTitle: number;
    userAuthoringTitle: number;
    deepseekWorldLoreXml: number;
    coauthorPersistentLine: number;
    jsxManifest: number;
    oocHtmlDirective: number;
    scenePacing: number;
    sceneFlow: number;
    keywordLoreOnUserTurn: number;
    globalLoreOnUserTurn: number;
  };
};

export type MainRpFinalWireAuditReport = {
  baselineCommit: string;
  localEstimate: "ceil(chars * 0.9)";
  providerCountedTokens: null;
  selectableModels: Array<{ id: string; label: string; provider: string }>;
  cases: WireCaseResult[];
};

const FIXTURE_HISTORY: ChatMsg[] = [
  { role: "user", content: "밖이 시끄러워서 여기 창가 쪽이 제일 조용하네." },
  { role: "assistant", content: "백하율은 창틀에 손을 올린 채 잠시 거리를 내려다보았다." },
  { role: "user", content: "조금만 더 이 자리에 있어도 돼?" },
  { role: "assistant", content: "백하율은 고개만 살짝 끄덕이고 창가를 비워 두었다." },
];

const LONG_HISTORY: ChatMsg[] = [
  ...FIXTURE_HISTORY,
  { role: "user", content: "비 냄새가 더 진해졌어." },
  { role: "assistant", content: "백하율은 유리에 맺힌 물을 손가락으로 따라 그렸다." },
  { role: "user", content: "저 골목, 아직 불이 켜져 있네." },
  { role: "assistant", content: "백하율은 그 골목을 보다가 시선을 되돌렸다." },
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function forceProdPromptEnv(): void {
  for (const key of [
    "SHARED_NOVEL_PROSE_V2_ENABLED",
    "SHARED_NOVEL_PROSE_V2_USER_IDS",
    "PROSE_VNEXT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_MODEL_IDS",
    "GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY",
    "SNPV2_DEEPSEEK_LENGTH_ARM",
    "REGISTER_PATCH",
  ]) {
    delete process.env[key];
  }
}

function locateBucket(text: string, split: OpenRouterSystemSplit | undefined): CacheBucket {
  const needle = text.trim();
  if (!split || !needle) return "unplaced";
  const hits: CacheBucket[] = [];
  if (split.systemRulesBlock.includes(needle)) hits.push("cacheRules");
  if (split.characterSettingsBlock.includes(needle)) hits.push("cacheCharacter");
  if (split.dynamicBlock.includes(needle)) hits.push("dynamic");
  if (hits.length === 1) return hits[0]!;
  return "unplaced";
}

type CaseSpec = {
  id: string;
  model: SelectedAI;
  turnKind: "interactive" | "auto" | "regen";
  authoringLevel: UserAuthoringLevel;
  adult: boolean;
  statusWidget: boolean;
  oocHtml: boolean;
  jsx: boolean;
  longHistory: boolean;
  withMemory: boolean;
  withLore: boolean;
};

function caseSpecs(): CaseSpec[] {
  const deepseek = "deepseek-v4.1-flash" as SelectedAI;
  const gemini31 = "gemini-3.1-pro-preview" as SelectedAI;
  const gemini37 = "gemini-3.7-flash" as SelectedAI;
  const gemini38 = "gemini-3.8-flash" as SelectedAI;
  const sol = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
  const opus = "claude-opus-5.5" as SelectedAI;
  const rich = {
    turnKind: "interactive" as const,
    authoringLevel: "NORMAL" as const,
    adult: false,
    statusWidget: false,
    oocHtml: false,
    jsx: false,
    longHistory: false,
    withMemory: true,
    withLore: true,
  };
  return [
    { id: "ds-interactive-normal-rich", model: deepseek, ...rich },
    {
      id: "ds-interactive-limited-rich",
      model: deepseek,
      ...rich,
      authoringLevel: "LIMITED",
    },
    {
      id: "ds-interactive-allow-rich",
      model: deepseek,
      ...rich,
      authoringLevel: "ALLOW",
    },
    {
      id: "ds-auto-normal",
      model: deepseek,
      ...rich,
      turnKind: "auto",
    },
    {
      id: "ds-regen-normal",
      model: deepseek,
      ...rich,
      turnKind: "regen",
    },
    {
      id: "ds-adult-normal",
      model: deepseek,
      ...rich,
      adult: true,
    },
    {
      id: "ds-empty-memory",
      model: deepseek,
      ...rich,
      withMemory: false,
      withLore: false,
      authoringLevel: "LIMITED",
    },
    { id: "g31-interactive-normal-rich", model: gemini31, ...rich },
    {
      id: "g31-interactive-limited-rich",
      model: gemini31,
      ...rich,
      authoringLevel: "LIMITED",
    },
    { id: "g31-adult-normal", model: gemini31, ...rich, adult: true },
    {
      id: "g31-status-widget",
      model: gemini31,
      ...rich,
      statusWidget: true,
    },
    { id: "g31-ooc-html", model: gemini31, ...rich, oocHtml: true },
    {
      id: "ds-ooc-limited",
      model: deepseek,
      ...rich,
      authoringLevel: "LIMITED",
      oocHtml: true,
    },
    {
      id: "ds-ooc-allow",
      model: deepseek,
      ...rich,
      authoringLevel: "ALLOW",
      oocHtml: true,
    },
    {
      id: "ds-ooc-regen",
      model: deepseek,
      ...rich,
      turnKind: "regen",
      oocHtml: true,
    },
    { id: "g37-interactive-normal-rich", model: gemini37, ...rich },
    { id: "g38-interactive-normal-rich", model: gemini38, ...rich },
    { id: "sol-interactive-normal-rich", model: sol, ...rich },
    {
      id: "opus-interactive-long-history",
      model: opus,
      ...rich,
      longHistory: true,
    },
    {
      id: "opus-auto-normal",
      model: opus,
      ...rich,
      turnKind: "auto",
      longHistory: true,
    },
    { id: "ds-jsx", model: deepseek, ...rich, jsx: true },
  ];
}

function binding(model: SelectedAI): {
  transport: "openrouter" | "cheaperinference";
  wireModelId: string;
} {
  const transport = selectedAIProvider(model);
  const wireModelId =
    transport === "openrouter" ? resolveOpenRouterModelId(model) : model;
  return {
    transport: transport === "openrouter" ? "openrouter" : "cheaperinference",
    wireModelId,
  };
}

function buildCase(spec: CaseSpec): WireCaseResult {
  const { transport, wireModelId } = binding(spec.model);
  const userLine = "…잠깐만. 이 자리, 조금만 더 있어도 돼?";
  const displayMessage = spec.turnKind === "auto" ? CONTINUE_USER_DISPLAY : userLine;
  const delegation = resolveEffectiveUserAuthoring({
    persistentMode: "OFF",
    baseLevel: spec.authoringLevel,
    currentUserInput: spec.turnKind === "auto" ? "" : displayMessage,
  }).delegation;
  const promptUserMessage =
    spec.turnKind === "auto"
      ? buildContinueNarrativeCommand({
          personaName: "렌",
          charName: "백하율",
          usesBanmal: false,
          novelModeEnabled: false,
          regenerate: false,
          rejectedAssistantDraft: null,
          resumeAfterOoc: null,
        })
      : spec.turnKind === "regen"
        ? buildRegenerateUserPrompt({
            userMessage: userLine,
            personaName: "렌",
            charName: "백하율",
            usesBanmal: false,
            coNarrationEnabled: delegation.active,
            userDialogueAllowed: delegation.allowDialogue === true,
            rejectedAssistantDraft: "거절된 초안 픽스처. 창가에서 한 걸음 물러났다.",
            regenAttemptId: "audit-regen-1",
            targetResponseChars: 3200,
          })
        : userLine;
  const history = spec.longHistory ? LONG_HISTORY : FIXTURE_HISTORY;
  const sceneInput = {
    mode: spec.turnKind === "auto" ? ("auto_progression" as const) : ("interactive" as const),
    recentMessages: history,
    currentUserMessage: displayMessage,
    memoryText: spec.withMemory ? "LTM_FIXTURE: 렌과 백하율은 창가에 함께 서 있다." : undefined,
    relationshipMemoryText: spec.withMemory ? "Relationship: 아직 서로를 이름만 안다." : undefined,
    lorebookText: spec.withLore ? "LORE_FIXTURE: 이 거리의 창가는 비 오는 밤에만 조용하다." : undefined,
    adultModeEnabled: spec.adult,
    chatId: "audit-fixture-chat",
    currentTurn: 3,
    contentKind: "character" as const,
    primaryCharacterName: "백하율",
    party: false,
  };
  const canonicalSceneDirective: SceneDirective = buildSceneDirective(sceneInput);
  const sceneDirectiveBlock = buildSceneDirectivePromptBlock(sceneInput);
  const input: ContextBuildInput = {
    charName: "백하율",
    contentKind: "character",
    chunks: [
      {
        id: "fixture-identity",
        characterId: "fixture",
        content: "[Identity]\n백하율은 비 오는 밤의 창가를 지키는 인물이다.",
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 20,
        keywords: ["창가"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "PERSONA_FIXTURE: 렌은 창가에 앉아 비를 듣는 사람.",
    userNote: "USER_NOTE_FIXTURE: 대사는 짧게.",
    longTermMemory: spec.withMemory ? "LTM_FIXTURE: 렌과 백하율은 창가에 함께 서 있다." : "",
    mediumTermMemoryBlock: spec.withMemory ? "[MTM_FIXTURE]\n창가 장면이 이어지고 있다." : "",
    archiveMemory: spec.withMemory ? "ARCHIVE_FIXTURE: 어제 같은 창가에서 헤어졌다." : "",
    memoryMeta: spec.withMemory ? "Relationship: 아직 서로를 이름만 안다." : "",
    episodicMemoryBlock: spec.withMemory
      ? "[EPISODIC MEMORY - RETRIEVED FACTS]\n- [T2] 렌은 창가가 조용하다고 말했다."
      : "",
    keywordLorebookBlock: spec.withLore
      ? "[KEYWORD LORE]\nLORE_FIXTURE: 이 거리의 창가는 비 오는 밤에만 조용하다."
      : "",
    globalLorebookBlock: spec.withLore ? "[GLOBAL LORE]\nGLOBAL_FIXTURE: 상태 HTML은 서버가 소유한다." : "",
    userLorebookBlock: spec.withLore ? "[USER LORE]\nUSER_LORE_FIXTURE: 렌은 비를 싫어하지 않는다." : "",
    creatorNarrationStyle: "CREATOR_STYLE_FIXTURE: 문장은 짧게 끊고 손의 위치만 구체적으로.",
    shortTermHistory: history,
    currentUserMessage: promptUserMessage,
    nsfw: spec.adult,
    activeConsentMode: spec.adult ? "standard" : undefined,
    gender: "male",
    userPersonaGender: "other",
    userId: 1,
    chatId: 1,
    targetResponseChars: 3200,
    completedTurns: 2,
    provider: "openrouter",
    modelId: wireModelId,
    isContinue: spec.turnKind === "auto",
    regenerate: spec.turnKind === "regen",
    rejectedAssistantDraft:
      spec.turnKind === "regen" ? "거절된 초안 픽스처. 창가에서 한 걸음 물러났다." : null,
    regenAttemptId: spec.turnKind === "regen" ? "audit-regen-1" : null,
    currentTurnAuthoringDelegation: delegation,
    sceneDirectiveBlock,
    statusWidgetActive: spec.statusWidget,
    jsxComponentCatalogJson: spec.jsx
      ? serializeJsxComponentCatalog([buildPitWallFixtureRecord()])
      : "",
    systemPrompt: "백하율은 낮고 짧은 말로 대답한다.",
    world: "비 오는 도시. 창가.",
    exampleDialog: "백하율: …앉아.\n렌: 응.",
  };

  const built = buildContext(input);
  const splitBeforeWidget = built.openRouterSystemSplit;
  let system = built.systemPrompt;
  let split = splitBeforeWidget;
  if (spec.statusWidget && split) {
    system = applyStatusWidgetSystemPromptOverrides(system);
    split = patchOpenRouterSplitForStatusWidget(split);
  }
  const statusWidgetPatchChangedSplit = Boolean(
    spec.statusWidget &&
      splitBeforeWidget &&
      split &&
      (split.systemRulesBlock !== splitBeforeWidget.systemRulesBlock ||
        split.characterSettingsBlock !== splitBeforeWidget.characterSettingsBlock ||
        split.dynamicBlock !== splitBeforeWidget.dynamicBlock)
  );

  const sections: WireSectionRow[] = (built.meta.trackedSections ?? []).map((section) => ({
    id: section.id,
    label: section.label,
    category: section.category,
    role: "system" as const,
    cacheBucket: locateBucket(section.text, split ?? splitBeforeWidget),
    chars: section.text.length,
    localEstimateTokens: estimateTokens(section.text),
    sha256: sha256(section.text),
  }));
  const lastUser = String(built.history.at(-1)?.content ?? "");
  sections.push({
    id: "current-user-turn",
    label: "Current user turn after builder tails",
    category: "recentConversation",
    role: "user",
    cacheBucket: "userTurn",
    chars: lastUser.length,
    localEstimateTokens: estimateTokens(lastUser),
    sha256: sha256(lastUser),
  });

  const skipMotionCue = spec.turnKind === "auto";
  const messageOpts = {
    charName: "백하율",
    personaName: "렌",
    systemSplit: split,
    sessionId: "audit-fixture-chat",
    oocHtmlMode: spec.oocHtml || undefined,
    transportProvider: transport === "cheaperinference" ? ("cheaperinference" as const) : undefined,
    sceneServerControls: {
      mode: spec.turnKind === "auto" ? ("auto_progression" as const) : ("interactive" as const),
      contentKind: "character" as const,
      party: false,
      primaryCharacterName: "백하율",
      currentUserMessage: displayMessage,
      recentMessages: history,
      adultModeEnabled: spec.adult,
      chatId: "audit-fixture-chat",
      currentTurn: 3,
      canonicalSceneDirective,
      skipMotionCue,
    },
  };
  const requestHistory = convertToOpenRouterFormat(built.history);
  const baseMessages = buildOpenRouterMessages(system, requestHistory, messageOpts);
  const cached = applyCacheAndPrefillForTransport(
    { provider: transport },
    baseMessages,
    wireModelId,
    "백하율",
    { skipAssistantPrefill: false }
  );
  const assembled = assemblePrimaryRpRequest({
    system,
    history: requestHistory,
    modelId: wireModelId,
    targetResponseChars: 3200,
    messageOpts,
    stream: true,
    messagesOverride: cached.messages,
  });
  const assembleOnly = assemblePrimaryRpRequest({
    system,
    history: requestHistory,
    modelId: wireModelId,
    targetResponseChars: 3200,
    messageOpts,
    stream: true,
  });

  const finalMessages = assembled.messages;
  const systemMessage = finalMessages.find((message) => message.role === "system");
  const systemBlocks = describeSystemBlocks(systemMessage);
  const cachedCharacterText = cachedCharacterBlockText(systemMessage);
  const body = assembled.requestBody;
  const provider = body.provider as { only?: string[] } | undefined;
  const promptAudit = auditAssembledPrompt({
    systemSections: built.meta.trackedSections ?? [],
    systemPrompt: built.systemPrompt,
    history: built.history,
    deepSeekXmlMode: wireModelId.includes("deepseek"),
  });
  const historyExcludingCurrent = built.history.slice(0, -1);

  return {
    id: spec.id,
    selectedModelId: spec.model,
    wireModelId,
    transport,
    turnKind: spec.turnKind,
    authoringLevel: spec.authoringLevel,
    adult: spec.adult,
    statusWidget: spec.statusWidget,
    oocHtml: spec.oocHtml,
    jsx: spec.jsx,
    sectionIds: sections.map((section) => section.id),
    sections,
    localEstimateTokens: {
      cacheRules: estimateTokens(split?.systemRulesBlock ?? ""),
      cacheCharacter: estimateTokens(split?.characterSettingsBlock ?? ""),
      dynamic: estimateTokens(split?.dynamicBlock ?? ""),
      userTurn: estimateTokens(lastUser),
      historyExcludingCurrent: estimateTokens(
        historyExcludingCurrent.map((message) => message.content).join("\n")
      ),
      promptAuditTotal: promptAudit.totalAssembledTokens,
    },
    wire: {
      roles: finalMessages.map((message) => message.role),
      assistantPrefill: finalMessages.some((message, index) => {
        return index === finalMessages.length - 1 && message.role === "assistant";
      }),
      systemBlocks,
      systemFlatSha256: sha256(flattenSystem(systemMessage)),
      historyCacheBreakpoint: finalMessages.slice(1).some((message) => {
        return Array.isArray(message.content) && message.content.some((block) => block.cache_control);
      }),
      scenePacingInsideCachedCharacterBlock: cachedCharacterText.includes("[SCENE PACING]"),
      sceneFlowInsideCachedCharacterBlock: cachedCharacterText.includes("[SCENE FLOW]"),
      sceneDirectiveSection: sections.some((section) => section.id === "scene-directive"),
      requestBodyKeys: Object.keys(body).sort(),
      model: String(body.model ?? ""),
      reasoningEffort: body.reasoning_effort ?? null,
      providerOnly: provider?.only?.[0] ?? null,
      serviceTier: body.service_tier ?? null,
      sessionIdPresent: Object.prototype.hasOwnProperty.call(body, "session_id"),
      productionOrderMatchesAssembleOnly:
        sha256(JSON.stringify(finalMessages)) === sha256(JSON.stringify(assembleOnly.messages)),
      oocHtmlReachedProviderSystem: flattenSystem(systemMessage).includes(
        OOC_HTML_MODE_SYSTEM_DIRECTIVE
      ),
      oocHtmlDirectiveInCachedBlocks: cachedBlocksContain(
        systemMessage,
        OOC_HTML_MODE_SYSTEM_DIRECTIVE
      ),
      temperaturePresent: Object.prototype.hasOwnProperty.call(body, "temperature"),
    },
    heuristicDuplicateUpperBound: promptAudit.duplicates.reduce(
      (sum, hit) => sum + hit.estimatedWastedTokens,
      0
    ),
    statusWidgetPatchChangedSplit,
    anchors: buildAnchors(flattenSystem(systemMessage), finalUserText(finalMessages)),
  };
}

function finalUserText(messages: OpenRouterChatMessage[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  return user.content.map((block) => block.text).join("\n\n");
}

function buildAnchors(systemText: string, userText: string) {
  const count = (haystack: string, needle: string) =>
    needle ? haystack.split(needle).length - 1 : 0;
  return {
    lengthOwnerOnUserTurn: count(userText, USER_TAIL_LENGTH_OWNER_SENTENCE),
    lengthOwnerOnSystem: count(systemText, USER_TAIL_LENGTH_OWNER_SENTENCE),
    commonProseInSystem: count(systemText, "[COMMON PROSE]"),
    gemini31Agency: count(systemText, GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    autoProgressionTitle: count(systemText, "[AUTO PROGRESSION — EFFECTIVE USER AUTHORING]"),
    collaborativeInteractiveTitle: count(systemText, "[USER CONTROL — COLLABORATIVE INTERACTIVE]"),
    userAuthoringTitle: count(systemText, "[USER AUTHORING — EFFECTIVE COAUTHOR POLICY]"),
    deepseekWorldLoreXml: count(systemText, "<WORLD_LORE>"),
    coauthorPersistentLine: count(
      systemText,
      "사용자가 유저 페르소나 공동 서술을 켜 두었다."
    ),
    jsxManifest: count(systemText, "[HAV JSX COMPONENTS]"),
    oocHtmlDirective: count(systemText, OOC_HTML_MODE_SYSTEM_DIRECTIVE),
    scenePacing: count(systemText, "[SCENE PACING]"),
    sceneFlow: count(systemText, "[SCENE FLOW]"),
    keywordLoreOnUserTurn: count(userText, "[KEYWORD LORE]"),
    globalLoreOnUserTurn: count(userText, "[GLOBAL LORE]"),
  };
}

function cachedBlocksContain(
  message: OpenRouterChatMessage | undefined,
  needle: string
): boolean {
  if (!message || !Array.isArray(message.content) || !needle) return false;
  return message.content.some(
    (block) => block.cache_control?.type === "ephemeral" && block.text.includes(needle)
  );
}

function flattenSystem(message: OpenRouterChatMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => block.text).join("\n\n");
}

function describeSystemBlocks(
  message: OpenRouterChatMessage | undefined
): Array<{ chars: number; cached: boolean; sha256: string }> {
  if (!message) return [];
  if (typeof message.content === "string") {
    return [{ chars: message.content.length, cached: false, sha256: sha256(message.content) }];
  }
  return message.content.map((block: OpenRouterContentBlock) => ({
    chars: block.text.length,
    cached: block.cache_control?.type === "ephemeral",
    sha256: sha256(block.text),
  }));
}

function cachedCharacterBlockText(message: OpenRouterChatMessage | undefined): string {
  if (!message || !Array.isArray(message.content)) return "";
  const cached = message.content.filter((block) => block.cache_control?.type === "ephemeral");
  return cached[1]?.text ?? "";
}

export function runMainRpFinalWireAudit(): MainRpFinalWireAuditReport {
  forceProdPromptEnv();
  return {
    baselineCommit: MAIN_RP_FINAL_WIRE_AUDIT_BASELINE,
    localEstimate: "ceil(chars * 0.9)",
    providerCountedTokens: null,
    selectableModels: MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      provider: option.provider,
    })),
    cases: caseSpecs().map(buildCase),
  };
}
