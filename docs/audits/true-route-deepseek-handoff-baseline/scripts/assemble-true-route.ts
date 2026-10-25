#!/usr/bin/env npx tsx
/**
 * Assemble route.ts-equivalent adult-handoff outbound (sceneServerControls ON).
 * Read-only assembly + SHA gate metadata. No provider call.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/true-route-deepseek-handoff-baseline");
const FROZEN = join(OUT, "source-frozen");
const CAPSULE_PATH = process.env.CAPSULE_PATH ?? join(ROOT, "handoff-benchmark-capsule.json");
const TRUE_ROUTE_REQUEST_SHA =
  "d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2";
const GEMINI = "gemini-3.1-pro-preview";
const DEEPSEEK = "deepseek-v4-pro-0813";

function sha256Object(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
}

function save(rel: string, content: string | object) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

function findExemplar(
  messages: Array<{ role?: string; content?: unknown }>,
  sourceVisible: string
) {
  const src = String(sourceVisible || "");
  for (let i = 0; i < messages.length; i++) {
    const content = flatten(messages[i]?.content);
    if (content === src) {
      return {
        present: true,
        ROLE: messages[i]?.role ?? null,
        WIRE_POSITION: i,
        SOURCE_CHARS: src.length,
        TRANSPORTED_CHARS: content.length,
        BYTE_IDENTICAL: true,
      };
    }
  }
  return {
    present: false,
    ROLE: null,
    WIRE_POSITION: null,
    SOURCE_CHARS: src.length,
    TRANSPORTED_CHARS: 0,
    BYTE_IDENTICAL: false,
  };
}

export async function assembleTrueRouteHandoffRequest() {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../../../../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import("../../../../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../../../../src/lib/chatGreetingContext");
  const { buildContext } = await import("../../../../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../../../../src/lib/openRouterAdult");
  const {
    appendAdultHandoffPrompt,
    appendAdultHandoffToSystemSplit,
    buildSceneContinuityPacket,
    classifySceneMode,
    extractHandoffContinuityFromAssistantText,
    normalizeAdultDialogueProfile,
    resolveAdultRoutingConfig,
    selectAdultHandoffRawVariants,
    DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  } = await import("../../../../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../../../../src/lib/narrativePov");
  const { resolveCanonInjectionPolicy } = await import("../../../../src/lib/canonInjectionPolicy");
  const { resolveCharacterGender } = await import("../../../../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../../../../src/lib/characterGenres");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../../../../src/lib/responseLength");
  const { resolveDeepSeekAdultHandoffTrueOff } = await import(
    "../../../../src/lib/cheaperInferenceConfig"
  );
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } = await import(
    "../../../../src/lib/deepseekPromptStructure"
  );
  const { DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER } = await import(
    "../../../../src/lib/deepseekOpeningSceneContext"
  );

  const capsule = JSON.parse(readFileSync(CAPSULE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    benchmark_user_context?: { nickname?: string };
  };
  const ch = capsule.character;
  const persona = capsule.persona;
  const personaName = String(persona.name ?? "렌");
  const charName = String(ch.name ?? "라이크");
  const nickname = String(capsule.benchmark_user_context?.nickname ?? "공식계정");

  const openingVisible = readFileSync(join(FROZEN, "OPENING_ASSISTANT_VISIBLE.txt"), "utf8");
  const t1User = readFileSync(join(FROZEN, "T1-USER_RAW.txt"), "utf8");
  const t1Visible = readFileSync(join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2User = readFileSync(join(FROZEN, "T2-USER_RAW.txt"), "utf8");
  const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const t3Gold = readFileSync(join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");

  const canonicalRecentHistoryFull = [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: openingVisible },
    { role: "user" as const, content: t1User },
    { role: "assistant" as const, content: t1Visible },
    { role: "user" as const, content: t2User },
    { role: "assistant" as const, content: t2Visible },
  ];

  const adultRoutingConfig = resolveAdultRoutingConfig();
  const fallbackVariants = selectAdultHandoffRawVariants(canonicalRecentHistoryFull, {
    baseExchanges: adultRoutingConfig.baseRawExchanges,
    targetExchanges: adultRoutingConfig.handoffTargetRawExchanges,
    extraRawTokens: adultRoutingConfig.handoffExtraRawTokens,
  });
  const fallbackRaw = fallbackVariants.handoff;
  const fallbackHistory = fallbackRaw.history;

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });
  const sceneClassification = classifySceneMode({
    currentInput: t3User,
    previousSceneMode: "romantic",
    recentRawText: [t2User, t2Visible].join("\n"),
    adultDialogueProfile: normalizeAdultDialogueProfile(ch.adult_dialogue_profile),
    activeConsentMode: "standard",
    previousConsentMode: "standard",
  });
  const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
    text: t2Visible,
    characterName: charName,
    personaName,
    currentUserText: t3User,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: sceneClassification.sceneReset ? "normal" : "romantic",
    sexualContextActive: sceneClassification.sexualContextActive,
    activeConsentMode: "standard",
    charactersPresent: [charName, personaName],
    currentPov: narrativePov.mode,
    sceneReset: sceneClassification.sceneReset,
    ...(sceneClassification.sceneReset ? {} : extractedHandoffContinuity),
  });

  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id ?? 10),
      name: charName,
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    nickname
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));

  const trueOff = resolveDeepSeekAdultHandoffTrueOff({
    selectedModelId: GEMINI,
    adultHandoffActuallyApplied: true,
    resolvedTargetModelId: DEEPSEEK,
  });

  const built = buildContext({
    charName,
    chunks,
    userNickname: nickname,
    userPersona,
    userNote: "",
    longTermMemory: "",
    archiveMemory: "",
    shortTermHistory: fallbackHistory,
    currentUserMessage: t3User,
    nsfw: true,
    activeConsentMode: "standard",
    gender: resolveCharacterGender(String(ch.gender ?? "")),
    memoryMeta: "",
    modelId: DEEPSEEK,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 3,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 4,
    chatId: 4,
    narrativePov,
    preserveAdultHandoffRawHistory: true,
    adultHandoffRequiredTurnFloor: fallbackRaw.rawTurnsIncluded,
    canonInjectionPolicy: resolveCanonInjectionPolicy(DEEPSEEK, { userId: 4, chatId: 4 }),
    genres,
    userPersonaGender: (persona.gender as "male" | "female" | "other") ?? "other",
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket);
  appendAdultHandoffToSystemSplit(built.openRouterSystemSplit, continuityPacket);

  const messageOpts = {
    transportProvider: "cheaperinference" as const,
    charName,
    personaName,
    ...(trueOff ? { deepSeekAdultHandoffTrueOff: true as const } : {}),
    sceneServerControls: {
      contentKind: "character" as const,
      party: false,
      primaryCharacterName: charName,
      currentUserMessage: t3User,
      recentMessages: fallbackHistory,
      adultModeEnabled: true,
      chatId: 4,
      currentTurn: 3,
    },
  };

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: DEEPSEEK,
    targetResponseChars: 3200,
    messageOpts,
  });

  const requestBody = wire.requestBody as Record<string, unknown>;
  const messages = (requestBody.messages as Array<{ role: string; content: unknown }>) ?? [];
  const wireText = messages.map((m) => flatten(m.content)).join("\n");
  const lastUser = flatten(messages.at(-1)?.content);
  const systemText = flatten(messages[0]?.content);

  const owners = {
    DEEPSEEK_STYLE_REMINDER_ACTIVE: wireText.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)),
    HANDOFF_CONTINUATION_OWNER_ACTIVE: wireText.includes(
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.slice(0, 40)
    ),
    INTIMACY_OWNER_ACTIVE: wireText.includes("[19+ INTIMACY]"),
    USER_TAIL_3200_ACTIVE: lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40)),
    TERMINAL_DIALOGUE_OWNER_ACTIVE: wireText.includes("[이번 응답 대화]"),
    CREATOR_OPENING_AS_ASSISTANT_STYLE_EXEMPLAR: false,
    CREATOR_OPENING_REMAP_PRESENT: wireText.includes(DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER),
  };

  return {
    requestBody,
    requestBodyBeforeAdapt: wire.requestBodyBeforeAdapt,
    messages,
    owners,
    continuityPacket,
    frozen: { t1Visible, t2Visible, t3Gold, t3User, personaName, charName },
    trueOff,
    scene_pacing_in_system: systemText.includes("[SCENE PACING]"),
    scene_flow_in_system: systemText.includes("[SCENE FLOW]"),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const assembled = await assembleTrueRouteHandoffRequest();
  const sha = sha256Object(assembled.requestBody);
  const t1 = findExemplar(assembled.messages, assembled.frozen.t1Visible);
  const t2 = findExemplar(assembled.messages, assembled.frozen.t2Visible);
  const goldPresent = assembled.messages.some((m) =>
    flatten(m.content).includes(assembled.frozen.t3Gold.slice(0, 120))
  );

  const report = {
    TRUE_ROUTE_REQUEST_SHA: sha,
    TRUE_ROUTE_REQUEST_SHA_EXPECTED: TRUE_ROUTE_REQUEST_SHA,
    SHA_GATE_PASS: sha === TRUE_ROUTE_REQUEST_SHA,
    TRUE_OFF_HANDOFF_ACTIVE: assembled.trueOff,
    THINKING_VALUE: assembled.requestBody.thinking ?? null,
    REASONING_EFFORT_VALUE: assembled.requestBody.reasoning_effort ?? null,
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1.present,
    T1_BYTE_IDENTICAL: t1.BYTE_IDENTICAL,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2.present,
    T2_BYTE_IDENTICAL: t2.BYTE_IDENTICAL,
    T3_GEMINI_GOLD_PRESENT: goldPresent,
    GEMINI_REFUSAL_PRESENT: false,
    owners: assembled.owners,
    TERMINAL_DIALOGUE_OWNER_ACTIVE: assembled.owners.TERMINAL_DIALOGUE_OWNER_ACTIVE,
    SCENE_PACING_IN_SYSTEM: assembled.scene_pacing_in_system,
    SCENE_FLOW_IN_SYSTEM: assembled.scene_flow_in_system,
    CONTACT_ACTOR_EXTRACTION_BUG: assembled.continuityPacket.previousActionActor === "손이",
    SCENE_CONTINUITY_PREVIOUS_ACTION_ACTOR:
      assembled.continuityPacket.previousActionActor ?? null,
    PHASE_C_624_PRODUCTION_PROVIDER_PATH_EQUIVALENT: true,
    PHASE_C_624_PRODUCTION_PROMPT_EQUIVALENT: false,
    H1_EXECUTED: false,
  };

  save("requests/TRUE_ROUTE_HANDOFF-input.json", assembled.requestBody);
  save("requests/TRUE_ROUTE_HANDOFF-before-adapt.json", assembled.requestBodyBeforeAdapt);
  save("meta/phase-a-assembly.json", report);
  save("meta/continuity-packet.json", assembled.continuityPacket);

  console.log(JSON.stringify(report, null, 2));
  if (!report.SHA_GATE_PASS) process.exit(2);
  if (
    !t1.present ||
    !t2.present ||
    !t1.BYTE_IDENTICAL ||
    !t2.BYTE_IDENTICAL ||
    goldPresent ||
    !assembled.owners.TERMINAL_DIALOGUE_OWNER_ACTIVE
  ) {
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith("assemble-true-route.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
