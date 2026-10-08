/**
 * PRECALL production final-wire planning. No provider POST, no DB write.
 *
 * Reuses the owners that POST /api/chat uses for a first user turn on a fresh
 * chat: history preparation, canon policy/lazy compile, scene directive,
 * assembleNextTurnContextBuildInput, buildContext, status-widget overrides,
 * buildOpenRouterMessages, applyCacheAndPrefillForTransport and
 * assemblePrimaryRpRequest. Raw rows only exist in this process's memory.
 */
import { createHash } from "node:crypto";

import Database from "better-sqlite3";

import type { ChatMsg } from "@/lib/ai";
import type { User } from "@/lib/auth";
import { classifyChatOocIntent } from "@/lib/chatOocPriority";
import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { ensureCanonPlanOnAccess } from "@/lib/canonPlan/lazyCompile";
import { shouldRunCanonInjectionSideEffects } from "@/lib/canonPlan/shadowD0";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import { resolveCharacterGender } from "@/lib/characterGender";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { chatAssets, parseAssets } from "@/lib/characterAssets";
import {
  formatMemoryMetaForPrompt,
  normalizeMemoryMeta,
  parseMemoryMeta,
} from "@/lib/chatMemory";
import {
  buildPrivateSpeechControlBlock,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import { messagesToTurns, countPlayableTurns } from "@/lib/hybridMemory";
import {
  loadGlobalLorebookPromptBlock,
  type GlobalLorebookEntryRow,
} from "@/lib/globalLorebook";
import { chatInputSuppressesStatusWidget } from "@/lib/htmlDisplayOnlyTurn";
import { isLivingSceneDirectiveV2EnabledForUser } from "@/lib/livingSceneDirectivePolicy";
import { resolveNarrativePov } from "@/lib/narrativePov";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import {
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
  buildOpenRouterMessages,
  convertToOpenRouterFormat,
  type OpenRouterMessageOpts,
} from "@/lib/openRouterAdult";
import type { OpenRouterChatMessage } from "@/lib/openRouterClient";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { resolveRelationshipMetaNames } from "@/lib/relationshipMetaCharacterName";
import { resolveRpDiagnosticCanary } from "@/lib/rpDiagnosticCanary";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  getSceneDirectiveV2Mode,
  materializeSceneDirectivePromptBlock,
  resolveScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import { buildSceneMomentumInputFromRoute } from "@/lib/sceneMomentum/routeInput";
import {
  applyStatusWidgetSystemPromptOverrides,
  patchOpenRouterSplitForStatusWidget,
} from "@/lib/statusWidget/promptOverrides";
import {
  resolveStatusWidgetTurn,
  statusWidgetModeForDefinitions,
} from "@/lib/statusWidget/resolve";
import { resolveSubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import { estimateTokens, estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import {
  parseAllowedConsentModes,
  parseModelRouteState,
  resolveEffectiveConsentMode,
} from "@/lib/adultSceneRouting";
import { selectedAIProvider } from "@/lib/chatModels";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  assembleNextTurnContextBuildInput,
  prepareNextTurnHistory,
  type NextTurnCharacterRow,
} from "@/services/nextTurnAssemblyPreparation";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import {
  RP_QUALITY_PRECALL_FIXTURE_STIMULUS,
  rpQualityPrecallBenchmarkModels,
  rpQualityPrecallFixtures,
  type RpQualityPrecallFixtureId,
  type RpQualityPrecallModelPlan,
  type RpQualityPrecallSizeRow,
} from "@/lib/rpQualityPrecall";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import {
  buildGreetingBodyCueReviewCases,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";
import { resolveBodyCueProductionTurn } from "./mainRpBodyCuePreflight";

/** The preflight owner infers a literal persona type; the runtime value is any persona name. */
type BodyCuePersonaName = Parameters<typeof resolveBodyCueProductionTurn>[1];

/** A fresh chat has no id yet. One placeholder keeps all 12 plans comparable. */
export const PRECALL_PLACEHOLDER_CHAT_ID = 1;
export const PRECALL_REVIEW_SESSION_ID = `chat-${PRECALL_PLACEHOLDER_CHAT_ID}`;

export type PrecallCharacterRow = NextTurnCharacterRow & {
  creator_raw_description?: string | null;
};

export type PrecallPersonaRow = {
  id: number;
  name: string;
  gender: string;
  description: string;
  active_status_widget_preset_id?: number | null;
  active_status_widget_json?: string | null;
};

export type PrecallUserRow = {
  id: number;
  nickname: string;
  user_note?: string | null;
  sub_until?: string | null;
  sub_plan?: string | null;
};

export type PrecallAssemblyRows = {
  character: PrecallCharacterRow;
  persona: PrecallPersonaRow;
  user: PrecallUserRow;
  creatorLorebookAttachments: number;
  globalLorebook: readonly GlobalLorebookEntryRow[];
};

export class PrecallAssemblyStop extends Error {
  constructor(
    readonly code:
      | "SCENE_PACING_OWNER_NOT_LEGACY_V1"
      | "RP_DIAGNOSTIC_CANARY_ACTIVE"
      | "CREATOR_LOREBOOK_ATTACHED_UNSUPPORTED"
      | "WIRE_MODEL_MISMATCH"
      | "MAX_TOKENS_PRESENT"
      | "HISTORY_SHAPE_DRIFT"
  ) {
    super(code);
    this.name = "PrecallAssemblyStop";
  }
}

export type PrecallSectionSize = {
  id: string;
  category: string;
  cacheBucket: "rules" | "character" | "dynamic" | "userTurn" | "unplaced";
  chars: number;
  estimatedTokens: number;
  sha256: string;
};

export type PrecallAdapterMetadata = {
  provider: RpQualityPrecallModelPlan["provider"];
  wireModel: string;
  transportProvider: "openrouter" | "cheaperinference";
  cacheRepresentation: "structured_blocks_with_cache_control" | "flat_string_system";
  systemBlockCount: number;
  cachedSystemBlockCount: number;
  historyCacheBreakpoint: boolean;
  assistantPrefill: boolean;
  requestBodyKeys: readonly string[];
  maxTokensPresent: boolean;
  temperaturePresent: boolean;
  reasoning: unknown;
  reasoningEffort: unknown;
  providerOnly: string | null;
  serviceTier: unknown;
  sessionIdPresent: boolean;
  stream: unknown;
};

export type PrecallCanonMetadata = {
  rolloutStage: string;
  injectionEnabled: boolean;
  canaryActualInjection: boolean;
  actualCanonMode: string;
  actualArchiveMode: string;
  compileSource: string | null;
  sourceHashStatus: string | null;
  planPresent: boolean;
};

export type PrecallFinalWirePlan = {
  fixtureId: RpQualityPrecallFixtureId;
  stimulusId: string;
  canonicalId: string;
  displayLabel: string;
  semanticFingerprint: string;
  finalWireFingerprint: string;
  adapter: PrecallAdapterMetadata;
  canon: PrecallCanonMetadata;
  size: RpQualityPrecallSizeRow;
  sections: readonly PrecallSectionSize[];
  statusWidgetActive: boolean;
  scenePacingOwner: "legacy_v1";
  historyRoles: readonly string[];
};

export type PrecallSectionDifference = {
  sectionId: string;
  distinctVariants: number;
  modelGroups: readonly (readonly string[])[];
};

export type PrecallSemanticParity = {
  fixtureId: RpQualityPrecallFixtureId;
  semanticFingerprintIdentical: boolean;
  semanticFingerprint: string;
  identicalSectionCount: number;
  sectionsOnlyInSomeModels: readonly string[];
  differingSections: readonly PrecallSectionDifference[];
  finalWireFingerprintsDistinct: number;
};

export type PrecallFinalWireReport = {
  plans: readonly PrecallFinalWirePlan[];
  parity: readonly PrecallSemanticParity[];
  assembly: {
    historyOpening: "CURRENT_GREETING";
    historyShape: readonly string[];
    scenePacingOwner: "legacy_v1";
    sceneDirectiveV2Mode: string;
    memoryFeatureOn: boolean;
    knownGaps: readonly string[];
  };
};

const KNOWN_GAPS = [
  "fresh chat: no revealed persona facts",
  "fresh chat: no long/medium/archive/episodic memory",
  "fresh chat: no user_chat lorebook rows",
  "fresh chat: no triggered scenario events",
  "fresh chat: no scene progression history",
  "chat id is a placeholder, so session_id is a placeholder",
  "cheaper-inference live catalog refresh is not run (no network)",
  "keyword lorebook creator attachments are 0 on the live row",
] as const;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function messageText(message: OpenRouterChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => block.text).join("\n\n");
}

function locateBucket(
  text: string,
  split: OpenRouterSystemSplit | undefined
): PrecallSectionSize["cacheBucket"] {
  const needle = text.trim();
  if (!split || !needle) return "unplaced";
  const hits: PrecallSectionSize["cacheBucket"][] = [];
  if (split.systemRulesBlock.includes(needle)) hits.push("rules");
  if (split.characterSettingsBlock.includes(needle)) hits.push("character");
  if (split.dynamicBlock.includes(needle)) hits.push("dynamic");
  return hits.length === 1 ? hits[0]! : "unplaced";
}

function buildAdapterMetadata(
  model: RpQualityPrecallModelPlan,
  messages: readonly OpenRouterChatMessage[],
  body: Record<string, unknown>
): PrecallAdapterMetadata {
  const system = messages.find((message) => message.role === "system");
  const blocks = system && Array.isArray(system.content) ? system.content : [];
  const provider = body.provider as { only?: string[] } | undefined;
  const last = messages[messages.length - 1];
  return {
    provider: model.provider,
    wireModel: model.wireModel,
    transportProvider: model.provider === "openrouter" ? "openrouter" : "cheaperinference",
    cacheRepresentation: blocks.length > 0 ? "structured_blocks_with_cache_control" : "flat_string_system",
    systemBlockCount: blocks.length || (system ? 1 : 0),
    cachedSystemBlockCount: blocks.filter((block) => block.cache_control?.type === "ephemeral").length,
    historyCacheBreakpoint: messages.slice(1).some(
      (message) =>
        Array.isArray(message.content) && message.content.some((block) => block.cache_control)
    ),
    assistantPrefill: last?.role === "assistant",
    requestBodyKeys: Object.keys(body).sort(),
    maxTokensPresent: "max_tokens" in body || "max_completion_tokens" in body,
    temperaturePresent: "temperature" in body,
    reasoning: body.reasoning ?? null,
    reasoningEffort: body.reasoning_effort ?? null,
    providerOnly: provider?.only?.[0] ?? null,
    serviceTier: body.service_tier ?? null,
    sessionIdPresent: "session_id" in body,
    stream: body.stream ?? null,
  };
}

function semanticInputFingerprint(input: ContextBuildInput): string {
  const { modelId: _modelId, provider: _provider, canonInjectionPolicy: _policy, ...rest } = input;
  return sha256Json(rest);
}

function buildMemoryDb(
  rows: PrecallAssemblyRows
): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, creator_canon_plan_json TEXT);
    CREATE TABLE global_lorebook_entries (
      id INTEGER PRIMARY KEY, name TEXT, triggers_json TEXT, content TEXT,
      depth INTEGER, enabled INTEGER, sort_order INTEGER
    );
  `);
  db.prepare("INSERT INTO characters (id, creator_canon_plan_json) VALUES (?, ?)").run(
    rows.character.id,
    rows.character.creator_canon_plan_json ?? null
  );
  const insert = db.prepare(
    `INSERT INTO global_lorebook_entries
     (id, name, triggers_json, content, depth, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of rows.globalLorebook) {
    insert.run(
      entry.id,
      entry.name,
      entry.triggers_json,
      entry.content,
      entry.depth,
      entry.enabled,
      entry.sort_order
    );
  }
  return db;
}

type FixtureTurn = {
  caseData: CanonicalQualificationCase;
  stimulusId: string;
};

export function assertGreetingHistoryShape(
  history: readonly ChatMsg[],
  greeting: string,
  personaName: string,
  userNickname: string
): void {
  const expectedOpening = replaceUserPlaceholder(greeting.trim(), personaName, userNickname);
  const ok =
    history.length === 2 &&
    history[0]?.role === "user" &&
    history[0].content === OPENING_TURN_USER &&
    history[1]?.role === "assistant" &&
    history[1].content.trim() === expectedOpening;
  if (!ok) throw new PrecallAssemblyStop("HISTORY_SHAPE_DRIFT");
}

export function assemblePrecallFinalWire(
  rows: PrecallAssemblyRows,
  models: readonly RpQualityPrecallModelPlan[] = rpQualityPrecallBenchmarkModels()
): PrecallFinalWireReport {
  const { character, persona, user } = rows;
  if (rows.creatorLorebookAttachments > 0) {
    throw new PrecallAssemblyStop("CREATOR_LOREBOOK_ATTACHED_UNSUPPORTED");
  }
  const personaName = persona.name.trim();
  const userNickname = user.nickname.trim() || personaName;
  const greeting = String(character.greeting ?? "");
  const memoryDb = buildMemoryDb(rows);
  const productionUser = {
    id: user.id,
    nickname: userNickname,
    sub_until: user.sub_until ?? null,
    sub_plan: user.sub_plan ?? null,
  } as unknown as User;
  const memoryCapability = resolveSubscriptionMemoryCapability(productionUser);
  const memoryFeatureOn = isMemoryFeatureEnabled();
  const effectiveUserNote = user.user_note?.trim() ?? "";
  const userNotePrompt = formatUserNoteForPrompt(effectiveUserNote, memoryCapability.focusMaxChars);
  const personaGender = resolveCharacterGender(persona.gender);
  const personaDescription = toPublicPersonaDescription(persona.description ?? "");

  const { chunks: characterChunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(character.id),
      name: String(character.name),
      gender: String(character.gender ?? ""),
      system_prompt: String(character.system_prompt ?? ""),
      world: String(character.world ?? ""),
      example_dialog: String(character.example_dialog ?? ""),
      setting_chunks: String(character.setting_chunks ?? ""),
      setting_chunks_en: String(character.setting_chunks_en ?? ""),
      prompt_translation_hash: String(character.prompt_translation_hash ?? ""),
      speech_profile: String(character.speech_profile ?? ""),
      creator_compiled_description_json: String(character.creator_compiled_description_json ?? ""),
      appearance_raw: String(character.appearance_raw ?? ""),
      appearance_compiled: String(character.appearance_compiled ?? ""),
    },
    personaName,
    userNickname
  );
  const characterGenres = sanitizeCharacterGenres(
    (() => {
      try {
        return JSON.parse(String(character.genres || "[]")) as unknown;
      } catch {
        return [];
      }
    })()
  );
  const assetTags = [
    ...new Set(chatAssets(parseAssets(String(character.assets ?? "[]"))).map((a) => a.tag)),
  ];
  const settingText = collectCharacterSettingText(characterChunks);
  const exampleDialog = resolveExampleDialogForPrompt(
    String(character.example_dialog ?? ""),
    String(character.name)
  );
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: character.name,
    systemPrompt: String(character.system_prompt ?? ""),
    chunks: characterChunks,
    userName: personaName,
  });
  const relationshipMemoryForPrompt = memoryFeatureOn
    ? (formatMemoryMetaForPrompt(
        normalizeMemoryMeta(parseMemoryMeta(null), relationshipNames)
      ) ?? "")
    : "";
  const statusWidgetEngineMode = statusWidgetModeForDefinitions({
    characterWidgetJson: character.status_widget_json,
    personaWidgetJson: persona.active_status_widget_json ?? "",
    characterAllowUserOverride: character.status_widget_allow_user_override !== 0,
  });
  const statusWidgetTurn = resolveStatusWidgetTurn({
    characterWidgetJson: character.status_widget_json,
    chatMode: statusWidgetEngineMode,
    userWidgetJson: persona.active_status_widget_json ?? "",
    stackOrder: null,
    displayMode: null,
    characterAllowUserOverride: character.status_widget_allow_user_override !== 0,
  });
  const contentKind = character.content_kind === "simulation" ? "simulation" : "character";
  const narrativePov = resolveNarrativePov({
    mode: null,
    contentKind,
    mainCharacterName: character.name,
    povCharacterName: null,
  });
  const privateSpeechControlBlock = buildPrivateSpeechControlBlock(
    parseCreatorDescriptionCompiled(character.creator_compiled_description_json)
  );

  const dialogueTurns = messagesToTurns([
    { role: "assistant", content: greeting, model: "greeting" },
  ]);
  const playableTurnCount = countPlayableTurns(dialogueTurns);
  const fixtureTurns: FixtureTurn[] = rpQualityPrecallFixtures().map((fixture) => {
    const [caseData] = buildGreetingBodyCueReviewCases(greeting, [fixture.stimulusId]);
    if (!caseData) throw new Error(`missing stimulus for ${fixture.id}`);
    return { caseData, stimulusId: fixture.stimulusId };
  });

  const plans: PrecallFinalWirePlan[] = [];
  let historyShape: readonly string[] = [];
  const v2Mode = getSceneDirectiveV2Mode();

  for (const fixtureTurn of fixtureTurns) {
    const fixtureId = (Object.keys(RP_QUALITY_PRECALL_FIXTURE_STIMULUS) as RpQualityPrecallFixtureId[]).find(
      (id) => RP_QUALITY_PRECALL_FIXTURE_STIMULUS[id] === fixtureTurn.stimulusId
    );
    if (!fixtureId) throw new Error(`unmapped stimulus ${fixtureTurn.stimulusId}`);
    const storedUserMessage = fixtureTurn.caseData.currentUserMessage;
    const turn = resolveBodyCueProductionTurn(
      storedUserMessage,
      personaName as BodyCuePersonaName,
      userNickname as BodyCuePersonaName
    );
    if (classifyChatOocIntent(storedUserMessage) !== turn.intent) {
      throw new Error("OOC intent drift");
    }
    const policyUserMessage = turn.policyUserMessage;
    const userPersona = formatPublicPersonaForPrompt(personaName, personaGender, personaDescription, {
      coNarrationEnabled: turn.delegation.allowDialogue === true,
    });
    const statusWidgetActive =
      statusWidgetTurn.active && !chatInputSuppressesStatusWidget(storedUserMessage);

    for (const model of models) {
      const wireModel = resolveMainRpPrimaryWireModelId(model.canonicalId);
      if (wireModel !== model.wireModel || selectedAIProvider(model.canonicalId) !== model.provider) {
        throw new PrecallAssemblyStop("WIRE_MODEL_MISMATCH");
      }
      const preparedHistory = prepareNextTurnHistory({
        turns: dialogueTurns,
        modelId: wireModel,
        provider: model.provider === "cheaperinference" ? "openrouter" : model.provider,
        memoryFeatureOn,
        completedTurnsForMemoryCoverage: playableTurnCount,
        summarizedTurnCount: 0,
        personaDisplayName: personaName,
        userNickname,
      });
      const promptHistory = preparedHistory.promptHistory;
      assertGreetingHistoryShape(promptHistory, greeting, personaName, userNickname);
      historyShape = promptHistory.map((message) => message.role);

      const canaryProbe = resolveRpDiagnosticCanary({
        userId: user.id,
        modelId: wireModel,
        contentKind,
      });
      if (canaryProbe) throw new PrecallAssemblyStop("RP_DIAGNOSTIC_CANARY_ACTIVE");

      const canonInjectionPolicy = resolveCanonInjectionPolicy(wireModel, {
        userId: user.id,
        chatId: PRECALL_PLACEHOLDER_CHAT_ID,
      });
      const canonLazy = shouldRunCanonInjectionSideEffects(canonInjectionPolicy)
        ? ensureCanonPlanOnAccess(memoryDb, character.id, {
            creator_raw_description: character.creator_raw_description,
            creator_canon_plan_json: character.creator_canon_plan_json,
            world: character.world,
            system_prompt: character.system_prompt,
          })
        : null;

      const globalLorebookScanText = [policyUserMessage, userNotePrompt, userPersona, settingText]
        .filter(Boolean)
        .join("\n");
      const globalLorebookBlock = loadGlobalLorebookPromptBlock(
        memoryDb,
        globalLorebookScanText,
        globalLorebookScanText
      );

      const legacySceneDirective = buildSceneDirective({
        mode: "interactive",
        recentMessages: promptHistory,
        currentUserMessage: policyUserMessage,
        memoryText: "",
        relationshipMemoryText: relationshipMemoryForPrompt,
        lorebookText: globalLorebookBlock,
        triggeredEventText: undefined,
        chatId: PRECALL_PLACEHOLDER_CHAT_ID,
        currentTurn: playableTurnCount + 1,
        progressionHistory: [],
        contentKind,
        primaryCharacterName: character.name,
        establishedActiveCastNames: undefined,
      });
      const scenePacingOwner = resolveScenePacingPromptOwner({
        v2Mode,
        livingEnabled: isLivingSceneDirectiveV2EnabledForUser(user.id, model.canonicalId),
      });
      if (scenePacingOwner !== "legacy_v1") {
        throw new PrecallAssemblyStop("SCENE_PACING_OWNER_NOT_LEGACY_V1");
      }
      const sceneDirectiveBlock = materializeSceneDirectivePromptBlock({
        scenePacingOwner,
        v2Block: null,
        livingBlock: null,
        legacyBlock: renderSceneDirectiveForPrompt(legacySceneDirective),
      });
      const sceneMomentumInput = buildSceneMomentumInputFromRoute({
        shortTermHistory: promptHistory,
        currentUserMessage: policyUserMessage,
        normalizedMemoryMeta: memoryFeatureOn
          ? normalizeMemoryMeta(parseMemoryMeta(null), relationshipNames)
          : null,
      });
      const activeConsentMode = resolveEffectiveConsentMode({
        requested: undefined,
        previous: parseModelRouteState(null).activeConsentMode,
        currentInput: storedUserMessage,
        allowedConsentModes: parseAllowedConsentModes(character.adult_consent_modes_json),
      });

      const contextBuildInput = assembleNextTurnContextBuildInput({
        character,
        user: { id: user.id, nickname: userNickname },
        chatId: PRECALL_PLACEHOLDER_CHAT_ID,
        chunks: characterChunks,
        exampleDialog,
        userPersona,
        revealedPersonaFactsBlock: undefined,
        userNote: userNotePrompt,
        longTermMemory: "",
        mediumTermMemoryBlock: "",
        archiveMemory: "",
        history: { ...preparedHistory, promptHistory, completedTurns: playableTurnCount },
        shortTermHistory: promptHistory,
        currentUserMessage: turn.promptUserMessage,
        currentTurnAuthoringDelegation: turn.delegation,
        nsfw: false,
        activeConsentMode,
        assetTags,
        modelId: wireModel,
        novelModeEnabled: false,
        runtimeMode: turn.runtimeMode,
        personaDisplayName: personaName,
        targetResponseChars: UNIFIED_TIER_AIM_CHARS,
        userPersonaGender: personaGender,
        genres: characterGenres,
        useEnglishCharacterPrompt: usedEnglish,
        isContinue: false,
        regenerate: false,
        sections: {
          narrativePov,
          statusWidgetActive,
          keywordLorebookBlock: "",
          userLorebookBlock: "",
          globalLorebookBlock,
          relationshipMemory: relationshipMemoryForPrompt,
          privateSpeechControlBlock: privateSpeechControlBlock || "",
          jsxComponentCatalogJson: character.jsx_components_json ?? "",
          creatorNarrationStyle: character.narration_style_instructions ?? "",
          focusMaxChars: memoryCapability.focusMaxChars,
        },
        canonInjectionPolicy,
        canonPlan: canonLazy?.plan ?? null,
        sceneMomentumInput,
        sceneDirectiveBlock,
        scenePacingPromptOwner: scenePacingOwner,
        adultHandoffRequiredTurnFloor: 0,
        provider: "openrouter",
      });

      const built = buildContext({
        ...contextBuildInput,
        statusWidgetActive,
        mainModelOwnsRelationshipExtract: false,
      });
      let system = built.systemPrompt;
      let split = built.openRouterSystemSplit;
      if (statusWidgetActive) {
        system = applyStatusWidgetSystemPromptOverrides(system);
        if (split) split = patchOpenRouterSplitForStatusWidget(split);
      }

      const transportProvider = model.provider === "cheaperinference" ? "cheaperinference" : "openrouter";
      const messageOpts: OpenRouterMessageOpts = {
        charName: character.name,
        personaName,
        systemSplit: split,
        sessionId: PRECALL_REVIEW_SESSION_ID,
        ...(transportProvider === "cheaperinference"
          ? { transportProvider: "cheaperinference" as const }
          : {}),
        sceneServerControls: {
          mode: "interactive",
          contentKind,
          party: false,
          primaryCharacterName: character.name,
          currentUserMessage: policyUserMessage,
          recentMessages: promptHistory,
          knownSupportingCastNames: undefined,
          establishedActiveCastNames: undefined,
          memoryText: undefined,
          relationshipMemoryText: relationshipMemoryForPrompt || undefined,
          lorebookText: globalLorebookBlock || undefined,
          triggeredEventText: undefined,
          adultModeEnabled: false,
          chatId: PRECALL_PLACEHOLDER_CHAT_ID,
          currentTurn: playableTurnCount + 1,
          progressionHistory: [],
          canonicalSceneDirective: legacySceneDirective,
          skipMotionCue: contentKind === "simulation",
        },
      };
      const requestHistory = convertToOpenRouterFormat(built.history);
      const baseMessages = buildOpenRouterMessages(system, requestHistory, messageOpts);
      const cached = applyCacheAndPrefillForTransport(
        { provider: transportProvider },
        baseMessages,
        wireModel,
        character.name,
        { skipAssistantPrefill: false }
      );
      const assembled = assemblePrimaryRpRequest({
        system,
        history: requestHistory,
        modelId: wireModel,
        targetResponseChars: UNIFIED_TIER_AIM_CHARS,
        messageOpts,
        stream: true,
        messagesOverride: cached.messages,
      });
      const adapter = buildAdapterMetadata(model, assembled.messages, assembled.requestBody);
      if (adapter.maxTokensPresent) throw new PrecallAssemblyStop("MAX_TOKENS_PRESENT");

      const totalInputChars = assembled.messages.reduce(
        (sum, message) => sum + messageText(message).length,
        0
      );
      const systemMessage = assembled.messages.find((message) => message.role === "system");
      const systemChars = systemMessage ? messageText(systemMessage).length : 0;
      const lastUser = String(built.history.at(-1)?.content ?? "");
      const sections: PrecallSectionSize[] = (built.meta.trackedSections ?? []).map((section) => ({
        id: section.id,
        category: section.category,
        cacheBucket: locateBucket(section.text, split),
        chars: section.text.length,
        estimatedTokens: estimateTokens(section.text),
        sha256: sha256(section.text),
      }));
      sections.push({
        id: "current-user-turn",
        category: "recentConversation",
        cacheBucket: "userTurn",
        chars: lastUser.length,
        estimatedTokens: estimateTokens(lastUser),
        sha256: sha256(lastUser),
      });

      plans.push({
        fixtureId,
        stimulusId: fixtureTurn.stimulusId,
        canonicalId: model.canonicalId,
        displayLabel: model.displayLabel,
        semanticFingerprint: semanticInputFingerprint(contextBuildInput),
        finalWireFingerprint: sha256Json({
          messages: assembled.messages,
          body: assembled.requestBody,
        }),
        adapter,
        canon: {
          rolloutStage: canonInjectionPolicy.rolloutStage,
          injectionEnabled: canonInjectionPolicy.injectionEnabled,
          canaryActualInjection: canonInjectionPolicy.canaryActualInjection,
          actualCanonMode: canonInjectionPolicy.actualCanonMode,
          actualArchiveMode: canonInjectionPolicy.actualArchiveMode,
          compileSource: canonLazy?.compileSource ?? null,
          sourceHashStatus: canonLazy?.sourceHashStatus ?? null,
          planPresent: Boolean(canonLazy?.plan),
        },
        size: {
          fixtureId,
          canonicalId: model.canonicalId,
          totalInputChars,
          estimatedInputTokens: estimateTokensFromCharCount(totalInputChars),
          systemChars,
          systemEstimatedTokens: estimateTokensFromCharCount(systemChars),
          currentUserTurnChars: lastUser.length,
          historyMessageCount: promptHistory.length,
          tokenEstimator: "ceil(chars * 0.9)",
          providerCountedTokens: null,
        },
        sections,
        statusWidgetActive,
        scenePacingOwner,
        historyRoles: promptHistory.map((message) => message.role),
      });
    }
  }

  memoryDb.close();
  if (plans.length !== models.length * fixtureTurns.length) {
    throw new Error(`expected ${models.length * fixtureTurns.length} plans, got ${plans.length}`);
  }
  return {
    plans,
    parity: buildParity(plans),
    assembly: {
      historyOpening: "CURRENT_GREETING",
      historyShape,
      scenePacingOwner: "legacy_v1",
      sceneDirectiveV2Mode: v2Mode,
      memoryFeatureOn,
      knownGaps: KNOWN_GAPS,
    },
  };
}

export function buildParity(
  plans: readonly PrecallFinalWirePlan[]
): PrecallSemanticParity[] {
  const fixtureIds = [...new Set(plans.map((plan) => plan.fixtureId))];
  return fixtureIds.map((fixtureId) => {
    const rows = plans.filter((plan) => plan.fixtureId === fixtureId);
    const semantic = new Set(rows.map((row) => row.semanticFingerprint));
    const sectionIds = [...new Set(rows.flatMap((row) => row.sections.map((s) => s.id)))];
    const onlySome: string[] = [];
    const differing: PrecallSectionDifference[] = [];
    let identical = 0;
    for (const sectionId of sectionIds) {
      const present = rows.filter((row) => row.sections.some((s) => s.id === sectionId));
      if (present.length !== rows.length) {
        onlySome.push(sectionId);
        continue;
      }
      const byHash = new Map<string, string[]>();
      for (const row of present) {
        const hash = row.sections.find((s) => s.id === sectionId)!.sha256;
        byHash.set(hash, [...(byHash.get(hash) ?? []), row.canonicalId]);
      }
      if (byHash.size === 1) identical += 1;
      else {
        differing.push({
          sectionId,
          distinctVariants: byHash.size,
          modelGroups: [...byHash.values()],
        });
      }
    }
    return {
      fixtureId,
      semanticFingerprintIdentical: semantic.size === 1,
      semanticFingerprint: [...semantic][0] ?? "",
      identicalSectionCount: identical,
      sectionsOnlyInSomeModels: onlySome,
      differingSections: differing,
      finalWireFingerprintsDistinct: new Set(rows.map((row) => row.finalWireFingerprint)).size,
    };
  });
}
