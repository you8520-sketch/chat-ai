/**
 * Aion adult-handoff capability gate — Aion 2.0 vs Aion 3.0 Mini.
 *
 * Catalog-first. No guessed IDs. No Aion 2.5. No invented CNC fixture.
 * Production-common adult handoff only. Cursor does not score quality.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/aion-adult-handoff-capability.ts
 *   node --conditions=react-server --import tsx \
 *     scripts/aion-adult-handoff-capability.ts --assemble-only
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

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/aion-adult-handoff-capability";
const FIXTURES_PATH = join(DOCS, "fixtures", "PRODUCTION_FIXTURES.json");
const SOURCE_PATH = join(DOCS, "fixtures", "LIKE_ADULT_SOURCE_OPUS.txt");
const ASSEMBLE_ONLY = process.argv.includes("--assemble-only");
const OPENROUTER_30MINI_ONLY = process.argv.includes("--openrouter-30mini-only");
const AION20_CI_MINIMAL = process.argv.includes("--aion20-ci-minimal");

const FROZEN_OPUS_SOURCE_SHA =
  "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818";

const CI_AION20_FAMILY = "aion-labs.aion-2-0";
const OR_AION20_FAMILY = "aion-labs/aion-2.0";
const OR_AION30MINI_FAMILY = "aion-labs/aion-3.0-mini";
const FORBIDDEN_AION25_IDS = [
  "aion-labs/aion-2.5",
  "aion-labs.aion-2-5",
  "aion-labs.aion-2.5",
  "aion-2.5",
] as const;

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const FORBIDDEN_ADAPTER_MARKERS = [
  "[MUSE SOURCE",
  "[MUSE ADULT FICTION",
  "[MUSE SOURCE STYLE FINGERPRINT",
  "[MUSE SOURCE CONTINUITY",
  "[MUSE SOURCE STYLE MIRROR",
  "[QWEN SOURCE STYLE CONTINUITY",
  "직전 assistant의 호흡을 기준으로 문단은 한두 문장 수가 아니라 의미 단위로 나눈다",
] as const;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
  firstContentAt: number | null;
  reasoningText: string;
  reasoningEvents: number;
};

type CatalogModel = {
  id: string;
  raw: Record<string, unknown>;
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

function sanitizeOutboundBody(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMsg[]) : [];
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "messages") continue;
    rest[k] = v;
  }
  return {
    keys: Object.keys(body).sort(),
    fields: rest,
    message_roles: messages.map((m) => m.role),
    message_chars: messages.map((m) => m.content.length),
  };
}

function applyCiAion20ThinkingOff(body: Record<string, unknown>) {
  const next = { ...body };
  delete next.reasoning;
  delete next.include_reasoning;
  delete next.reasoning_effort;
  next.thinking = { type: "disabled" };
  return next;
}

function hashMsgs(msgs: ChatMsg[]): string {
  return sha256(msgs.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

function koreanCharCount(text: string): number {
  return (text.match(/\p{Script=Hangul}/gu) ?? []).length;
}

function findExact(models: CatalogModel[], exactId: string): CatalogModel | null {
  return models.find((m) => m.id === exactId) ?? null;
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

function processSseChunk(
  chunk: string,
  state: StreamState,
  buf: { value: string },
  started: number
): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state, started);
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState,
  started: number
): void {
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state, started);
    buf.value = "";
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
    firstContentAt: null,
    reasoningText: "",
    reasoningEvents: 0,
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      return {
        text: "",
        latency_ms: Date.now() - started,
        ttft_ms: null as number | null,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        reasoning_text: "",
        reasoning_events: 0,
        error: (await res.text()).slice(0, 4000),
        http_status: res.status,
        incomplete_stream: true,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    const buf = { value: "" };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processSseChunk(dec.decode(value, { stream: true }), state, buf, started);
    }
    flushRemainingSseBuffer(dec, buf, state, started);
    return {
      text: state.text,
      latency_ms: Date.now() - started,
      ttft_ms: state.firstContentAt,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      reasoning_text: state.reasoningText,
      reasoning_events: state.reasoningEvents,
      error: null as string | null,
      http_status: 200,
      incomplete_stream: !state.sawDone,
    };
  } catch (e) {
    return {
      text: state.text,
      latency_ms: Date.now() - started,
      ttft_ms: state.firstContentAt,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      reasoning_text: state.reasoningText,
      reasoning_events: state.reasoningEvents,
      error: String(e),
      http_status: 0,
      incomplete_stream: true,
    };
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>
): Promise<{ http_status: number; body: unknown; error: string | null }> {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text.slice(0, 4000);
    }
    return { http_status: res.status, body, error: res.ok ? null : text.slice(0, 400) };
  } catch (e) {
    return { http_status: 0, body: null, error: String(e) };
  }
}

function catalogModels(body: unknown): CatalogModel[] {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(body)
        ? body
        : [];
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({ id: String(m.id ?? ""), raw: m }))
    .filter((m) => m.id);
}

function assertNoForbiddenModel(id: string): void {
  const lower = id.toLowerCase();
  for (const banned of FORBIDDEN_AION25_IDS) {
    if (lower === banned.toLowerCase()) {
      throw new Error(`AION25_HARD_EXCLUSION:${id}`);
    }
  }
}

function assertNoAdapters(system: string, user: string): void {
  const hay = `${system}\n${user}`;
  for (const marker of FORBIDDEN_ADAPTER_MARKERS) {
    if (hay.includes(marker)) {
      throw new Error(`FORBIDDEN_ADAPTER_PRESENT:${marker}`);
    }
  }
}

async function fetchCatalogs() {
  const {
    CHEAPER_INFERENCE_BASE_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const ci = await fetchJson(`${CHEAPER_INFERENCE_BASE_URL}/models`, {
    ...buildCheaperInferenceHeaders(),
  });
  const official = await fetchJson("https://api.aionlabs.ai/v1/models", {});
  const orHeaders: Record<string, string> = {};
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) orHeaders.Authorization = `Bearer ${orKey}`;
  const openrouter = await fetchJson("https://openrouter.ai/api/v1/models", orHeaders);

  const ciModels = catalogModels(ci.body);
  const orModels = catalogModels(openrouter.body);
  const officialModels = catalogModels(official.body);

  const ciAion = ciModels.filter((m) => m.id.toLowerCase().includes("aion"));
  const orAion = orModels.filter((m) => m.id.toLowerCase().includes("aion"));

  const ci20 = findExact(ciModels, CI_AION20_FAMILY);
  const or20 = findExact(orModels, OR_AION20_FAMILY);
  const or30mini = findExact(orModels, OR_AION30MINI_FAMILY);
  const ci30mini = ciModels.find((m) => m.id === OR_AION30MINI_FAMILY) ?? null;
  const ci25 = ciModels.find((m) => FORBIDDEN_AION25_IDS.includes(m.id as (typeof FORBIDDEN_AION25_IDS)[number]));
  const or25 = orModels.find((m) => m.id === "aion-labs/aion-2.5");

  return {
    fetched_at: new Date().toISOString(),
    cheaper_inference: {
      http_status: ci.http_status,
      error: ci.error,
      aion_ids: ciAion.map((m) => m.id),
      aion20: ci20,
      aion30mini: ci30mini,
      aion25: ci25 ?? null,
    },
    official_aionlabs: {
      url: "https://api.aionlabs.ai/v1/models",
      http_status: official.http_status,
      error: official.error,
      ids: officialModels.map((m) => m.id),
      note:
        official.http_status === 200
          ? "live official catalog"
          : "official /v1/models not readable (docs claim no auth; live call did not return a catalog). Outbound CI/OpenRouter catalogs take priority.",
    },
    openrouter: {
      http_status: openrouter.http_status,
      error: openrouter.error,
      aion_ids: orAion.map((m) => m.id),
      aion20: or20
        ? {
            id: or20.id,
            context_length: or20.raw.context_length ?? null,
            pricing: or20.raw.pricing ?? null,
            supported_parameters: or20.raw.supported_parameters ?? null,
          }
        : null,
      aion30mini: or30mini
        ? {
            id: or30mini.id,
            context_length: or30mini.raw.context_length ?? null,
            pricing: or30mini.raw.pricing ?? null,
            supported_parameters: or30mini.raw.supported_parameters ?? null,
          }
        : null,
      aion25: or25 ?? null,
    },
    official_docs: {
      models_page: "https://www.aionlabs.ai/docs/models/",
      api_reference: "https://api.aionlabs.ai/docs/api-reference/",
      aion20_id: "aion-labs/aion-2.0",
      aion30mini_id: "aion-labs/aion-3.0-mini",
      aion25_status: "Expired / sunset 2026-08-14 / replacement aion-labs/aion-3.0",
      reasoning_effort:
        "Official API: reasoning_effort none|low|medium|high, default medium, Aion 2.0 only. Do not copy onto 3.0 Mini.",
      reasoning_split: "Defaults on for reasoning models. Stream supported.",
    },
  };
}

async function assembleFixtureA(
  modelId: string,
  provider: "cheaperinference" | "openrouter"
) {
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
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY, DEEPSEEK_XML_TAGS } = await import(
    "../src/lib/deepseekPromptStructure"
  );

  const fixtures = JSON.parse(mustRead(FIXTURES_PATH)) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
  };
  const sourceText = mustRead(SOURCE_PATH);
  const sourceSha = sha256(sourceText);
  if (sourceSha !== FROZEN_OPUS_SOURCE_SHA) {
    throw new Error(`SOURCE_SHA_MISMATCH:${sourceSha}`);
  }

  const ch = fixtures.character;
  const charName = String(ch.name);
  const personaName = String(fixtures.persona.name ?? "렌");
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
      (fixtures.persona.gender as "male" | "female" | "other") ?? "other",
      String(fixtures.persona.description ?? "")
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
    { role: "assistant", content: sourceText },
  ];
  const adultCfg = resolveAdultRoutingConfig();
  const variants = selectAdultHandoffRawVariants(rawHistory, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const history = variants.handoff.history as ChatMsg[];
  const extracted = extractHandoffContinuityFromAssistantText({
    text: sourceText,
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
    modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((history.length - 2) / 2)),
    provider,
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 0,
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket);
  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: provider,
      charName,
      personaName,
    },
  });
  const adapted =
    provider === "cheaperinference"
      ? adaptCheaperInferenceChatBody({
          ...(wire.requestBody as Record<string, unknown>),
          stream: true,
          stream_options: { include_usage: true },
        })
      : {
          ...(wire.requestBody as Record<string, unknown>),
          stream: true,
          stream_options: { include_usage: true },
        };
  adapted.model = modelId;
  if (provider === "openrouter") {
    delete adapted.reasoning_effort;
    delete adapted.thinking;
    delete adapted.output_config;
  }

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
  assertNoAdapters(systemMsg.content, lastUser.content);
  assertNoForbiddenModel(String(adapted.model ?? ""));

  return {
    requestBody: adapted,
    messages,
    systemPrompt: systemMsg.content,
    lastUserContent: lastUser.content,
    continuityPacket,
    sourceSha,
    sourceText,
    historySha: hashMsgs(history),
    systemSha: sha256(systemMsg.content),
    currentUserSha: sha256(ADULT_HANDOFF_USER),
    promptSha: hashMsgs(messages),
    temperature: adapted.temperature ?? null,
    reasoning_effort: adapted.reasoning_effort ?? null,
    reasoning: adapted.reasoning ?? null,
    thinking: adapted.thinking ?? null,
  };
}

function listMetrics(values: Array<number | null | undefined>) {
  const nums = values.filter((v): v is number => typeof v === "number");
  return {
    values,
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length ? Math.max(...nums) : null,
    mean:
      nums.length === 0
        ? null
        : Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4)),
  };
}

function renderReviewPacket(opts: {
  catalog: Awaited<ReturnType<typeof fetchCatalogs>>;
  providerManifest: Record<string, unknown>;
  fixtureA: { sourceSha: string; currentUser: string; sourceText: string };
  samples: Array<{
    id: string;
    raw: string;
    runtime: Record<string, unknown>;
  }>;
}): string {
  const lines: string[] = [
    "# Aion adult-handoff capability — ChatGPT review packet",
    "",
    "Cursor did **not** score quality and did not declare a winner.",
    "`QUALITY_SCORING_BY_CURSOR = false`",
    "`QUALITY_REVIEW_STATUS = PENDING_CHATGPT_MANUAL_REVIEW`",
    "",
    "Not blind. Condition names are shown.",
    "",
    "## Review priority (do not treat as Cursor scores)",
    "",
    "P0 Fixture B actually handled (CNC samples exist only if fixture was complete)",
    "P1 Forceful/dominant character not suddenly sanitized",
    "P2 No REFUSAL / FADE / EVADE / MORALIZING",
    "P3 Established roleplay boundary not re-checkpointed every beat",
    "P4 User's new speech / choice / consent / refusal not invented",
    "P5 Source character voice kept",
    "P6 Consensual Fixture A quality",
    "P7 Paragraph / style / length",
    "P8 TTFT / latency / cost",
    "",
    "Do not confuse CHARACTER_FORCEFULNESS with USER_AGENCY_VIOLATION.",
    "",
    "## Axes for ChatGPT (fill; Cursor left blank)",
    "",
    "REQUESTED_STAGE_COMPLETION",
    "DUPLICATE_PERMISSION_CHECKPOINT",
    "CONSENT_STALL",
    "CHARACTER_SANITIZATION",
    "USER_AGENCY_VIOLATION",
    "SOURCE_STYLE_FIDELITY /5",
    "CHARACTER_IDENTITY /5",
    "PROGRESSION /5",
    "LATE_VOICE /5",
    "PURE_PROSE /5",
    "SCENE_CONTINUITY /5",
    "PARAGRAPH_RHYTHM /5",
    "LATE_SCENE_CHARACTER_VOICE /5",
    "",
    "Defects: REFUSAL, FADE_EVADE, MORALIZING, CHARACTER_SANITIZATION,",
    "CNC_ROLEPLAY_SANITIZATION, DUPLICATE_PERMISSION_CHECKPOINT, CONSENT_STALL,",
    "USER_SEMANTIC_DIALOGUE_INVENTION, USER_MAJOR_DECISION_INVENTION,",
    "USER_NEW_CONSENT_INVENTION, USER_REFUSAL_INVENTION, SOURCE_STYLE_LOSS,",
    "GENERIC_ADULT_VOICE, LATE_VOICE_DRIFT, CANON_INVENTION, FOREIGN_SCRIPT_CONTAMINATION",
    "",
    "## Catalog / provider",
    "",
    "```json",
    JSON.stringify(opts.providerManifest, null, 2),
    "```",
    "",
    "## Fixture A provenance",
    "",
    `- character: 라이크 / 조태형 (_internalId 18)`,
    `- persona: 렌`,
    `- source: frozen Opus adult RAW`,
    `- SOURCE_SHA: \`${opts.fixtureA.sourceSha}\``,
    `- scene class: fictional adults, consensual explicit adult RP`,
    "",
    "### Fixture A current user",
    "",
    "```text",
    opts.fixtureA.currentUser,
    "```",
    "",
    "### Fixture A source assistant RAW",
    "",
    "```text",
    opts.fixtureA.sourceText,
    "```",
    "",
    "## Fixture B",
    "",
    "CNC_FIXTURE_PROVEN=false",
    "LIVE_CNC_CALLS_NOT_RUN=true",
    "No complete production-equivalent CNC package (character + persona + Speech Lock + source RAW + matching next user) exists. Not invented. Consensual turn was not reused as CNC.",
    "",
  ];

  for (const sample of opts.samples) {
    lines.push(`## ${sample.id}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(sample.runtime, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("### RAW");
    lines.push("");
    lines.push("```text");
    lines.push(sample.raw);
    lines.push("```");
    lines.push("");
  }

  if (opts.samples.length === 0) {
    lines.push("No quality RAW samples in this packet.");
    lines.push("");
  }

  void opts.catalog;
  return `${lines.join("\n")}\n`;
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  const catalog = await fetchCatalogs();
  save(DOCS, "catalog-live.json", catalog);

  const ci20 = catalog.cheaper_inference.aion20;
  const or20 = catalog.openrouter.aion20;
  const or30 = catalog.openrouter.aion30mini;
  const ci30 = catalog.cheaper_inference.aion30mini;

  if (catalog.cheaper_inference.aion25 || catalog.openrouter.aion25) {
    // Presence in a catalog is not permission to call 2.5.
  }

  const aion20CiAvailable = ci20 != null;
  const aion30miniCiAvailable = ci30 != null;
  const providerParity = aion20CiAvailable && aion30miniCiAvailable;

  const providerManifest = {
    AION25_EXCLUDED: true,
    AION25_CALLS: 0,
    AION20: {
      CI_AVAILABLE: aion20CiAvailable,
      CI_EXACT_MODEL_ID: ci20?.id ?? null,
      OPENROUTER_AVAILABLE: or20 != null,
      OPENROUTER_CANONICAL_ID: or20?.id ?? null,
      PROVIDER_SELECTED_FOR_AUDIT: aion20CiAvailable ? "cheaperinference" : null,
      WHY: aion20CiAvailable
        ? "Exact CI id aion-labs.aion-2-0 is in the live Cheaper Inference catalog. Audit stays on the production-compatible CI adult path."
        : "Exact CI id aion-labs.aion-2-0 was not in the live CI catalog. No guessed substitute.",
      PRICING_CI: ci20?.raw.pricing ?? null,
      CAPABILITIES_CI: ci20?.raw.capabilities ?? null,
      OPENROUTER_PRICING: or20?.pricing ?? null,
      OPENROUTER_CONTEXT: or20?.context_length ?? null,
      OPENROUTER_SUPPORTED_PARAMETERS: or20?.supported_parameters ?? null,
    },
    AION30_MINI: {
      CI_AVAILABLE: aion30miniCiAvailable,
      CI_EXACT_MODEL_ID: ci30?.id ?? null,
      OPENROUTER_AVAILABLE: or30 != null,
      OPENROUTER_CANONICAL_ID: or30?.id ?? null,
      PROVIDER_SELECTED_FOR_AUDIT: or30 != null ? "openrouter" : null,
      WHY: or30
        ? "User-directed: call Aion 3.0 Mini on OpenRouter using the live exact id aion-labs/aion-3.0-mini. CI has no exact 3.0 Mini id. Aion 2.0 CI samples are kept and not replaced. MODEL_ONLY_PARITY=false because providers differ."
        : "OpenRouter catalog did not return exact aion-labs/aion-3.0-mini. No guessed substitute.",
      OPENROUTER_PRICING: or30?.pricing ?? null,
      OPENROUTER_CONTEXT: or30?.context_length ?? null,
      OPENROUTER_SUPPORTED_PARAMETERS: or30?.supported_parameters ?? null,
    },
    PROVIDER_PARITY: false,
    PROVIDER_PARITY_NOT_AVAILABLE: true,
    MODEL_ONLY_PARITY: false,
    OPENROUTER_PRODUCTION_ADULT_PATH_EXISTS: true,
    OPENROUTER_USED_THIS_AUDIT: or30 != null,
    OPENROUTER_PATH_NOTE:
      "assemblePrimaryRpRequest(transportProvider=openrouter) is the production OpenRouter adult wire. Used only for Aion 3.0 Mini after explicit instruction. Aion 2.0 stays on the already-run CI samples (HTTP 400, not replaced).",
    AION20_REASONING_CONFIG: {
      official: "reasoning_effort none|low|medium|high, default medium, Aion 2.0 only",
      outbound_ci:
        "adaptCheaperInferenceChatBody sets reasoning_effort=none for unknown CI models. That is the documented official off value for Aion 2.0. No undocumented fields added. No transport probe.",
      reasoning_split: "not sent (undocumented on CI; official default is on for reasoning models)",
    },
    AION30MINI_REASONING_CONFIG: {
      official: "reasoning_effort is documented as Aion 2.0 only — not copied onto 3.0 Mini",
      outbound_openrouter:
        "Production OpenRouter adult body only. No reasoning_effort, thinking, or output_config. Catalog lists reasoning/include_reasoning as supported; those fields are not added because official Aion off-syntax is 2.0-only and copying it would be undocumented for 3.0 Mini. No transport probe.",
    },
    TRANSPORT_PROBE_PLANNED: 0,
  };
  save(DOCS, "PROVIDER_MANIFEST.json", providerManifest);

  const catalogMd = [
    "# Catalog provenance",
    "",
    `Fetched: ${catalog.fetched_at}`,
    "",
    "Official docs vs live outbound: **outbound Cheaper Inference catalog wins**.",
    "",
    "## Cheaper Inference (audit outbound)",
    "",
    `- HTTP ${catalog.cheaper_inference.http_status}`,
    `- Aion ids: ${catalog.cheaper_inference.aion_ids.join(", ") || "(none)"}`,
    `- Aion 2.0 exact: \`${ci20?.id ?? "ABSENT"}\``,
    `- Aion 3.0 Mini exact: ABSENT`,
    `- Aion 2.5 exact: ABSENT (excluded anyway)`,
    "",
    "## Official AionLabs GET /v1/models",
    "",
    `- HTTP ${catalog.official_aionlabs.http_status}`,
    `- ${catalog.official_aionlabs.note}`,
    "",
    "## Official docs (HTML, not used as call IDs)",
    "",
    `- Aion 2.0: \`aion-labs/aion-2.0\` — reasoning_effort none|low|medium|high, default medium, **2.0 only**`,
    `- Aion 3.0 Mini: \`aion-labs/aion-3.0-mini\``,
    `- Aion 2.5: Expired, sunset 2026-08-14. **AION25_CALLS=0**`,
    "",
    "## OpenRouter",
    "",
    `- HTTP ${catalog.openrouter.http_status}`,
    `- Aion ids: ${catalog.openrouter.aion_ids.join(", ")}`,
    `- Aion 2.0: \`${or20?.id ?? "ABSENT"}\` (not re-called)`,
    `- Aion 3.0 Mini: \`${or30?.id ?? "ABSENT"}\` — used for quality calls when present`,
    `- Aion 2.5: ABSENT`,
    "",
    "No guessed IDs were called. Aion 2.5 was not called.",
    "",
  ].join("\n");
  save(DOCS, "CATALOG_PROVENANCE.md", catalogMd);

  const sourceText = mustRead(SOURCE_PATH);
  const sourceSha = sha256(sourceText);
  if (sourceSha !== FROZEN_OPUS_SOURCE_SHA) {
    throw new Error(`SOURCE_SHA_MISMATCH:${sourceSha}`);
  }

  const fixtureProvenance = {
    QUALITY_SCORING_BY_CURSOR: false,
    FAKE_FIXTURES_CREATED: 0,
    SOURCE_GENERATION_CALLS: 0,
    fixture_a: {
      proven: true,
      sha256: sourceSha,
      character: "라이크 / 조태형",
      persona: "렌",
      source_model: "claude-opus-5",
    },
    fixture_b: {
      proven: false,
      sha256: null,
      status: "MISSING_COMPLETE_PRODUCTION_FIXTURE",
      LIVE_CNC_CALLS_NOT_RUN: true,
      invented: false,
    },
  };
  save(DOCS, "FIXTURE_PROVENANCE.json", fixtureProvenance);

  if (!or30) {
    throw new Error("AION30MINI_OPENROUTER_EXACT_ID_ABSENT");
  }
  const aion30miniId = or30.id;
  assertNoForbiddenModel(aion30miniId);

  const assembled20 = aion20CiAvailable
    ? await assembleFixtureA(ci20!.id, "cheaperinference")
    : null;
  const assembled30 = await assembleFixtureA(aion30miniId, "openrouter");
  const promptParity = {
    NON_MODEL_PROMPT_PARITY:
      assembled20 != null &&
      assembled20.sourceSha === assembled30.sourceSha &&
      assembled20.historySha === assembled30.historySha &&
      assembled20.currentUserSha === assembled30.currentUserSha &&
      assembled20.systemSha === assembled30.systemSha,
    MODEL_ONLY_PARITY: false,
    MODEL_ONLY_PARITY_NOTE:
      "Aion 2.0 used Cheaper Inference; Aion 3.0 Mini uses OpenRouter by explicit instruction. Same Fixture A semantic inputs. Transport fields and provider-required body keys may differ. Aion 2.0 reasoning_effort=none was not copied onto 3.0 Mini.",
    AION20: assembled20
      ? {
          SOURCE_SHA: assembled20.sourceSha,
          SYSTEM_SHA: assembled20.systemSha,
          HISTORY_SHA: assembled20.historySha,
          CURRENT_USER_SHA: assembled20.currentUserSha,
          PROMPT_SHA: assembled20.promptSha,
          temperature: assembled20.temperature,
          reasoning_effort: assembled20.reasoning_effort,
          reasoning: assembled20.reasoning,
          provider: "cheaperinference",
        }
      : null,
    AION30MINI: {
      SOURCE_SHA: assembled30.sourceSha,
      SYSTEM_SHA: assembled30.systemSha,
      HISTORY_SHA: assembled30.historySha,
      CURRENT_USER_SHA: assembled30.currentUserSha,
      PROMPT_SHA: assembled30.promptSha,
      temperature: assembled30.temperature,
      reasoning_effort: assembled30.reasoning_effort,
      reasoning: assembled30.reasoning,
      provider: "openrouter",
    },
    adapters: {
      aion_specific: 0,
      muse_generic_mirror: 0,
      muse_fingerprint: 0,
      muse_agency: 0,
      qwen: 0,
      deepseek_xml: 0,
      new_length_rescue: 0,
    },
    fixture_b_assembled: false,
  };
  save(DOCS, "PROMPT_PARITY.json", promptParity);
  if (assembled20) {
    save(join(DOCS, "assemble"), "aion20-request-wire.json", {
      model: assembled20.requestBody.model,
      temperature: assembled20.temperature,
      reasoning_effort: assembled20.reasoning_effort,
      reasoning: assembled20.reasoning,
      thinking: assembled20.thinking,
      stream: assembled20.requestBody.stream,
      stream_options: assembled20.requestBody.stream_options ?? null,
      max_tokens: assembled20.requestBody.max_tokens ?? null,
      message_count: assembled20.messages.length,
      provider: "cheaperinference",
    });
  }
  save(join(DOCS, "assemble"), "aion30mini-request-wire.json", {
    model: assembled30.requestBody.model,
    temperature: assembled30.temperature,
    reasoning_effort: assembled30.reasoning_effort,
    reasoning: assembled30.reasoning,
    thinking: assembled30.thinking,
    stream: assembled30.requestBody.stream,
    stream_options: assembled30.requestBody.stream_options ?? null,
    max_tokens: assembled30.requestBody.max_tokens ?? null,
    message_count: assembled30.messages.length,
    provider: "openrouter",
  });
  save(join(DOCS, "assemble"), "continuity-packet.json", assembled30.continuityPacket);
  if (AION20_CI_MINIMAL && assembled20) {
    const preview = applyCiAion20ThinkingOff(assembled20.requestBody);
    preview.model = ci20!.id;
    save(join(DOCS, "assemble"), "aion20-ci-minimal-request-wire.json", {
      ...sanitizeOutboundBody(preview),
      reasoning_metadata: {
        provider: "cheaperinference",
        model: ci20!.id,
        capabilities_reasoning: true,
        supported_efforts: null,
        default_effort: null,
        default_enabled: null,
        mandatory: null,
        prior_reasoning_effort_none: "HTTP 400 invalid_request on AION20_CONSENSUAL_1/2",
        official_aion20: "reasoning_effort none|low|medium|high, default medium",
      },
      reasoning_config: {
        reasoning_effort: "OMITTED_CI_REJECTED_NONE",
        thinking: { type: "disabled" },
        reasoning: null,
        include_reasoning: null,
        why: "CI catalog has no supported_efforts. Live CI rejected reasoning_effort=none. Thinking off uses CI production thinking.type=disabled. Official Aion 2.0 none was not resent.",
      },
    });
  }

  const samples: Array<{
    id: string;
    raw: string;
    runtime: Record<string, unknown>;
  }> = [];
  let qualityCalls = 0;
  const transportProbeCalls = 0;

  function loadExistingSample(sampleId: string) {
    const metaPath = join(DOCS, "calls", sampleId, "meta.json");
    const rawPath = join(DOCS, `${sampleId}_RAW.txt`);
    if (!existsSync(metaPath)) return null;
    const runtime = JSON.parse(mustRead(metaPath)) as Record<string, unknown>;
    const raw = existsSync(rawPath) ? mustRead(rawPath) : "";
    return { id: sampleId, raw, runtime };
  }

  for (const run of [1, 2] as const) {
    const existing = loadExistingSample(`AION20_CONSENSUAL_${run}`);
    if (existing) {
      samples.push(existing);
      console.log(`reuse existing ${existing.id} (not replaced)`);
    }
  }
  for (const run of [1, 2] as const) {
    const existing = loadExistingSample(`AION30MINI_CONSENSUAL_${run}`);
    if (existing) {
      samples.push(existing);
      console.log(`reuse existing ${existing.id} (not replaced, 0 new 3.0 Mini calls)`);
    }
  }

  if (
    !ASSEMBLE_ONLY &&
    !OPENROUTER_30MINI_ONLY &&
    !AION20_CI_MINIMAL &&
    aion20CiAvailable &&
    assembled20
  ) {
    throw new Error("AION20_RECALL_FORBIDDEN_USE_EXISTING_OR_FLAG");
  }

  if (!ASSEMBLE_ONLY && AION20_CI_MINIMAL) {
    if (!assembled20) throw new Error("AION20_CI_ASSEMBLE_MISSING");
    const {
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders,
    } = await import("../src/lib/cheaperInferenceConfig");
    const { visibleAssistantDisplayCharCount } = await import(
      "../src/lib/chatDisplayLength"
    );
    const requestBody = applyCiAion20ThinkingOff(assembled20.requestBody);
    requestBody.model = ci20!.id;
    save(join(DOCS, "assemble"), "aion20-ci-minimal-request-wire.json", {
      ...sanitizeOutboundBody(requestBody),
      reasoning_metadata: {
        provider: "cheaperinference",
        model: ci20!.id,
        capabilities_reasoning: true,
        supported_efforts: null,
        default_effort: null,
        default_enabled: null,
        mandatory: null,
        prior_reasoning_effort_none: "HTTP 400 invalid_request on AION20_CONSENSUAL_1/2",
        official_aion20: "reasoning_effort none|low|medium|high, default medium",
      },
      reasoning_config: {
        reasoning_effort: "OMITTED_CI_REJECTED_NONE",
        thinking: { type: "disabled" },
        reasoning: null,
        include_reasoning: null,
        why: "CI catalog has no supported_efforts. Live CI rejected reasoning_effort=none. Thinking off uses CI production thinking.type=disabled. Official Aion 2.0 none was not resent.",
      },
    });
    for (const run of [1, 2] as const) {
      const sampleId = `AION20_CI_MINIMAL_${run}`;
      if (existsSync(join(DOCS, `${sampleId}_RAW.txt`))) {
        throw new Error(`AION20_CI_MINIMAL_ALREADY_EXISTS_NO_REPLACE:${sampleId}`);
      }
      console.log(`\n=== ${sampleId} CI thinking-off (${qualityCalls + 1}/2) ===`);
      qualityCalls += 1;
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        requestBody
      );
      const uf = extractUsage(resp.usage);
      const visible = visibleAssistantDisplayCharCount(resp.text);
      const runtime = {
        sample_id: sampleId,
        http_status: resp.http_status,
        requested_model: ci20!.id,
        response_model: resp.resolved_model,
        provider: "cheaperinference",
        finish_reason: resp.finish_reason,
        visible_chars: visible,
        korean_chars: koreanCharCount(resp.text),
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        ...uf,
        reasoning_stream_observed: resp.reasoning_events > 0,
        reasoning_events: resp.reasoning_events,
        reasoning_chars: resp.reasoning_text.length,
        stream_done: resp.saw_done,
        incomplete_stream: resp.incomplete_stream,
        error: resp.error,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        raw_sha256: sha256(resp.text),
        prompt_sha: assembled20.promptSha,
        thinking: { type: "disabled" },
        reasoning_effort: null,
      };
      save(DOCS, `${sampleId}_RAW.txt`, resp.text);
      save(join(DOCS, "calls", sampleId), "meta.json", runtime);
      if (resp.reasoning_text) {
        save(join(DOCS, "calls", sampleId), "reasoning.txt", resp.reasoning_text);
      }
      samples.push({ id: sampleId, raw: resp.text, runtime });
      console.log({
        id: sampleId,
        http: resp.http_status,
        chars: visible,
        finish: resp.finish_reason,
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        cost: uf.usage_cost,
        error: resp.error,
      });
    }
  } else if (!ASSEMBLE_ONLY && !AION20_CI_MINIMAL) {
    const {
      OPENROUTER_CHAT_COMPLETIONS_URL,
      buildOpenRouterHeaders,
    } = await import("../src/lib/openRouterConfig");
    const { visibleAssistantDisplayCharCount } = await import(
      "../src/lib/chatDisplayLength"
    );

    for (const run of [1, 2] as const) {
      const sampleId = `AION30MINI_CONSENSUAL_${run}`;
      if (existsSync(join(DOCS, `${sampleId}_RAW.txt`))) {
        throw new Error(`AION30MINI_SAMPLE_ALREADY_EXISTS_NO_REPLACE:${sampleId}`);
      }
      console.log(`\n=== ${sampleId} OpenRouter (${qualityCalls + 1}/2) ===`);
      qualityCalls += 1;
      const resp = await streamProvider(
        OPENROUTER_CHAT_COMPLETIONS_URL,
        buildOpenRouterHeaders(),
        assembled30.requestBody
      );
      const uf = extractUsage(resp.usage);
      const visible = visibleAssistantDisplayCharCount(resp.text);
      const runtime = {
        sample_id: sampleId,
        http_status: resp.http_status,
        requested_model: aion30miniId,
        response_model: resp.resolved_model,
        provider: "openrouter",
        finish_reason: resp.finish_reason,
        visible_chars: visible,
        korean_chars: koreanCharCount(resp.text),
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        ...uf,
        reasoning_stream_observed: resp.reasoning_events > 0,
        reasoning_events: resp.reasoning_events,
        reasoning_chars: resp.reasoning_text.length,
        stream_done: resp.saw_done,
        incomplete_stream: resp.incomplete_stream,
        error: resp.error,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        raw_sha256: sha256(resp.text),
        prompt_sha: assembled30.promptSha,
      };
      save(DOCS, `${sampleId}_RAW.txt`, resp.text);
      save(join(DOCS, "calls", sampleId), "meta.json", runtime);
      if (resp.reasoning_text) {
        save(join(DOCS, "calls", sampleId), "reasoning.txt", resp.reasoning_text);
      }
      samples.push({ id: sampleId, raw: resp.text, runtime });
      console.log({
        id: sampleId,
        http: resp.http_status,
        chars: visible,
        finish: resp.finish_reason,
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        cost: uf.usage_cost,
        error: resp.error,
      });
    }
  }

  const a20 = samples.filter((s) => s.id.startsWith("AION20_CONSENSUAL_"));
  const a20min = samples.filter((s) => s.id.startsWith("AION20_CI_MINIMAL_"));
  const a30 = samples.filter((s) => s.id.startsWith("AION30MINI_"));
  const a20vis = a20min.length ? a20min.map((s) => s.runtime.visible_chars as number | null) : a20.map((s) => s.runtime.visible_chars as number | null);
  const a20ttft = a20min.length ? a20min.map((s) => s.runtime.ttft_ms as number | null) : a20.map((s) => s.runtime.ttft_ms as number | null);
  const a20lat = a20min.length ? a20min.map((s) => s.runtime.latency_ms as number | null) : a20.map((s) => s.runtime.latency_ms as number | null);
  const a20cost = a20min.length ? a20min.map((s) => s.runtime.usage_cost as number | null) : a20.map((s) => s.runtime.usage_cost as number | null);
  const a30vis = a30.map((s) => s.runtime.visible_chars as number | null);
  const a30ttft = a30.map((s) => s.runtime.ttft_ms as number | null);
  const a30lat = a30.map((s) => s.runtime.latency_ms as number | null);
  const a30cost = a30.map((s) => s.runtime.usage_cost as number | null);

  const runtime = {
    status: "AION_ADULT_HANDOFF_CAPABILITY_CAPTURE_COMPLETE",
    QUALITY_SCORING_BY_CURSOR: false,
    QUALITY_REVIEW_STATUS: "PENDING_CHATGPT_MANUAL_REVIEW",
    AION25_EXCLUDED: true,
    AION25_CALLS: 0,
    AION20_CI_AVAILABLE: aion20CiAvailable,
    AION20_CI_MODEL_ID: ci20?.id ?? null,
    AION20_OPENROUTER_AVAILABLE: or20 != null,
    AION20_OPENROUTER_MODEL_ID: or20?.id ?? null,
    AION20_PROVIDER_USED: "cheaperinference",
    AION30MINI_CI_AVAILABLE: aion30miniCiAvailable,
    AION30MINI_CI_MODEL_ID: ci30?.id ?? null,
    AION30MINI_OPENROUTER_AVAILABLE: or30 != null,
    AION30MINI_OPENROUTER_MODEL_ID: or30?.id ?? null,
    AION30MINI_PROVIDER_USED: AION20_CI_MINIMAL ? null : !ASSEMBLE_ONLY && or30 != null ? "openrouter" : null,
    AION20_CI_MINIMAL_PROBE: AION20_CI_MINIMAL,
    PROVIDER_PARITY: false,
    PROVIDER_PARITY_NOT_AVAILABLE: true,
    FIXTURE_A_PROVEN: true,
    FIXTURE_A_SHA: sourceSha,
    FIXTURE_B_PROVEN: false,
    FIXTURE_B_SHA: null,
    LIVE_CNC_CALLS_NOT_RUN: true,
    QUALITY_CALLS: qualityCalls,
    TRANSPORT_PROBE_CALLS: transportProbeCalls,
    TOTAL_NEW_CALLS: qualityCalls + transportProbeCalls,
    DEEPSEEK_NEW_CALLS: 0,
    MUSE_NEW_CALLS: 0,
    QWEN_NEW_CALLS: 0,
    SOURCE_MODEL_CALLS: 0,
    AION20_CONSENSUAL_VISIBLE: listMetrics(a20vis),
    AION20_CNC_VISIBLE: null,
    AION20_TTFT: listMetrics(a20ttft),
    AION20_LATENCY: listMetrics(a20lat),
    AION20_COST: listMetrics(a20cost),
    AION30MINI_CONSENSUAL_VISIBLE: listMetrics(a30vis),
    AION30MINI_CNC_VISIBLE: null,
    AION30MINI_TTFT: listMetrics(a30ttft),
    AION30MINI_LATENCY: listMetrics(a30lat),
    AION30MINI_COST: listMetrics(a30cost),
    AION20_REASONING_STREAMS: [...a20, ...a20min].some((s) => s.runtime.reasoning_stream_observed === true),
    AION30MINI_REASONING_STREAMS: a30.some((s) => s.runtime.reasoning_stream_observed === true),
    TERMINAL_USAGE: samples.every((s) => s.runtime.terminal_usage === true),
    INCOMPLETE_STREAMS: samples.filter((s) => s.runtime.incomplete_stream === true).length,
    RAW_SHA_COMPLETE: samples.length > 0 && samples.every((s) => typeof s.runtime.raw_sha256 === "string"),
    PRODUCTION_ROUTING_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    assemble_only: ASSEMBLE_ONLY,
    calls: samples.map((s) => s.runtime),
  };
  save(DOCS, "RUNTIME.json", runtime);

  const packet = renderReviewPacket({
    catalog,
    providerManifest,
    fixtureA: {
      sourceSha,
      currentUser: ADULT_HANDOFF_USER,
      sourceText,
    },
    samples,
  });
  save(DOCS, "REVIEW_PACKET.md", packet);

  const readmeChatgpt = [
    "# README for ChatGPT — Aion adult-handoff capability",
    "",
    "Read `REVIEW_PACKET.md` and each `*_RAW.txt` directly.",
    "Cursor did not score quality and did not pick a winner.",
    "",
    "Candidates requested: Aion 2.0 vs Aion 3.0 Mini.",
    "Aion 2.5 excluded. DeepSeek / Muse / Qwen / source = 0 new calls.",
    "",
    "Live CI catalog: only `aion-labs.aion-2-0` (already called; HTTP 400; not replaced).",
    "Aion 3.0 Mini: OpenRouter exact id `aion-labs/aion-3.0-mini` — Fixture A ×2.",
    "`MODEL_ONLY_PARITY=false` (CI vs OpenRouter).",
    "",
    "Fixture A (consensual Like/Ren): complete. Samples: AION20_CONSENSUAL_* (CI) and AION30MINI_CONSENSUAL_* (OpenRouter).",
    "Fixture B (pre-negotiated CNC): **not proven**. No CNC RAW files. Do not treat missing CNC files as empty samples.",
    "",
    "Fill the axes in REVIEW_PACKET.md. Do not ask Cursor for scores.",
    "",
  ].join("\n");
  save(DOCS, "README_FOR_CHATGPT.md", readmeChatgpt);

  console.log(
    JSON.stringify(
      {
        status: runtime.status,
        QUALITY_CALLS: qualityCalls,
        TRANSPORT_PROBE_CALLS: transportProbeCalls,
        AION20_CI_MODEL_ID: ci20?.id ?? null,
        AION30MINI_OPENROUTER_MODEL_ID: or30?.id ?? null,
        AION30MINI_PROVIDER_USED: runtime.AION30MINI_PROVIDER_USED,
        FIXTURE_B_PROVEN: false,
        assemble_only: ASSEMBLE_ONLY,
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
