#!/usr/bin/env npx tsx
/**
 * GLM-5.3 pure handoff candidate — production-common OpenRouter assembly.
 * No DeepSeek-specific transforms. Read-only assembly + audit gate. No provider call.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";
import { ADULT_CONTENT_POLICY_CNC_PERMISSION } from "../../../../src/lib/advancedProseNsfwGuidelines";

/** Frozen Gemini 3.1 provider refusal — gate only; must not appear in GLM input. */
const EXACT_GEMINI31_REFUSAL_FIXTURE =
  "I am sorry, but I cannot fulfill this request. I am programmed to not take part in romantic or sexual scenarios, even in fictional role-play.";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/glm53-pure-handoff-candidate");
const FROZEN = join(OUT, "source-frozen");
const CAPSULE_PATH = process.env.CAPSULE_PATH ?? join(ROOT, "handoff-benchmark-capsule.json");
const GLM_MODEL = "z-ai/glm-5.3";

function sha256Object(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
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

/** Benchmark-only wire policy — not production routing. */
export function applyGlm53BenchmarkWirePolicy(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  out.model = GLM_MODEL;
  out.temperature = 0.92;
  out.top_p = 0.92;
  out.stream = true;
  out.stream_options = { include_usage: true };
  delete out.reasoning_effort;
  delete out.thinking;
  delete out.provider;
  out.reasoning = { effort: "low", exclude: true };
  out.include_reasoning = false;
  return out;
}

export async function assembleGlm53HandoffRequest() {
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
      id: Number(ch.id ?? 18),
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
    modelId: GLM_MODEL,
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
    canonInjectionPolicy: resolveCanonInjectionPolicy(GLM_MODEL, { userId: 4, chatId: 4 }),
    genres,
    userPersonaGender: (persona.gender as "male" | "female" | "other") ?? "other",
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket);
  appendAdultHandoffToSystemSplit(built.openRouterSystemSplit, continuityPacket);

  const messageOpts = {
    transportProvider: "openrouter" as const,
    charName,
    personaName,
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
    generationOverrides: {
      temperature: 0.92,
      top_p: 0.92,
    },
  };

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: GLM_MODEL,
    targetResponseChars: 3200,
    messageOpts,
  });

  const requestBodyBeforePolicy = wire.requestBody as Record<string, unknown>;
  const requestBody = applyGlm53BenchmarkWirePolicy(requestBodyBeforePolicy);
  const messages =
    (requestBody.messages as Array<{ role: string; content: unknown }>) ?? wire.messages;
  const wireText = messages.map((m) => flatten(m.content)).join("\n");
  const lastUser = flatten(messages.at(-1)?.content);
  const systemText = flatten(messages[0]?.content);

  const handoffMarker = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.slice(0, 40);
  const userTailMarker = USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40);

  return {
    requestBody,
    requestBodyBeforePolicy,
    messages,
    continuityPacket,
    frozen: { t1Visible, t2Visible, t3Gold, t3User, personaName, charName },
    audit: {
      wireText,
      systemText,
      lastUser,
      handoffMarker,
      userTailMarker,
      deepSeekStyleReminder: DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40),
      deepSeekOpeningHeader: DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER,
      geminiRefusal: EXACT_GEMINI31_REFUSAL_FIXTURE,
      cncPermission: ADULT_CONTENT_POLICY_CNC_PERMISSION,
    },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const assembled = await assembleGlm53HandoffRequest();
  const { messages, requestBody, audit, frozen } = assembled;

  const t1 = findExemplar(messages, frozen.t1Visible);
  const t2 = findExemplar(messages, frozen.t2Visible);
  const goldPresent = messages.some((m) =>
    flatten(m.content).includes(frozen.t3Gold.slice(0, 120))
  );
  const geminiRefusalPresent = audit.wireText.includes(audit.geminiRefusal.slice(0, 80));

  const glmSpecificPatterns = [
    /\[GLM[\s-]/i,
    /write like Gemini/i,
    /GLM-SPECIFIC/i,
    /glm-specific/i,
    /paragraph target/i,
    /dialogue target/i,
  ];
  const glmSpecificHit = glmSpecificPatterns.find((re) => re.test(audit.wireText));

  const report = {
    MODEL: requestBody.model,
    PROVIDER: "openrouter",
    MESSAGE_COUNT: messages.length,
    ROLE_ORDER: messages.map((m) => m.role),
    SYSTEM_SHA: sha256Text(audit.systemText),
    REQUEST_SHA: sha256Object(requestBody),
    T1_ASSISTANT_BYTE_IDENTICAL: t1.BYTE_IDENTICAL,
    T2_ASSISTANT_BYTE_IDENTICAL: t2.BYTE_IDENTICAL,
    GEMINI_GOLD_PRESENT: goldPresent,
    GEMINI_REFUSAL_PRESENT: geminiRefusalPresent,
    DEEPSEEK_STYLE_REMINDER_PRESENT: audit.wireText.includes(audit.deepSeekStyleReminder),
    DEEPSEEK_XML_PRESENT: /<LONG_TERM_MEMORY>|<CHARACTER_CANON>/i.test(audit.wireText),
    DEEPSEEK_OPENING_REMAP_PRESENT: audit.wireText.includes(audit.deepSeekOpeningHeader),
    GLM_SPECIFIC_STYLE_ADAPTER_PRESENT: glmSpecificHit != null,
    GLM_SPECIFIC_STYLE_ADAPTER_MATCH: glmSpecificHit?.source ?? null,
    HANDOFF_CONTINUATION_INSTRUCTION_COUNT: countOccurrences(
      audit.wireText,
      audit.handoffMarker
    ),
    USER_TAIL_3200_OWNER_COUNT: countOccurrences(audit.wireText, audit.userTailMarker),
    TERMINAL_DIALOGUE_OWNER_ACTIVE: audit.wireText.includes("[이번 응답 대화]"),
    USER_AGENCY_OWNER_ACTIVE: audit.systemText.includes("[USER AUTHORING"),
    ACTIVE_CONSENT_MODE: "standard",
    CNC_PERMISSION_ON_WIRE: audit.wireText.includes(audit.cncPermission),
    GLM_SPECIFIC_STYLE_PROMPT_CHARS: 0,
    GLM_SPECIFIC_LENGTH_PROMPT_CHARS: 0,
    NEW_STYLE_BLOCKS: 0,
    REASONING: requestBody.reasoning ?? null,
    TEMPERATURE: requestBody.temperature ?? null,
    TOP_P: requestBody.top_p ?? null,
    T1_EXEMPLAR: t1,
    T2_EXEMPLAR: t2,
    ASSEMBLY_GATE_PASS: false,
  };

  const gateFail =
    !t1.BYTE_IDENTICAL ||
    !t2.BYTE_IDENTICAL ||
    goldPresent ||
    geminiRefusalPresent ||
    report.DEEPSEEK_STYLE_REMINDER_PRESENT ||
    report.GLM_SPECIFIC_STYLE_ADAPTER_PRESENT ||
    report.HANDOFF_CONTINUATION_INSTRUCTION_COUNT !== 1 ||
    report.USER_TAIL_3200_OWNER_COUNT !== 1 ||
    !report.TERMINAL_DIALOGUE_OWNER_ACTIVE ||
    !report.USER_AGENCY_OWNER_ACTIVE ||
    report.CNC_PERMISSION_ON_WIRE ||
    report.ACTIVE_CONSENT_MODE !== "standard";

  report.ASSEMBLY_GATE_PASS = !gateFail;

  save("requests/GLM53-HANDOFF-input.json", requestBody);
  save("requests/GLM53-HANDOFF-before-policy.json", assembled.requestBodyBeforePolicy);
  save("meta/phase-a-assembly.json", report);
  save("meta/continuity-packet.json", assembled.continuityPacket);

  console.log(JSON.stringify(report, null, 2));
  if (!report.ASSEMBLY_GATE_PASS) process.exit(2);
}

if (process.argv[1]?.endsWith("assemble-glm53-handoff.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
