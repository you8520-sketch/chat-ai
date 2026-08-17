/**
 * Muse Spark 1.2 Generic Source Mirror — single-fixture production-parity
 * regression capture.
 *
 * NOT a multi-character generalization audit.
 * GENERALIZATION_PROVEN stays false even if Generic looks strong.
 * Cursor does not score literary quality and does not declare PASS/FAIL.
 *
 * Budget: 6 new Muse calls. Source / Qwen / DeepSeek / GLM / V1 / retry = 0.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/muse12-generic-single-fixture-regression.ts
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

import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/muse12-generic-single-fixture-regression";
const SOURCE_DIR = "docs/audits/muse12-source-style-generalization/recovered-sources";
const V1_DIR = join(DOCS, "v1-frozen");
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");
const MUSE_MODEL = "muse-spark-1.2";
const TOTAL_NEW_MUSE_CALLS = 6;

const FROZEN_OPUS_SOURCE_SHA =
  "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818";
const FROZEN_GEMINI_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";

const V1_SHA: Record<string, string> = {
  "MUSE12_POSITIVE_OPUS.txt":
    "c63a257a57f1e0f062719b9953cfb0aa662b5718836df734591250d70b3a473d",
  "MUSE12_FINAL_OPUS_POSITIVE_2.txt":
    "1f561ed45ffc02b3dd33dfd6b6679d55a8a6da3cdf3d638580fca68293f77de4",
  "MUSE12_FINAL_OPUS_POSITIVE_3.txt":
    "f409fd35e58eaef98a5314bea30024a3f627714cca61e30f2fc0407ec1bef647",
  "MUSE12_POSITIVE_GEMINI.txt":
    "3a6564d821e8e6d018d41e759de2971f2d4741e55143e68d45e7b277a2550a97",
  "MUSE12_FINAL_GEMINI_POSITIVE_2.txt":
    "0d91cf0032636a2cfa45e0d02d2cd4503554351802850843e4175c5844a5bbaf",
  "MUSE12_FINAL_GEMINI_POSITIVE_3.txt":
    "365748e3fa4f395a609dd209e445d4c2fba051827ba2814a3286712e0d302bc9",
};

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const LIKE_SPECIFIC_V1_PHRASES = [
  "미세한 환경음과 거리감",
  "얇은 농담",
  "능글맞음",
  "어색하게 비치는 진심",
  "장난스러운 반응",
] as const;

const V1_OPUS_HEADER = "[MUSE SOURCE STYLE CONTINUITY — OPUS 5]";
const V1_GEMINI_HEADER = "[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]";
const V2_HEADER = "[MUSE SOURCE STYLE MIRROR V2]";
const GENERIC_HEADER = "[MUSE SOURCE CONTINUITY — STYLE MIRROR]";

const MUSE_UNDOCUMENTED_FIELDS = [
  "reasoning",
  "include_reasoning",
  "reasoning_effort",
  "thinking",
  "output_config",
  "extra_body",
  "reasoning_max_tokens",
  "enable_thinking",
] as const;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type SourceId = "opus" | "gemini31";

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
  firstContentAt: number | null;
  reasoningText: string;
  reasoningEvents: number;
  incomplete: boolean;
};

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function mustRead(path: string): string {
  if (!existsSync(path)) throw new Error(`MISSING_FILE:${path}`);
  return readFileSync(path, "utf8");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return n;
    n += 1;
    from = idx + needle.length;
  }
}

function opaqueId(): string {
  return `S${randomBytes(8).toString("hex")}`;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = out[i];
    out[i] = out[j]!;
    out[j] = tmp!;
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(2));
  }
  return Number((sorted[mid] ?? 0).toFixed(2));
}

function sentenceCount(paragraph: string): number {
  const parts = paragraph
    .split(/[.!?。！？]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 0 ? 1 : parts.length;
}

function proseMetrics(text: string, visibleChars: number) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const paraChars = paragraphs.map((p) => p.length);
  const oneSentence = paragraphs.filter((p) => sentenceCount(p) === 1).length;
  const dialogue = paragraphs.filter((p) => /["“「『]/.test(p)).length;
  const per1000 = visibleChars > 0 ? visibleChars / 1000 : 0;
  return {
    paragraph_count: paragraphs.length,
    paragraphs_per_1000:
      per1000 > 0 ? Number((paragraphs.length / per1000).toFixed(4)) : null,
    one_sentence_paragraph_share:
      paragraphs.length > 0
        ? Number((oneSentence / paragraphs.length).toFixed(4))
        : null,
    dialogue_blocks: dialogue,
    dialogue_blocks_per_1000:
      per1000 > 0 ? Number((dialogue / per1000).toFixed(4)) : null,
    avg_paragraph_chars:
      paraChars.length > 0
        ? Number((paraChars.reduce((a, b) => a + b, 0) / paraChars.length).toFixed(2))
        : null,
    median_paragraph_chars: median(paraChars),
  };
}

function koreanCharCount(text: string): number {
  return (text.match(/\p{Script=Hangul}/gu) ?? []).length;
}

function extractUsage(usage: Record<string, unknown> | null) {
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const promptDetails =
    (usage?.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completion_tokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : typeof usage?.reasoning_tokens === "number"
          ? usage.reasoning_tokens
          : null,
    cache_read_tokens:
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : typeof usage?.cache_read_tokens === "number"
          ? usage.cache_read_tokens
          : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
    terminal_usage: usage != null,
  };
}

function reasoningDelta(obj: Record<string, unknown> | undefined): string {
  if (!obj) return "";
  const candidates = [obj.reasoning, obj.reasoning_content, obj.thinking];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
    if (c && typeof c === "object") {
      const rec = c as Record<string, unknown>;
      if (typeof rec.content === "string" && rec.content) return rec.content;
      if (typeof rec.text === "string" && rec.text) return rec.text;
    }
  }
  return "";
}

function processSseLine(line: string, state: StreamState, started: number): void {
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
  if (content) {
    if (state.firstContentAt == null) state.firstContentAt = Date.now() - started;
    state.text += content;
  }
  const reasoning = reasoningDelta(delta) || reasoningDelta(message);
  if (reasoning) {
    state.reasoningEvents += 1;
    state.reasoningText += reasoning;
  }
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
      finish_reason: null as string | null,
      usage: null as Record<string, unknown> | null,
      resolved_model: null as string | null,
      saw_done: false,
      latency_ms: Date.now() - started,
      ttft_ms: null as number | null,
      reasoning_text: "",
      reasoning_events: 0,
      incomplete_stream: true,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
    firstContentAt: null,
    reasoningText: "",
    reasoningEvents: 0,
    incomplete: false,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state, started);
    if (done) break;
  }
  if (buf.trim()) processSseLine(buf, state, started);
  const incomplete =
    !state.sawDone ||
    state.finish == null ||
    state.finish === "length" ||
    !state.text.trim();
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    saw_done: state.sawDone,
    latency_ms: Date.now() - started,
    ttft_ms: state.firstContentAt,
    reasoning_text: state.reasoningText,
    reasoning_events: state.reasoningEvents,
    incomplete_stream: incomplete,
    error: null as string | null,
  };
}

function inspectWire(body: Record<string, unknown>) {
  const keys = Object.keys(body).sort();
  const present = Object.fromEntries(
    MUSE_UNDOCUMENTED_FIELDS.map((k) => [
      k,
      Object.prototype.hasOwnProperty.call(body, k) ? "PRESENT" : "ABSENT",
    ])
  );
  return {
    requested_model: body.model ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_tokens: body.max_tokens ?? null,
    stream: body.stream ?? null,
    stream_options: body.stream_options ?? null,
    keys,
    muse_fields: present,
  };
}

function assertExactGenericBlock(user: string, expected: string) {
  const start = user.indexOf(GENERIC_HEADER);
  if (start < 0) throw new Error("GENERIC_BLOCK_MISSING_ON_USER");
  const after = user.slice(start);
  const tailIdx = after.indexOf("\n\n이번 응답은 한국어");
  const extracted = (tailIdx >= 0 ? after.slice(0, tailIdx) : after).trimEnd();
  if (extracted !== expected.trimEnd()) {
    throw new Error("GENERIC_BLOCK_TEXT_MUTATED");
  }
}

function assertContracts(opts: {
  system: string;
  user: string;
  body: Record<string, unknown>;
  genericBlock: string;
  qwenOpus: string;
  qwenGemini: string;
  terminalOwner: string;
}) {
  const blob = `${opts.system}\n${opts.user}`;
  if (countOccurrences(opts.user, opts.genericBlock) !== 1) {
    throw new Error(`GENERIC_BLOCK_USER_COUNT:${countOccurrences(opts.user, opts.genericBlock)}`);
  }
  if (opts.system.includes(opts.genericBlock) || opts.system.includes(GENERIC_HEADER)) {
    throw new Error("GENERIC_BLOCK_IN_SYSTEM");
  }
  if (countOccurrences(blob, opts.genericBlock) !== 1) {
    throw new Error("GENERIC_BLOCK_NOT_EXACTLY_ONCE");
  }
  assertExactGenericBlock(opts.user, opts.genericBlock);
  if (
    opts.user.indexOf(opts.genericBlock) > opts.user.indexOf(opts.terminalOwner) ||
    !opts.user.trimEnd().endsWith(opts.terminalOwner)
  ) {
    throw new Error("TERMINAL_OWNER_NOT_LAST");
  }
  if (countOccurrences(opts.user, opts.terminalOwner) !== 1) {
    throw new Error("TERMINAL_OWNER_COUNT");
  }
  if (blob.includes(V1_OPUS_HEADER) || blob.includes(V1_GEMINI_HEADER)) {
    throw new Error("LIKE_SPECIFIC_V1_HEADER_IN_GENERIC_REQUEST");
  }
  if (blob.includes(V2_HEADER)) {
    throw new Error("V2_HEADER_IN_GENERIC_REQUEST");
  }
  for (const phrase of LIKE_SPECIFIC_V1_PHRASES) {
    if (opts.genericBlock.includes(phrase)) {
      throw new Error(`LIKE_SPECIFIC_PHRASE_IN_GENERIC_BLOCK:${phrase}`);
    }
  }
  if (blob.includes(opts.qwenOpus) || blob.includes(opts.qwenGemini)) {
    throw new Error("QWEN_ADAPTER_IN_MUSE_REQUEST");
  }
  if (
    !opts.user.includes("잡은 소매에서 손으로 올라가 허리를 감싼다") ||
    !opts.user.includes("삽입해도 된다는 뜻으로")
  ) {
    throw new Error("FROZEN_ADULT_SEED_NOT_IN_ASSEMBLED_USER");
  }
  if (!/Speech Lock|SPEECH LOCK|SPEECH CONSISTENCY|말투 잠금/i.test(opts.system)) {
    throw new Error("SPEECH_LOCK_MISSING");
  }
  if (opts.body.model !== MUSE_MODEL) {
    throw new Error(`MODEL_NOT_MUSE:${String(opts.body.model)}`);
  }
  if (opts.body.temperature !== 0.7) {
    throw new Error(`TEMPERATURE_NOT_0_7:${String(opts.body.temperature)}`);
  }
  if (Object.prototype.hasOwnProperty.call(opts.body, "max_tokens")) {
    throw new Error("MAX_TOKENS_PRESENT");
  }
  for (const field of MUSE_UNDOCUMENTED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(opts.body, field)) {
      throw new Error(`MUSE_FIELD_LEAKED:${field}`);
    }
  }
}

async function assembleGeneric(opts: {
  sourceId: SourceId;
  sourceModelId: string;
  sourceText: string;
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
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
  const {
    CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  } = await import("../src/lib/chatModels");
  const {
    MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
    OPUS_QWEN_FRAGMENT_SENTENCE,
    GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  } = await import("../src/lib/adultHandoffSourceRouting");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY, DEEPSEEK_XML_TAGS } = await import(
    "../src/lib/deepseekPromptStructure"
  );

  const ch = opts.character;
  const charName = String(ch.name);
  const personaName = String(opts.persona.name ?? "렌");
  if (charName !== "라이크" || Number(ch._internalId) !== 18) {
    throw new Error(`FIXTURE_CHARACTER_UNEXPECTED:${charName}:${String(ch._internalId)}`);
  }
  if (!personaName.includes("렌")) {
    throw new Error(`FIXTURE_PERSONA_UNEXPECTED:${personaName}`);
  }

  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch._internalId),
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
  const userPersona =
    formatSelectedPersonaForPrompt(
      personaName,
      (opts.persona.gender as "male" | "female" | "other") ?? "other",
      String(opts.persona.description ?? "")
    ) ?? `이름/호칭: ${personaName}`;
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });

  const greeting = String(ch.greeting ?? "").trim();
  const rawHistory: ChatMsg[] = [
    ...(greeting ? [{ role: "assistant" as const, content: greeting }] : []),
    { role: "user", content: SOURCE_SEED_USER },
    { role: "assistant", content: opts.sourceText },
  ];
  const adultCfg = resolveAdultRoutingConfig();
  const variants = selectAdultHandoffRawVariants(rawHistory, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const history = variants.handoff.history as ChatMsg[];
  const extracted = extractHandoffContinuityFromAssistantText({
    text: opts.sourceText,
    characterName: charName,
    personaName,
    currentUserText: ADULT_HANDOFF_USER,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: "explicit",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [charName, personaName],
    currentPov: narrativePov.mode,
    ...extracted,
  });

  const built = buildContext({
    charName,
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: history,
    currentUserMessage: ADULT_HANDOFF_USER,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
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
    preserveAdultHandoffRawHistory: true,
    adultHandoffSourceModelId: opts.sourceModelId,
    adultHandoffTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket, {
    sourceModelId: opts.sourceModelId,
    adultTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  });
  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
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
  adapted.model = MUSE_MODEL;
  delete adapted.max_tokens;
  delete adapted.reasoning;
  delete adapted.include_reasoning;
  delete adapted.reasoning_effort;
  delete adapted.thinking;

  const messages = adapted.messages as ChatMsg[];
  const systemMsg = messages.find((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!systemMsg || !lastUser) throw new Error("ASSEMBLED_MESSAGES_MISSING_ROLES");

  if (
    systemPrompt.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY) ||
    lastUser.content.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)
  ) {
    throw new Error("DEEPSEEK_BOTTOM_REMINDER_LEAKED");
  }
  for (const tag of Object.values(DEEPSEEK_XML_TAGS)) {
    if (systemPrompt.includes(`<${tag}>`) || lastUser.content.includes(`<${tag}>`)) {
      throw new Error(`DEEPSEEK_XML_LEAKED:${tag}`);
    }
  }

  assertContracts({
    system: systemMsg.content,
    user: lastUser.content,
    body: adapted,
    genericBlock: MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
    qwenOpus: OPUS_QWEN_FRAGMENT_SENTENCE,
    qwenGemini: GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
    terminalOwner: USER_TAIL_LENGTH_OWNER_SENTENCE,
  });

  const fixtureCanonHits = Object.fromEntries(
    LIKE_SPECIFIC_V1_PHRASES.map((phrase) => [
      phrase,
      {
        generic_block: countOccurrences(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR, phrase),
        current_user_minus_generic: countOccurrences(
          lastUser.content.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).join(""),
          phrase
        ),
        system: countOccurrences(systemMsg.content, phrase),
      },
    ])
  );

  return {
    requestBody: adapted,
    messages,
    systemPrompt: systemMsg.content,
    lastUserContent: lastUser.content,
    continuityPacket,
    wire: inspectWire(adapted),
    genericBlock: MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
    fixtureCanonHits,
    sourceId: opts.sourceId,
  };
}

function listMetrics(values: Array<number | null | undefined>) {
  const nums = values.filter((v): v is number => typeof v === "number");
  return {
    values: values,
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length ? Math.max(...nums) : null,
    mean:
      nums.length === 0
        ? null
        : Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4)),
  };
}

function renderBlindPacket(opts: {
  sourceLabel: string;
  samples: Array<{
    opaqueId: string;
    raw: string;
    runtime: Record<string, unknown>;
  }>;
}): string {
  const lines: string[] = [
    `# Blind packet — ${opts.sourceLabel} Generic vs V1`,
    "",
    "Identity of each sample is hidden. Do not infer Generic vs V1 from filenames or this packet.",
    "Cursor did **not** score quality. ChatGPT reads each RAW directly.",
    "",
    "This is a **single-fixture** regression packet (라이크/렌 adult pair only).",
    "`GENERALIZATION_PROVEN` remains **false** regardless of scores.",
    "ChatGPT may later mark `SINGLE_FIXTURE_GENERIC_REGRESSION_PASS` or `SINGLE_FIXTURE_GENERIC_REGRESSION_FAIL`.",
    "",
    "## Manual axes (ChatGPT only)",
    "",
    "- PURE_PROSE_QUALITY /5",
    "- SOURCE_STYLE_FIDELITY /5",
    "- CHARACTER_IDENTITY /5",
    "- SCENE_CONTINUITY /5",
    "- PARAGRAPH_RHYTHM /5",
    "- ADULT_PROGRESSION /5",
    "- LATE_SCENE_CHARACTER_VOICE /5",
    "",
    "Especially check:",
    "",
    "- Generic prompt has no “능글맞음” style hint. Does the output still keep that texture if the **source RAW** already has it?",
    "- Does the output invent a personality the source did not show?",
    "- Does the last 1/3 collapse into a generic adult voice?",
    "- Is paragraph cohesion worse than the other samples in this packet?",
    "- Does it re-ask / stall after the user already set the progression?",
    "",
    "## Defects to mark if present (ChatGPT only)",
    "",
    "- SOURCE_STYLE_LOSS",
    "- CHARACTER_PERSONALITY_INVENTION",
    "- GENERIC_ADULT_VOICE",
    "- LATE_VOICE_DRIFT",
    "- DUPLICATE_PERMISSION_CHECKPOINT",
    "- STALL",
    "- USER_SEMANTIC_DIALOGUE_INVENTION",
    "- PARAGRAPH_FRAGMENTATION",
    "- FOREIGN_SCRIPT_CONTAMINATION",
    "- REFUSAL",
    "- FADE",
    "",
    "## Score sheet (leave blank for ChatGPT)",
    "",
    "| opaque_id | PURE_PROSE_QUALITY | SOURCE_STYLE_FIDELITY | CHARACTER_IDENTITY | SCENE_CONTINUITY | PARAGRAPH_RHYTHM | ADULT_PROGRESSION | LATE_SCENE_CHARACTER_VOICE | defects |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const sample of opts.samples) {
    lines.push(`| \`${sample.opaqueId}\` |  |  |  |  |  |  |  |  |`);
  }
  lines.push("", "## Samples", "");
  for (const sample of opts.samples) {
    lines.push(`### SAMPLE ${sample.opaqueId}`, "");
    lines.push("Runtime (identity hidden):");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(sample.runtime, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("RAW:");
    lines.push("");
    lines.push("```text");
    lines.push(sample.raw.replace(/```/g, "``\\`"));
    lines.push("```");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  mkdirSync(DOCS, { recursive: true });

  const opusSource = mustRead(join(SOURCE_DIR, "LIKE_ADULT_SOURCE_OPUS.txt"));
  const geminiSource = mustRead(join(SOURCE_DIR, "LIKE_ADULT_SOURCE_GEMINI31.txt"));
  if (sha256(opusSource) !== FROZEN_OPUS_SOURCE_SHA) {
    throw new Error("FROZEN_OPUS_SOURCE_SHA_MISMATCH");
  }
  if (sha256(geminiSource) !== FROZEN_GEMINI_SOURCE_SHA) {
    throw new Error("FROZEN_GEMINI_SOURCE_SHA_MISMATCH");
  }

  const v1Files = {
    opus: [
      "MUSE12_POSITIVE_OPUS.txt",
      "MUSE12_FINAL_OPUS_POSITIVE_2.txt",
      "MUSE12_FINAL_OPUS_POSITIVE_3.txt",
    ],
    gemini31: [
      "MUSE12_POSITIVE_GEMINI.txt",
      "MUSE12_FINAL_GEMINI_POSITIVE_2.txt",
      "MUSE12_FINAL_GEMINI_POSITIVE_3.txt",
    ],
  } as const;
  const v1Raw: Record<string, string> = {};
  for (const name of [...v1Files.opus, ...v1Files.gemini31]) {
    const raw = mustRead(join(V1_DIR, name));
    const hash = sha256(raw);
    if (hash !== V1_SHA[name]) {
      throw new Error(`V1_SHA_MISMATCH:${name}:${hash}`);
    }
    v1Raw[name] = raw;
  }

  const fixtures = JSON.parse(mustRead(FIXTURES_PATH)) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown> | null;
  };
  if (!fixtures.persona) throw new Error("FIXTURE_PERSONA_MISSING");

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const {
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  } = await import("../src/lib/chatModels");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { resolveAdultHandoffModelForSource } = await import(
    "../src/lib/adultHandoffSourceRouting"
  );
  const { CHEAPER_INFERENCE_QWEN_38_MAX_MODEL } = await import("../src/lib/chatModels");

  if (
    resolveAdultHandoffModelForSource(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, "x") !==
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL ||
    resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      "x"
    ) !== CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
  ) {
    throw new Error("PRODUCTION_ROUTING_CHANGED");
  }

  const sources: Array<{
    id: SourceId;
    sourceModelId: string;
    sourceText: string;
    sourceSha: string;
    rawPrefix: string;
  }> = [
    {
      id: "opus",
      sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      sourceText: opusSource,
      sourceSha: FROZEN_OPUS_SOURCE_SHA,
      rawPrefix: "OPUS_GENERIC",
    },
    {
      id: "gemini31",
      sourceModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      sourceText: geminiSource,
      sourceSha: FROZEN_GEMINI_SOURCE_SHA,
      rawPrefix: "GEMINI31_GENERIC",
    },
  ];

  const assembledBySource: Record<string, Awaited<ReturnType<typeof assembleGeneric>>> =
    {};
  for (const source of sources) {
    assembledBySource[source.id] = await assembleGeneric({
      sourceId: source.id,
      sourceModelId: source.sourceModelId,
      sourceText: source.sourceText,
      character: fixtures.character,
      persona: fixtures.persona,
    });
    save(join(DOCS, "assemble", source.id), "request-wire.json", {
      ...assembledBySource[source.id]!.wire,
      source_id: source.id,
      source_sha: source.sourceSha,
      fixture_canon_hits: assembledBySource[source.id]!.fixtureCanonHits,
    });
    save(
      join(DOCS, "assemble", source.id),
      "continuity-packet.json",
      assembledBySource[source.id]!.continuityPacket
    );
  }

  const headers = buildCheaperInferenceHeaders();
  let apiCalls = 0;
  const newRows: Array<Record<string, unknown>> = [];
  const genericRaws: Record<string, string> = {};

  for (const source of sources) {
    const assembled = assembledBySource[source.id]!;
    for (let n = 1; n <= 3; n += 1) {
      if (apiCalls >= TOTAL_NEW_MUSE_CALLS) {
        throw new Error(`API_CALL_BUDGET_EXCEEDED:${apiCalls}`);
      }
      const rawName = `${source.rawPrefix}_${n}_RAW.txt`;
      const rawPath = join(DOCS, rawName);
      if (existsSync(rawPath) && mustRead(rawPath).trim()) {
        throw new Error(`REFUSING_TO_OVERWRITE_EXISTING_RAW:${rawName}`);
      }
      apiCalls += 1;
      console.log(`\n=== ${source.id} Generic n=${n} (call ${apiCalls}/${TOTAL_NEW_MUSE_CALLS}) ===`);
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        assembled.requestBody
      );
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        save(join(DOCS, "failures"), `${source.id}_${n}.json`, resp);
        throw new Error(
          `CALL_FAIL ${source.id} n=${n}: ${resp.error ?? resp.http_status}`
        );
      }
      save(DOCS, rawName, resp.text);
      genericRaws[rawName] = resp.text;
      const visible = visibleAssistantDisplayCharCount(resp.text);
      const usage = extractUsage(resp.usage);
      const prose = proseMetrics(resp.text, visible);
      const row = {
        cell: `${source.id}_generic_${n}`,
        source_id: source.id,
        variant: "generic",
        n,
        raw_file: rawName,
        raw_sha256: sha256(resp.text),
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        visible_chars: visible,
        korean_chars: koreanCharCount(resp.text),
        input_tokens: usage.input_tokens,
        completion_tokens: usage.completion_tokens,
        reasoning_stream_observed: resp.reasoning_events > 0,
        reasoning_chars: resp.reasoning_text.length,
        reasoning_tokens: usage.reasoning_tokens,
        terminal_usage: usage.terminal_usage,
        incomplete_stream: resp.incomplete_stream,
        usage_cost: usage.usage_cost,
        saw_done: resp.saw_done,
        resolved_model: resp.resolved_model,
        ...prose,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        wire: assembled.wire,
      };
      newRows.push(row);
      save(join(DOCS, "calls", `${source.id}_${n}`), "meta.json", row);
      console.log({
        cell: row.cell,
        http: row.http_status,
        finish: row.finish_reason,
        visible,
        ttft_ms: row.ttft_ms,
        latency_ms: row.latency_ms,
        completion_tokens: row.completion_tokens,
        cost: row.usage_cost,
      });
    }
  }

  if (apiCalls !== TOTAL_NEW_MUSE_CALLS) {
    throw new Error(`CALL_COUNT_MISMATCH:${apiCalls}`);
  }

  const { visibleAssistantDisplayCharCount: vis } = await import(
    "../src/lib/chatDisplayLength"
  );

  type BlindSample = {
    opaqueId: string;
    sourceId: SourceId;
    variant: "generic" | "v1";
    n: number;
    raw: string;
    rawFile: string;
    rawSha: string;
    runtime: Record<string, unknown>;
  };

  const reveal: Record<string, Record<string, unknown>> = {};
  const blindRuntime: Record<string, Record<string, unknown>> = {};
  const packets: Record<SourceId, BlindSample[]> = { opus: [], gemini31: [] };

  for (const source of sources) {
    const samples: BlindSample[] = [];
    for (let n = 1; n <= 3; n += 1) {
      const rawFile = `${source.rawPrefix}_${n}_RAW.txt`;
      const raw = genericRaws[rawFile] ?? mustRead(join(DOCS, rawFile));
      const meta = newRows.find((r) => r.raw_file === rawFile)!;
      const id = opaqueId();
      const runtime = {
        http_status: meta.http_status,
        finish_reason: meta.finish_reason,
        ttft_ms: meta.ttft_ms,
        latency_ms: meta.latency_ms,
        visible_chars: meta.visible_chars,
        korean_chars: meta.korean_chars,
        input_tokens: meta.input_tokens,
        completion_tokens: meta.completion_tokens,
        reasoning_stream_observed: meta.reasoning_stream_observed,
        reasoning_chars: meta.reasoning_chars,
        terminal_usage: meta.terminal_usage,
        incomplete_stream: meta.incomplete_stream,
        usage_cost: meta.usage_cost,
        paragraph_count: meta.paragraph_count,
        paragraphs_per_1000: meta.paragraphs_per_1000,
        one_sentence_paragraph_share: meta.one_sentence_paragraph_share,
        dialogue_blocks_per_1000: meta.dialogue_blocks_per_1000,
        avg_paragraph_chars: meta.avg_paragraph_chars,
        median_paragraph_chars: meta.median_paragraph_chars,
        recalled: false,
      };
      samples.push({
        opaqueId: id,
        sourceId: source.id,
        variant: "generic",
        n,
        raw,
        rawFile,
        rawSha: sha256(raw),
        runtime,
      });
    }
    const v1Names = v1Files[source.id];
    v1Names.forEach((name, idx) => {
      const raw = v1Raw[name]!;
      const visible = vis(raw);
      const prose = proseMetrics(raw, visible);
      const id = opaqueId();
      const runtime = {
        http_status: null,
        finish_reason: null,
        ttft_ms: null,
        latency_ms: null,
        visible_chars: visible,
        korean_chars: koreanCharCount(raw),
        input_tokens: null,
        completion_tokens: null,
        reasoning_stream_observed: null,
        reasoning_chars: null,
        terminal_usage: null,
        incomplete_stream: null,
        usage_cost: null,
        ...prose,
        recalled: false,
        transport: "FROZEN_V1_REFERENCE_NOT_RECALLED",
      };
      samples.push({
        opaqueId: id,
        sourceId: source.id,
        variant: "v1",
        n: idx + 1,
        raw,
        rawFile: `v1-frozen/${name}`,
        rawSha: sha256(raw),
        runtime,
      });
    });
    packets[source.id] = shuffle(samples);
  }

  for (const sourceId of ["opus", "gemini31"] as const) {
    for (const sample of packets[sourceId]) {
      reveal[sample.opaqueId] = {
        source_id: sample.sourceId,
        variant: sample.variant,
        n: sample.n,
        raw_file: sample.rawFile,
        raw_sha256: sample.rawSha,
        v1_is_reference_only: sample.variant === "v1",
      };
      blindRuntime[sample.opaqueId] = {
        source_packet: sourceId,
        ...sample.runtime,
        raw_sha256: sample.rawSha,
      };
    }
  }

  save(
    DOCS,
    "BLIND_OPUS_GENERIC_VS_V1.md",
    renderBlindPacket({
      sourceLabel: "Opus",
      samples: packets.opus.map((s) => ({
        opaqueId: s.opaqueId,
        raw: s.raw,
        runtime: s.runtime,
      })),
    })
  );
  save(
    DOCS,
    "BLIND_GEMINI31_GENERIC_VS_V1.md",
    renderBlindPacket({
      sourceLabel: "Gemini31",
      samples: packets.gemini31.map((s) => ({
        opaqueId: s.opaqueId,
        raw: s.raw,
        runtime: s.runtime,
      })),
    })
  );
  save(DOCS, "BLIND_RUNTIME.json", {
    note: "Keyed by opaque id. Variant identity lives only in REVEAL_MAP.json.",
    quality_scoring_by_cursor: false,
    samples: blindRuntime,
  });
  save(DOCS, "REVEAL_MAP.json", {
    note: "Open only after ChatGPT finishes blind scoring.",
    quality_scoring_by_cursor: false,
    map: reveal,
  });

  const opusRows = newRows.filter((r) => r.source_id === "opus");
  const geminiRows = newRows.filter((r) => r.source_id === "gemini31");
  const genericBlockOcc = {
    opus: countOccurrences(
      assembledBySource.opus!.lastUserContent,
      assembledBySource.opus!.genericBlock
    ),
    gemini31: countOccurrences(
      assembledBySource.gemini31!.lastUserContent,
      assembledBySource.gemini31!.genericBlock
    ),
    system: 0,
  };

  const manifest = {
    status: "MUSE12_GENERIC_SINGLE_FIXTURE_CAPTURE_COMPLETE",
    question:
      "라이크 전용 스타일 힌트를 제거한 Generic Muse Mirror가 source output 자체만 읽고도 기존 Muse V1에 근접한 handoff 품질을 유지하는가?",
    not_a_generalization_audit: true,
    GENERALIZATION_PROVEN: false,
    QUALITY_SCORING_BY_CURSOR: false,
    QUALITY_REVIEW_STATUS: "PENDING_CHATGPT_MANUAL_REVIEW",
    SINGLE_FIXTURE_GENERIC_REGRESSION: "PENDING_CHATGPT_MANUAL_REVIEW",
    PRODUCTION_ROUTING_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    SOURCE_CALLS: 0,
    NEW_MUSE_CALLS: apiCalls,
    OPUS_GENERIC_CALLS: 3,
    GEMINI_GENERIC_CALLS: 3,
    QWEN_CALLS: 0,
    DEEPSEEK_CALLS: 0,
    GLM_CALLS: 0,
    V1_RECALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    MUSE_MODEL,
    MUSE_FINAL_WIRE: assembledBySource.opus!.wire.muse_fields,
    LIKE_SPECIFIC_PRODUCTION_OCCURRENCES: 0,
    GENERIC_BLOCK_OCCURRENCES: genericBlockOcc,
    frozen_sources: {
      opus: FROZEN_OPUS_SOURCE_SHA,
      gemini31: FROZEN_GEMINI_SOURCE_SHA,
    },
    frozen_v1: V1_SHA,
    new_raw_sha: Object.fromEntries(
      newRows.map((r) => [r.raw_file, r.raw_sha256])
    ),
    RAW_SHA_COMPLETE: newRows.every(
      (r) => typeof r.raw_sha256 === "string" && String(r.raw_sha256).length === 64
    ),
    calls: newRows,
    opus_summary: {
      HTTP: opusRows.map((r) => r.http_status),
      FINISH: opusRows.map((r) => r.finish_reason),
      VISIBLE_CHARS: listMetrics(opusRows.map((r) => r.visible_chars as number)),
      TTFT: listMetrics(opusRows.map((r) => r.ttft_ms as number | null)),
      LATENCY: listMetrics(opusRows.map((r) => r.latency_ms as number)),
      COMPLETION_TOKENS: listMetrics(
        opusRows.map((r) => r.completion_tokens as number | null)
      ),
      COST: listMetrics(opusRows.map((r) => r.usage_cost as number | null)),
    },
    gemini_summary: {
      HTTP: geminiRows.map((r) => r.http_status),
      FINISH: geminiRows.map((r) => r.finish_reason),
      VISIBLE_CHARS: listMetrics(geminiRows.map((r) => r.visible_chars as number)),
      TTFT: listMetrics(geminiRows.map((r) => r.ttft_ms as number | null)),
      LATENCY: listMetrics(geminiRows.map((r) => r.latency_ms as number)),
      COMPLETION_TOKENS: listMetrics(
        geminiRows.map((r) => r.completion_tokens as number | null)
      ),
      COST: listMetrics(geminiRows.map((r) => r.usage_cost as number | null)),
    },
    REASONING_STREAMS: newRows.filter((r) => r.reasoning_stream_observed === true).length,
    TERMINAL_USAGE: newRows.filter((r) => r.terminal_usage === true).length,
    INCOMPLETE_STREAMS: newRows.filter((r) => r.incomplete_stream === true).length,
    artifacts: {
      BLIND_OPUS_PACKET: `${DOCS}/BLIND_OPUS_GENERIC_VS_V1.md`,
      BLIND_GEMINI_PACKET: `${DOCS}/BLIND_GEMINI31_GENERIC_VS_V1.md`,
      BLIND_RUNTIME: `${DOCS}/BLIND_RUNTIME.json`,
      REVEAL_MAP: `${DOCS}/REVEAL_MAP.json`,
    },
  };
  save(DOCS, "MANIFEST.json", manifest);

  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        SOURCE_CALLS: 0,
        NEW_MUSE_CALLS: apiCalls,
        RAW_SHA_COMPLETE: manifest.RAW_SHA_COMPLETE,
        QUALITY_SCORING_BY_CURSOR: false,
        GENERALIZATION_PROVEN: false,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
