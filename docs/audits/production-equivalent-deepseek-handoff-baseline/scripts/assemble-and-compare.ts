#!/usr/bin/env npx tsx
/**
 * Phase A — read-only true production-handoff outbound assembly.
 * No provider call. No production runtime mutation.
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
const OUT = join(ROOT, "docs/audits/production-equivalent-deepseek-handoff-baseline");
const FROZEN = join(OUT, "source-frozen");
const CAPSULE_PATH = process.env.CAPSULE_PATH ?? join(ROOT, "handoff-benchmark-capsule.json");
const REQUEST_621_SHA =
  "85ae4e16ba3e002dc1dcd84911f3263c68679904e5d3316a0f365fd084003731";
const GEMINI = "gemini-3.1-pro-preview";
const DEEPSEEK = "deepseek-v4-pro-0813";

function sha256(text: string): string {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
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

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function findExemplar(
  messages: Array<{ role?: string; content?: unknown }>,
  sourceVisible: string
) {
  const src = String(sourceVisible || "");
  const srcNorm = normalizeWs(src);
  for (let i = 0; i < messages.length; i++) {
    const content = flatten(messages[i]?.content);
    if (
      content === src ||
      content.includes(src.slice(0, 80)) ||
      normalizeWs(content).includes(srcNorm.slice(0, 80))
    ) {
      return {
        present: true,
        ROLE: messages[i]?.role ?? null,
        WIRE_POSITION: i,
        SOURCE_CHARS: src.length,
        TRANSPORTED_CHARS: content.length,
        BYTE_IDENTICAL: content === src,
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

const CANONICAL_FIELDS = [
  "model",
  "messages",
  "temperature",
  "top_p",
  "max_tokens",
  "stream",
  "stream_options",
  "thinking",
  "reasoning_effort",
] as const;

function summarizeMessages(value: unknown) {
  if (!Array.isArray(value)) return { count: 0, roles: [] as string[] };
  return {
    count: value.length,
    roles: value.map((m) =>
      m && typeof m === "object" && "role" in m ? String((m as { role?: unknown }).role) : "?"
    ),
  };
}

function fieldDiff(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = Array.from(
    new Set([...CANONICAL_FIELDS, ...Object.keys(a), ...Object.keys(b)])
  );
  const rows: Array<{
    FIELD: string;
    REQUEST_621: unknown;
    TRUE_PRODUCTION: unknown;
    EQUAL: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const left = a[key];
    const right = b[key];
    rows.push({
      FIELD: key,
      REQUEST_621:
        key === "messages"
          ? summarizeMessages(left)
          : left === undefined
            ? null
            : left,
      TRUE_PRODUCTION:
        key === "messages"
          ? summarizeMessages(right)
          : right === undefined
            ? null
            : right,
      EQUAL: JSON.stringify(left) === JSON.stringify(right),
    });
  }
  const otherA = Object.keys(a).filter((k) => !CANONICAL_FIELDS.includes(k as (typeof CANONICAL_FIELDS)[number]));
  const otherB = Object.keys(b).filter((k) => !CANONICAL_FIELDS.includes(k as (typeof CANONICAL_FIELDS)[number]));
  rows.push({
    FIELD: "OTHER_FIELDS",
    REQUEST_621: otherA,
    TRUE_PRODUCTION: otherB,
    EQUAL: JSON.stringify(otherA) === JSON.stringify(otherB),
  });
  return rows;
}

function messageLevelDiff(
  left: Array<{ role?: string; content?: unknown }>,
  right: Array<{ role?: string; content?: unknown }>
) {
  const n = Math.max(left.length, right.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = flatten(left[i]?.content);
    const b = flatten(right[i]?.content);
    rows.push({
      INDEX: i,
      ROLE_621: left[i]?.role ?? null,
      ROLE_PROD: right[i]?.role ?? null,
      CHARS_621: a.length,
      CHARS_PROD: b.length,
      EQUAL: a === b,
    });
  }
  return rows;
}

export async function assembleTrueProductionHandoff() {
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

  // Hold the already-validated #621 message corpus and required owner freeze.
  // route.ts also passes sceneServerControls (SCENE FLOW→PACING + [이번 응답 대화]);
  // that delta is frozen separately and is not applied here.
  const messageOpts = {
    transportProvider: "cheaperinference" as const,
    charName,
    personaName,
    ...(trueOff ? { deepSeekAdultHandoffTrueOff: true as const } : {}),
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

  const owners = {
    DEEPSEEK_STYLE_REMINDER_ACTIVE: wireText.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)),
    HANDOFF_CONTINUATION_OWNER_ACTIVE: wireText.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.slice(0, 40)),
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
    systemPrompt,
    builtHistory: built.history,
    trueOff,
    owners,
    continuityPacket,
    frozen: { t1Visible, t2Visible, t3Gold, t3User },
    messageOpts,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const assembled = await assembleTrueProductionHandoff();
  const request621 = JSON.parse(
    readFileSync(join(FROZEN, "REQUEST_621.json"), "utf8")
  ) as Record<string, unknown>;
  const sha621 = sha256(JSON.stringify(request621));
  const shaProd = sha256(JSON.stringify(assembled.requestBody));
  const messages621 = (request621.messages as Array<{ role: string; content: unknown }>) ?? [];
  const messagesEqual =
    JSON.stringify(messages621) === JSON.stringify(assembled.messages);
  const t1 = findExemplar(assembled.messages, assembled.frozen.t1Visible);
  const t2 = findExemplar(assembled.messages, assembled.frozen.t2Visible);
  const goldPresent = assembled.messages.some((m) =>
    flatten(m.content).includes(assembled.frozen.t3Gold.slice(0, 120))
  );

  const diff = fieldDiff(request621, assembled.requestBody);
  const message_level_diff = messageLevelDiff(messages621, assembled.messages);
  const report = {
    REQUEST_621_SHA: sha621,
    REQUEST_621_SHA_EXPECTED: REQUEST_621_SHA,
    REQUEST_621_SHA_MATCHES_FROZEN: sha621 === REQUEST_621_SHA,
    TRUE_PRODUCTION_HANDOFF_REQUEST_SHA: shaProd,
    PRODUCTION_OUTBOUND_EQUIVALENT_TO_621: sha621 === shaProd,
    MESSAGES_BYTE_IDENTICAL: messagesEqual,
    TRUE_OFF_HANDOFF_ACTIVE: assembled.trueOff,
    THINKING_VALUE: assembled.requestBody.thinking ?? null,
    REASONING_EFFORT_VALUE: assembled.requestBody.reasoning_effort ?? null,
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1.present,
    T1: t1,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2.present,
    T2: t2,
    T3_GEMINI_GOLD_PRESENT: goldPresent,
    GEMINI_REFUSAL_PRESENT: false,
    owners: assembled.owners,
    CONTACT_ACTOR_EXTRACTION_BUG: assembled.continuityPacket.previousActionActor === "손이",
    SCENE_CONTINUITY_PREVIOUS_ACTION_ACTOR:
      assembled.continuityPacket.previousActionActor ?? null,
    field_diff: diff,
    message_level_diff,
    unexpected_message_diff: !messagesEqual,
    scene_controls_applied: false,
  };

  save("requests/TRUE_PRODUCTION_HANDOFF-input.json", assembled.requestBody);
  save("requests/TRUE_PRODUCTION_HANDOFF-before-adapt.json", assembled.requestBodyBeforeAdapt);
  save("meta/phase-a-outbound-equivalence.json", report);
  save("meta/continuity-packet.json", assembled.continuityPacket);

  const stop = !messagesEqual || !t1.present || !t2.present || goldPresent;
  if (stop) {
    save("meta/PHASE_A_STOP.json", {
      reason: !messagesEqual
        ? "MESSAGES_DIFFER_UNEXPECTEDLY"
        : "TRANSPORT_GATE_FAIL",
      report,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  if (stop) process.exit(2);
}

if (process.argv[1]?.endsWith("assemble-and-compare.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
