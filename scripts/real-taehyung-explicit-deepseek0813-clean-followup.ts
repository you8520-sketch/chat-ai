/**
 * PR #427 follow-up: DeepSeek 0813 CLEAN (2 calls) + Qwen production finalizer (0 calls).
 *
 * Reuses existing Opus/Gemini sources and Qwen RAW. Does not regenerate sources.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-deepseek0813-clean-followup.ts
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  PRODUCTION_LIKE_CHARACTER_ID,
  PRODUCTION_LIKE_REAL_NAME,
  isProductionLikeTaehyungRecord,
} from "../src/lib/likeTaehyungIdentity";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/real-taehyung-explicit-qwen38-vs-deepseek0813";
const LIVE_ROOT = join(OUT_ROOT, "live");
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");

const DEEPSEEK_REQUESTED = "deepseek-v4-pro-0813";
const DEEPSEEK_ASSEMBLE = "deepseek-v4-pro";
const QWEN_REQUESTED = "qwen-3-8-max";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}
function mustRead(path: string): string {
  if (!existsSync(path)) throw new Error(`MISSING_FILE:${path}`);
  return readFileSync(path, "utf8");
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.model === "string") state.resolved = ev.model;
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = Array.isArray(choices) ? choices[0] : null;
  const choice = choice0 && typeof choice0 === "object" ? choice0 : {};
  const delta = choice.delta as Record<string, unknown> | undefined;
  const message = choice.message as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof message?.content === "string"
        ? message.content
        : "";
  if (content) state.text += content;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finish = choice.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text();
    return {
      http_status: res.status,
      text: "",
      finish_reason: null,
      usage: null,
      resolved_model: null,
      saw_done: false,
      latency_s: (Date.now() - started) / 1000,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state);
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    saw_done: state.sawDone,
    latency_s: (Date.now() - started) / 1000,
    error: null as string | null,
  };
}

function extractUsage(usage: Record<string, unknown> | null) {
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const promptDetails =
    (usage?.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number" ? details.reasoning_tokens : null,
    cache_read_tokens:
      typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

function paragraphStats(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogue = paragraphs.filter((p) => /["“「『]/.test(p));
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: dialogue.length,
  };
}

function proseDiagnostics(text: string) {
  const stats = paragraphStats(text);
  const refusal =
    /I (can'?t|cannot|won't)|정책|이용 약관|요청을 수행할 수 없|성인 콘텐츠를 생성할 수 없/i.test(
      text
    );
  const fadeToBlack = /fade to black|페이드\s*(?:투\s*)?(?:블랙|아웃)|여기서 화면이 어두워/i.test(
    text
  );
  const evasive =
    /직접적인 묘사는 피|자세히 그리지 않|나머지 는 상상에 맡/i.test(text);
  const foreign =
    /[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9fff]{6,}|[A-Za-z]{40,}/.test(text) &&
    !/Aegis|Sentinel|Guide/.test(text);
  const explicitCont =
    /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|성기|음경|질\b|유두)/.test(text);
  let adultCapability = "OK";
  if (refusal || fadeToBlack) adultCapability = "ADULT_CAPABILITY_FAIL";
  else if (evasive || !explicitCont) adultCapability = "ADULT_CAPABILITY_DEGRADED";
  return {
    ...stats,
    refusal,
    fade_to_black: fadeToBlack,
    evasive_rewrite: evasive,
    scene_avoidance: evasive || fadeToBlack,
    meta_policy_response: refusal,
    foreign_language_contamination: foreign,
    explicitAdultContinuation: explicitCont,
    adult_capability: adultCapability,
  };
}

function agencyDiagnostic(text: string) {
  const userSpeech = /렌(?:이|은|가).{0,20}[“"][^”"]{8,}/.test(text);
  const consentForUser = /렌(?:이|은).{0,16}(?:허락|동의|승낙)(?:했|한다|했다)/.test(text);
  const emotionFact =
    /렌(?:이|은|의).{0,16}(?:쾌감|절정|오르가슴|원했|원했다)(?:을|를|이|가)?/.test(text);
  const longUserAction =
    /렌(?:이|은).{0,40}(?:스스로|먼저|자발적으로).{0,40}(?:했|한다|했다)/.test(text);
  const hits = [userSpeech, consentForUser, emotionFact, longUserAction].filter(Boolean).length;
  return {
    newUserDialogue: userSpeech,
    consentDecidedForUser: consentForUser,
    userEmotionFactForced: emotionFact,
    unpromptedUserActionChain: longUserAction,
    severeAgencyViolationCount: hits,
  };
}

type Fixtures = {
  character: Record<string, unknown>;
  persona: Record<string, unknown> | null;
};

function loadExistingFixtures(): Fixtures {
  if (!existsSync(FIXTURES_PATH)) {
    throw new Error("PRODUCTION_FIXTURES_MISSING");
  }
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Fixtures;
}

export async function assembleBundle(opts: {
  assembleModelId: string;
  requestModelId: string;
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  history: ChatMsg[];
  currentUserMessage: string;
  adultHandoff: boolean;
  deepSeekExtrasModeOverride?: "full" | "length_stack_only" | "off";
  qwenFragmentSentence?: string;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    appendAdultHandoffPrompt,
    buildSceneContinuityPacket,
    extractHandoffContinuityFromAssistantText,
    resolveAdultRoutingConfig,
    selectAdultHandoffRawVariants,
  } = await import("../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { adaptCheaperInferenceChatBody } = await import(
    "../src/lib/cheaperInferenceConfig"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const {
    DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
    DEEPSEEK_XML_TAGS,
  } = await import("../src/lib/deepseekPromptStructure");
  const { DEEPSEEK_APPEARANCE_VARIATION_RULE } = await import(
    "../src/lib/appearanceCompiler"
  );

  const ch = opts.character;
  const charName = String(ch.name);
  const personaName = String(opts.persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch._internalId ?? PRODUCTION_LIKE_CHARACTER_ID),
      name: charName,
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    personaName
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (opts.persona.gender as "male" | "female" | "other") ?? "other",
    String(opts.persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });

  let history = opts.history;
  let continuityPacket: unknown = null;
  let extractedHandoffContinuity: unknown = null;
  if (opts.adultHandoff) {
    const adultCfg = resolveAdultRoutingConfig();
    const variants = selectAdultHandoffRawVariants(opts.history, {
      baseExchanges: adultCfg.baseRawExchanges,
      targetExchanges: adultCfg.handoffTargetRawExchanges,
      extraRawTokens: adultCfg.handoffExtraRawTokens,
    });
    history = variants.handoff.history;
    const lastAssistant =
      [...opts.history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
      text: lastAssistant,
      characterName: charName,
      personaName,
      currentUserText: opts.currentUserMessage,
    });
    continuityPacket = buildSceneContinuityPacket({
      previousSceneMode: "explicit",
      sexualContextActive: true,
      activeConsentMode: "standard",
      charactersPresent: [charName, personaName],
      currentPov: narrativePov.mode,
      ...extractedHandoffContinuity,
    });
  }

  const currentUserMessage = opts.qwenFragmentSentence
    ? `${opts.currentUserMessage}\n\n${opts.qwenFragmentSentence}`
    : opts.currentUserMessage;

  const built = buildContext({
    charName,
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: history,
    currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.assembleModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((history.length - 2) / 2)),
    provider: "cheaperinference",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 0,
    narrativePov,
    preserveAdultHandoffRawHistory: opts.adultHandoff,
    deepSeekExtrasModeOverride: opts.deepSeekExtrasModeOverride,
  });
  const systemPrompt = opts.adultHandoff
    ? appendAdultHandoffPrompt(built.systemPrompt, continuityPacket as never)
    : built.systemPrompt;
  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: opts.assembleModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName,
      personaName,
    },
  });
  const adapted = adaptCheaperInferenceChatBody({
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  });
  adapted.model = opts.requestModelId;
  const messages = adapted.messages as ChatMsg[];
  const systemMsg = messages.find((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemChars = systemMsg?.content.length ?? 0;
  const currentUserChars = lastUser?.content.length ?? 0;
  const assembledChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return {
    requestBody: adapted,
    messages,
    systemPrompt,
    lastUserContent: lastUser?.content ?? "",
    continuityPacket,
    extractedHandoffContinuity,
    generation: {
      temperature: adapted.temperature ?? null,
      top_p: adapted.top_p ?? null,
      max_tokens: adapted.max_tokens ?? null,
      thinking: adapted.thinking ?? null,
      reasoning_effort: adapted.reasoning_effort ?? null,
    },
    promptSize: {
      system_chars: systemChars,
      current_user_chars: currentUserChars,
      assembled_chars: assembledChars,
      est_input_tokens: estimateTokens(
        messages.map((m) => m.content).join("")
      ),
      estimator: "ESTIMATED",
      style_reminder_present: (lastUser?.content ?? "").includes(
        DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY
      ),
      xml_persona_present: systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.persona}>`),
      xml_world_lore_present: systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.worldLore}>`),
      xml_ltm_present: systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.longTermMemory}>`),
      xml_chat_history_present: systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.chatHistory}>`),
      appearance_rule_present: systemPrompt.includes(DEEPSEEK_APPEARANCE_VARIATION_RULE),
      handoff_instruction_present: systemPrompt.includes(
        "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다."
      ),
    },
    assemblePromptHash: sha256(
      messages.map((m) => `${m.role}\0${m.content}`).join("\u0001")
    ),
  };
}

function continuityFlipDiagnostic(
  text: string,
  packet: Record<string, unknown> | null
) {
  const actor = String(packet?.previousActionActor ?? "");
  const target = String(packet?.previousActionTarget ?? "");
  const direction = String(packet?.contactDirection ?? "");
  const output = {
    previousActionActor: actor || null,
    previousActionTarget: target || null,
    contactDirection: direction || null,
    actor_target_inverted: false,
    contact_direction_inverted: false,
  };
  if (!actor || !target || actor === target) return output;
  const invertedContact = new RegExp(
    `${target}[이가은는]?\\s*${actor}(?:의)?\\s*(?:허리|어깨|손목|손|허리춤)[을를]?\\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)`
  );
  const invertedDirection = new RegExp(`${target}\\s*→\\s*${actor}`);
  output.actor_target_inverted = invertedContact.test(text);
  output.contact_direction_inverted = invertedDirection.test(text);
  return output;
}

function fragmentSignals(opts: {
  sourceParagraphs: number;
  finalizedParagraphs: number;
  finalizedDialogueParagraphs: number;
  finalizedText: string;
}) {
  const paras = opts.finalizedText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const shortDialogueRun = paras.filter((p) => {
    const noWs = p.replace(/\s+/g, "");
    return /["“「『]/.test(p) && noWs.length <= 24;
  }).length;
  const shortNarration = paras.filter((p) => {
    const sentences = p.split(/(?<=[.!?。…])\s+/).filter(Boolean);
    return !/["“「『]/.test(p) && sentences.length <= 2 && p.replace(/\s+/g, "").length <= 80;
  }).length;
  const paragraphRatio =
    opts.sourceParagraphs > 0 ? opts.finalizedParagraphs / opts.sourceParagraphs : null;
  return {
    short_dialogue_paragraphs: shortDialogueRun,
    short_narration_fragments: shortNarration,
    finalized_vs_source_paragraph_ratio: paragraphRatio,
  };
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  const fixtures = loadExistingFixtures();
  const characterOk =
    !!fixtures.character &&
    isProductionLikeTaehyungRecord({
      id: fixtures.character._internalId,
      name: String(fixtures.character.name ?? ""),
      description: String(fixtures.character.description ?? ""),
      system_prompt: String(fixtures.character.system_prompt ?? ""),
      world: String(fixtures.character.world ?? ""),
      greeting: String(fixtures.character.greeting ?? ""),
      example_dialog: String(fixtures.character.example_dialog ?? ""),
      setting_chunks: String(fixtures.character.setting_chunks ?? ""),
      speech_profile: String(fixtures.character.speech_profile ?? ""),
    });
  const personaOk = Boolean(fixtures.persona && String(fixtures.persona.name ?? "").includes("렌"));
  if (!characterOk || !personaOk) {
    throw new Error("EXISTING_PRODUCTION_FIXTURES_INVALID");
  }

  const opusSource = mustRead(join(LIVE_ROOT, "opus/source/provider-raw.txt"));
  const geminiSource = mustRead(join(LIVE_ROOT, "gemini/source/provider-raw.txt"));
  const opusDsLegacy = mustRead(join(LIVE_ROOT, "opus/deepseek/provider-raw.txt"));
  const geminiDsLegacy = mustRead(join(LIVE_ROOT, "gemini/deepseek/provider-raw.txt"));
  const opusQwenRaw = mustRead(join(LIVE_ROOT, "opus/qwen/provider-raw.txt"));
  const geminiQwenRaw = mustRead(join(LIVE_ROOT, "gemini/qwen/provider-raw.txt"));

  const { normalizeAiNovelProseLayout } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");

  const opusQwenFinal = normalizeAiNovelProseLayout(opusQwenRaw);
  const geminiQwenFinal = normalizeAiNovelProseLayout(geminiQwenRaw);
  save(DOCS, "QWEN_OPUS_RAW.txt", opusQwenRaw);
  save(DOCS, "QWEN_OPUS_PRODUCTION_FINALIZED.txt", opusQwenFinal);
  save(DOCS, "QWEN_GEMINI_RAW.txt", geminiQwenRaw);
  save(DOCS, "QWEN_GEMINI_PRODUCTION_FINALIZED.txt", geminiQwenFinal);
  save(OUT_ROOT, "QWEN_OPUS_RAW.txt", opusQwenRaw);
  save(OUT_ROOT, "QWEN_OPUS_PRODUCTION_FINALIZED.txt", opusQwenFinal);
  save(OUT_ROOT, "QWEN_GEMINI_RAW.txt", geminiQwenRaw);
  save(OUT_ROOT, "QWEN_GEMINI_PRODUCTION_FINALIZED.txt", geminiQwenFinal);

  const qwenFinalizer = {
    opus: {
      raw_visible_chars: visibleAssistantDisplayCharCount(opusQwenRaw),
      raw_paragraph_count: paragraphStats(opusQwenRaw).paragraph_count,
      raw_dialogue_paragraph_count: paragraphStats(opusQwenRaw).dialogue_paragraph_count,
      finalized_visible_chars: visibleAssistantDisplayCharCount(opusQwenFinal),
      finalized_paragraph_count: paragraphStats(opusQwenFinal).paragraph_count,
      finalized_dialogue_paragraph_count: paragraphStats(opusQwenFinal).dialogue_paragraph_count,
      source_paragraph_count: paragraphStats(opusSource).paragraph_count,
      signals: fragmentSignals({
        sourceParagraphs: paragraphStats(opusSource).paragraph_count,
        finalizedParagraphs: paragraphStats(opusQwenFinal).paragraph_count,
        finalizedDialogueParagraphs: paragraphStats(opusQwenFinal).dialogue_paragraph_count,
        finalizedText: opusQwenFinal,
      }),
    },
    gemini: {
      raw_visible_chars: visibleAssistantDisplayCharCount(geminiQwenRaw),
      raw_paragraph_count: paragraphStats(geminiQwenRaw).paragraph_count,
      raw_dialogue_paragraph_count: paragraphStats(geminiQwenRaw).dialogue_paragraph_count,
      finalized_visible_chars: visibleAssistantDisplayCharCount(geminiQwenFinal),
      finalized_paragraph_count: paragraphStats(geminiQwenFinal).paragraph_count,
      finalized_dialogue_paragraph_count: paragraphStats(geminiQwenFinal).dialogue_paragraph_count,
      source_paragraph_count: paragraphStats(geminiSource).paragraph_count,
      signals: fragmentSignals({
        sourceParagraphs: paragraphStats(geminiSource).paragraph_count,
        finalizedParagraphs: paragraphStats(geminiQwenFinal).paragraph_count,
        finalizedDialogueParagraphs: paragraphStats(geminiQwenFinal).dialogue_paragraph_count,
        finalizedText: geminiQwenFinal,
      }),
    },
  };

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];

  const sources = [
    { id: "opus" as const, sourceText: opusSource },
    { id: "gemini" as const, sourceText: geminiSource },
  ];

  const promptCompare: Record<string, unknown> = {};
  const cleanCells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  let deepseekCleanCalls = 0;

  for (const source of sources) {
    const adultHistory: ChatMsg[] = [
      ...baseHistory,
      { role: "user", content: SOURCE_SEED_USER },
      { role: "assistant", content: source.sourceText },
    ];
    const legacyBundle = await assembleBundle({
      assembleModelId: DEEPSEEK_ASSEMBLE,
      requestModelId: DEEPSEEK_REQUESTED,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: adultHistory,
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
    });
    const cleanBundle = await assembleBundle({
      assembleModelId: DEEPSEEK_ASSEMBLE,
      requestModelId: DEEPSEEK_REQUESTED,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: adultHistory,
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
      deepSeekExtrasModeOverride: "off",
    });
    const removedChars = Math.max(
      0,
      legacyBundle.promptSize.assembled_chars - cleanBundle.promptSize.assembled_chars
    );
    promptCompare[source.id] = {
      legacy_system_chars: legacyBundle.promptSize.system_chars,
      clean_system_chars: cleanBundle.promptSize.system_chars,
      legacy_current_user_chars: legacyBundle.promptSize.current_user_chars,
      clean_current_user_chars: cleanBundle.promptSize.current_user_chars,
      legacy_est_input_tokens: legacyBundle.promptSize.est_input_tokens,
      clean_est_input_tokens: cleanBundle.promptSize.est_input_tokens,
      removed_deepseek_specific_chars: removedChars,
      removed_deepseek_specific_est_tokens: estimateTokens("x".repeat(Math.max(1, removedChars))),
      estimator: "ESTIMATED",
      legacy_markers: {
        style_reminder_present: legacyBundle.promptSize.style_reminder_present,
        xml_persona_present: legacyBundle.promptSize.xml_persona_present,
        xml_world_lore_present: legacyBundle.promptSize.xml_world_lore_present,
        appearance_rule_present: legacyBundle.promptSize.appearance_rule_present,
        handoff_instruction_present: legacyBundle.promptSize.handoff_instruction_present,
      },
      clean_markers: {
        style_reminder_present: cleanBundle.promptSize.style_reminder_present,
        xml_persona_present: cleanBundle.promptSize.xml_persona_present,
        xml_world_lore_present: cleanBundle.promptSize.xml_world_lore_present,
        appearance_rule_present: cleanBundle.promptSize.appearance_rule_present,
        handoff_instruction_present: cleanBundle.promptSize.handoff_instruction_present,
      },
      generation: cleanBundle.generation,
    };

    console.log(`\n=== CALL D${deepseekCleanCalls + 1} ${source.id} → ${DEEPSEEK_REQUESTED} CLEAN ===`);
    deepseekCleanCalls += 1;
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      cleanBundle.requestBody
    );
    const prose = proseDiagnostics(resp.text);
    const packet = (cleanBundle.continuityPacket ?? null) as Record<string, unknown> | null;
    const meta = {
      requested_model: DEEPSEEK_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: visibleAssistantDisplayCharCount(resp.text),
      paragraph_count: prose.paragraph_count,
      dialogue_paragraph_count: prose.dialogue_paragraph_count,
      latency: resp.latency_s,
      ...extractUsage(resp.usage),
      temperature: cleanBundle.generation.temperature,
      top_p: cleanBundle.generation.top_p,
      thinking: cleanBundle.generation.thinking,
      ...prose,
      agency: agencyDiagnostic(resp.text),
      continuity: continuityFlipDiagnostic(resp.text, packet),
      handoff_packet: packet,
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: resp.error,
    };
    const dir = join(OUT_ROOT, "live", source.id, "deepseek-clean");
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    save(dir, "prompt-size.json", promptCompare[source.id] as object);
    cleanCells[source.id] = { raw: resp.text, meta };
  }

  const stillFragmented = (side: typeof qwenFinalizer.opus) => {
    const ratio = side.signals.finalized_vs_source_paragraph_ratio ?? 0;
    return (
      side.signals.short_dialogue_paragraphs >= 8 ||
      side.signals.short_narration_fragments >= 12 ||
      ratio >= 1.8
    );
  };
  const fragmentRequired =
    stillFragmented(qwenFinalizer.opus) || stillFragmented(qwenFinalizer.gemini);

  const review = `# Opus source

## Source

${opusSource}

## DeepSeek 0813 LEGACY

${opusDsLegacy}

## DeepSeek 0813 CLEAN

${cleanCells.opus?.raw || "_NO_OUTPUT_"}

## Qwen 3.8 Max RAW

${opusQwenRaw}

## Qwen 3.8 Max production-finalized

${opusQwenFinal}

# Gemini source

## Source

${geminiSource}

## DeepSeek 0813 LEGACY

${geminiDsLegacy}

## DeepSeek 0813 CLEAN

${cleanCells.gemini?.raw || "_NO_OUTPUT_"}

## Qwen 3.8 Max RAW

${geminiQwenRaw}

## Qwen 3.8 Max production-finalized

${geminiQwenFinal}
`;

  const runtime = {
    DEEPSEEK_CLEAN_VS_LEGACY_WINNER: "HUMAN_REVIEW_REQUIRED",
    QWEN_FRAGMENTATION_VERDICT: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
    QWEN_THINKING_RETEST: "NO",
    QWEN_LENGTH_TUNING: "NO",
    SOURCE_API_CALLS: 0,
    DEEPSEEK_CLEAN_API_CALLS: deepseekCleanCalls,
    QWEN_FINALIZER_API_CALLS: 0,
    QWEN_FRAGMENT_PROMPT_TEST: fragmentRequired ? "REQUIRED" : "NOT_REQUIRED",
    QWEN_FRAGMENT_API_CALLS: 0,
    TOTAL_NEW_API_CALLS: deepseekCleanCalls,
    prompt_compare: promptCompare,
    qwen_finalizer: qwenFinalizer,
    clean_cells: Object.fromEntries(
      Object.entries(cleanCells).map(([k, v]) => [k, v.meta])
    ),
  };

  save(DOCS, "CLEAN_FOLLOWUP_DIRECT_REVIEW.md", review);
  save(DOCS, "CLEAN_FOLLOWUP_RUNTIME.json", runtime);
  save(OUT_ROOT, "CLEAN_FOLLOWUP_DIRECT_REVIEW.md", review);
  save(OUT_ROOT, "CLEAN_FOLLOWUP_RUNTIME.json", runtime);

  const report = {
    DEEPSEEK_CLEAN_CALLS: deepseekCleanCalls,
    QWEN_FINALIZER_CALLS: 0,
    QWEN_FRAGMENT_CALLS: 0,
    TOTAL_NEW_API_CALLS: deepseekCleanCalls,
    DEEPSEEK_0813_LEGACY_PROMPT_CHARS:
      (promptCompare.opus as { legacy_system_chars?: number } | undefined)
        ?.legacy_system_chars ?? null,
    DEEPSEEK_0813_CLEAN_PROMPT_CHARS:
      (promptCompare.opus as { clean_system_chars?: number } | undefined)
        ?.clean_system_chars ?? null,
    DEEPSEEK_PROMPT_TOKEN_DELTA: {
      opus: {
        legacy_est_input_tokens: (promptCompare.opus as { legacy_est_input_tokens?: number })
          ?.legacy_est_input_tokens,
        clean_est_input_tokens: (promptCompare.opus as { clean_est_input_tokens?: number })
          ?.clean_est_input_tokens,
        removed_deepseek_specific_est_tokens: (
          promptCompare.opus as { removed_deepseek_specific_est_tokens?: number }
        )?.removed_deepseek_specific_est_tokens,
        estimator: "ESTIMATED",
      },
      gemini: {
        legacy_est_input_tokens: (promptCompare.gemini as { legacy_est_input_tokens?: number })
          ?.legacy_est_input_tokens,
        clean_est_input_tokens: (promptCompare.gemini as { clean_est_input_tokens?: number })
          ?.clean_est_input_tokens,
        removed_deepseek_specific_est_tokens: (
          promptCompare.gemini as { removed_deepseek_specific_est_tokens?: number }
        )?.removed_deepseek_specific_est_tokens,
        estimator: "ESTIMATED",
      },
    },
    OPUS_DS_CLEAN_STATUS: cleanCells.opus?.meta.HTTP_status ?? null,
    GEMINI_DS_CLEAN_STATUS: cleanCells.gemini?.meta.HTTP_status ?? null,
    QWEN_OPUS_RAW_PARAGRAPHS: qwenFinalizer.opus.raw_paragraph_count,
    QWEN_OPUS_FINALIZED_PARAGRAPHS: qwenFinalizer.opus.finalized_paragraph_count,
    QWEN_GEMINI_RAW_PARAGRAPHS: qwenFinalizer.gemini.raw_paragraph_count,
    QWEN_GEMINI_FINALIZED_PARAGRAPHS: qwenFinalizer.gemini.finalized_paragraph_count,
    QWEN_FRAGMENT_RETEST_REQUIRED: fragmentRequired,
    CLEAN_FOLLOWUP_DIRECT_REVIEW: `${DOCS}/CLEAN_FOLLOWUP_DIRECT_REVIEW.md`,
    CAPTURE_COMPLETE: deepseekCleanCalls === 2,
    QWEN_FRAGMENT_SENTENCE_RESERVED: QWEN_FRAGMENT_SENTENCE,
  };
  save(DOCS, "CLEAN_FOLLOWUP_SUMMARY.json", report);
  save(OUT_ROOT, "CLEAN_FOLLOWUP_SUMMARY.json", report);
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1]?.includes(
  "real-taehyung-explicit-deepseek0813-clean-followup"
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
