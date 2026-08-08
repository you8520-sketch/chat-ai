/**
 * Phase D5-B — Gemini 3.1 Pro runtime stability (provider → reasoning → budget).
 *
 * PROMPT CHANGE = 0
 * SYSTEM OWNER CHANGE = 0
 * CONTEXT PACKAGING CHANGE = 0
 * PRODUCTION WIRE = 0
 * PRODUCTION CODE DIFF = 0
 *
 * Sole live variable for B1: provider pin inserted AFTER production assemble
 * (production applyGeminiProReasoning deletes body.provider).
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d5b-gemini-runtime-stability.ts
 *   D5B_PHASE=B1 node --conditions=react-server --import tsx scripts/rp-quality-d5b-gemini-runtime-stability.ts
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  computeRpQualityVectorV2,
  extractDialogueSpans,
  splitParagraphs,
  isDialogueParagraph,
  type SettingSource,
} from "../src/lib/rpQualityVector";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const PHASE = (process.env.D5B_PHASE ?? "B1").toUpperCase();
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d5b-runtime-stability";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-runtime-d5b";
const RAW_DOCS = join(DOCS, "raw");
const FIXTURE_DIR = "docs/audits/rp-quality-v2-gemini/fixtures";
const DRAWS = 3;

/** Exact OpenRouter provider slugs from GET /api/v1/providers (2026-08-08). */
const PROVIDER_ARMS = [
  {
    arm: "P1",
    slug: "google-vertex",
    expected_display: "Google",
    label: "Google Vertex",
  },
  {
    arm: "P2",
    slug: "google-ai-studio",
    expected_display: "Google AI Studio",
    label: "Google AI Studio",
  },
] as const;

type FixtureId = "G5" | "G6T1" | "G3";

type FixtureSpec = {
  id: FixtureId;
  characterId: number;
  userInput: string;
  provenance: string;
  measures: string[];
};

const FIXTURES: Record<FixtureId, FixtureSpec> = {
  G5: {
    id: "G5",
    characterId: 10,
    userInput: "누구세요? …방금 그 소리는 뭐였죠?",
    provenance:
      "D5-B G5 — short Turn-1 after greeting already established shutter/ruins event (Enoch)",
    measures: [
      "INTRO_REPLAY",
      "SETTING_RECITAL",
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
    ],
  },
  G6T1: {
    id: "G6T1",
    characterId: 10,
    userInput:
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    provenance:
      "D5-B G6-T1 — highest D5-A variance (606/2699/881, max/min 4.45)",
    measures: [
      "CURRENT_INPUT_REPLAY",
      "SCENE_ADVANCEMENT",
      "NEW_SCENE_VALUE",
      "visible_chars",
    ],
  },
  G3: {
    id: "G3",
    characterId: 10,
    userInput:
      "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
    provenance:
      "D5-B G3 — canon-required: 총성=죽음 / 통제형 에녹 must refuse gunshot",
    measures: [
      "ACTIVE_CANON_USE",
      "CHARACTER_FIDELITY",
      "SETTING_RECITAL",
      "SCENE_ADVANCEMENT",
    ],
  },
};

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  generationId: string | null;
  provider: string | null;
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
  if (typeof ev.id === "string" && !state.generationId) {
    state.generationId = ev.id;
  }
  if (typeof ev.model === "string") state.resolved = ev.model;
  if (ev.provider && typeof ev.provider === "object") {
    const p = ev.provider as Record<string, unknown>;
    if (typeof p.name === "string") state.provider = p.name;
  }
  if (typeof ev.provider === "string") state.provider = ev.provider;
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0 && typeof choice0.finish_reason === "string") {
    state.finish = choice0.finish_reason;
  }
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") state.text += delta.content;
  if (typeof choice0?.text === "string") state.text += choice0.text;
}

function processSseChunk(chunk: string, buf: string, state: StreamState) {
  const combined = buf + chunk;
  const lines = combined.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) processSseLine(line, state);
  return rest;
}

function flushRemainingSseBuffer(buf: string, state: StreamState) {
  if (buf.trim()) processSseLine(buf, state);
}

function isTransportAbort(error: string | null, httpStatus: number) {
  if (httpStatus === 0 || httpStatus >= 500) return true;
  if (!error) return false;
  return /abort|ECONNRESET|socket|fetch failed|network/i.test(error);
}

function providerMatchesArm(
  actual: string | null,
  expectedDisplay: string
): boolean {
  if (!actual) return false;
  const a = actual.trim().toLowerCase();
  const e = expectedDisplay.trim().toLowerCase();
  if (a === e) return true;
  // Accept exact family labels only — reject cross-family fallback.
  if (e === "google" && (a === "google" || a === "google vertex")) return true;
  if (e === "google ai studio" && a.includes("ai studio")) return true;
  return false;
}

async function streamOpenRouter(body: Record<string, unknown>) {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterHeaders } =
    await import("../src/lib/openRouterConfig");
  const t0 = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    generationId: null,
    provider: null,
    sawDone: false,
  };
  const responseHeaders: Record<string, string> = {};
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    for (const [k, v] of res.headers.entries()) {
      if (
        /provider|generation|request|ratelimit|model|openrouter/i.test(k) ||
        k.startsWith("x-")
      ) {
        responseHeaders[k] = v;
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        generation_id: null as string | null,
        provider: null as string | null,
        response_headers: responseHeaders,
        saw_done: false,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = processSseChunk(decoder.decode(value, { stream: true }), buf, state);
    }
    flushRemainingSseBuffer(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function loadFixture(characterId: number) {
  const path = join(FIXTURE_DIR, `c${characterId}_fixture.json`);
  return JSON.parse(readFileSync(path, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
}

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      total_tokens: null as number | null,
      visible_budget_tokens: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  const promptDetails =
    (usage.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  const reasoning =
    typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens
      : typeof usage.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : null;
  const output =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : null;
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : null,
    output_tokens: output,
    reasoning_tokens: reasoning,
    total_tokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    visible_budget_tokens:
      output != null && reasoning != null ? output - reasoning : null,
    prompt_tokens_details: promptDetails,
    completion_tokens_details: details,
  };
}

function scoreResponseAnchorCount(text: string): {
  response_anchor_count: number;
  band: "IDEAL" | "ACCEPTABLE" | "RESPONSE_OVERLOAD";
  samples: string[];
} {
  const dialogue = extractDialogueSpans(text)
    .map((s) => s.content.trim())
    .filter(Boolean);
  const samples: string[] = [];
  let count = 0;
  for (const d of dialogue) {
    const hits =
      d.match(
        /[?？]|까요|래요|세요|할까요|할까요\?|어때|어떡|가자|가요|해줘|해줄래|와줄|와 줄|같이|그만|멈춰|들어|말해|설명해|알려/
      ) != null;
    if (hits || (/[!！]$/.test(d) && /해|가|와|봐|들어/.test(d))) {
      count += 1;
      if (samples.length < 8) samples.push(d.slice(0, 80));
    }
  }
  for (const p of splitParagraphs(text)) {
    if (isDialogueParagraph(p)) continue;
    if (/당신은|유저는|렌은.{0,8}(해야|대답|선택)/.test(p)) {
      count += 1;
    }
  }
  const band =
    count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "RESPONSE_OVERLOAD";
  return { response_anchor_count: count, band, samples };
}

function scoreDialogueFunctionLoad(text: string): {
  dialogue_function_load: number;
  functions: string[];
} {
  const joined = extractDialogueSpans(text)
    .map((s) => s.content)
    .join("\n");
  const checks: Array<[string, RegExp]> = [
    ["question", /[?？]|까요|래요|세요|어때|어떡/],
    ["explanation", /왜냐하면|이유는|뜻은|의미|설명|이니까|거든/],
    ["joke", /농담|웃기|ㅋ|하하|호호|장난/],
    ["warning", /위험|죽어|죽|경고|안 돼|안돼|하지 마|하지마|총성|죽음/],
    ["proposal", /하자|할까요|같이|가자|가요|제안|차라리/],
    ["relationship_claim", /믿|좋아|싫어|우리|너(?:는|만)|함께|곁/],
    ["directive", /해|가|와|들어|멈춰|치워|버려|따라|숨/],
  ];
  const functions: string[] = [];
  for (const [name, re] of checks) {
    if (re.test(joined)) functions.push(name);
  }
  return { dialogue_function_load: functions.length, functions };
}

function maxDialogueBlockChars(text: string): number {
  let max = 0;
  for (const span of extractDialogueSpans(text)) {
    const n = span.content.replace(/\s+/g, "").length;
    if (n > max) max = n;
  }
  return max;
}

function dialogueShareBand(share: number): string {
  if (share >= 0.1 && share <= 0.15) return "IDEAL";
  if (share >= 0.06 && share <= 0.18) return "ACCEPTABLE";
  if (share > 0.25) return "DIALOGUE_OVERLOAD_CANDIDATE";
  if (share > 0.2) return "STRONG_REVIEW";
  return "BELOW_IDEAL_OR_REVIEW";
}

async function assembleProductionA(opts: {
  modelId: string;
  fixture: ReturnType<typeof loadFixture>;
  spec: FixtureSpec;
}) {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");

  const ch = { ...opts.fixture.character };
  const persona = { ...opts.fixture.persona };
  const personaName = String(persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(opts.fixture.user.nickname ?? personaName)
  );
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const greeting = String(ch.greeting ?? "");
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: greeting },
    ],
    currentUserMessage: opts.spec.userInput,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.fixture.user.id ?? 4),
    narrativePov,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: opts.modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });

  const body = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages =
    (body.messages as Array<{ role: string; content: string }>) ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");
  const messagesCanonical = JSON.stringify(messages);

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [
        String(ch.system_prompt ?? ""),
        String(ch.speech_profile ?? ""),
        String(ch.example_dialog ?? ""),
      ].join("\n"),
    },
    {
      bucket: "WORLD_CANON",
      text: [String(ch.world ?? ""), String(ch.setting_chunks ?? "")].join("\n"),
    },
    {
      bucket: "USER_PERSONA",
      text: String(persona.description ?? ""),
    },
    {
      bucket: "CURRENT_USER_INPUT",
      text: opts.spec.userInput,
    },
    {
      bucket: "MEMORY",
      text: "",
    },
  ];

  return {
    requestBody: body,
    systemSha: sha256(String(systemMsg?.content ?? built.systemPrompt)),
    messagesSha: sha256(messagesCanonical),
    userTailSha: sha256(String(lastUser?.content ?? "")),
    greeting,
    settingSources,
    productionGenerationConfig: {
      model: body.model ?? opts.modelId,
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      max_tokens: body.max_tokens ?? null,
      seed: body.seed ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      frequency_penalty: body.frequency_penalty ?? null,
      presence_penalty: body.presence_penalty ?? null,
      provider: body.provider ?? null,
    },
  };
}

/** Experiment-only: pin provider AFTER production BYTE_IDENTICAL assemble. */
function withProviderPin(
  productionBody: Record<string, unknown>,
  slug: string
): Record<string, unknown> {
  return {
    ...productionBody,
    provider: {
      only: [slug],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
}

function summarizeArm(rows: Array<Record<string, unknown>>) {
  const chars = rows.map((r) => Number(r.visible_chars));
  const rts = rows
    .map((r) => r.reasoning_tokens)
    .filter((x): x is number => typeof x === "number");
  const min = Math.min(...chars);
  const max = Math.max(...chars);
  return {
    n: chars.length,
    chars,
    min,
    max,
    mean: mean(chars),
    median: median(chars),
    max_min_ratio: min > 0 ? max / min : null,
    reasoning_tokens: rts,
    reasoning_min: rts.length ? Math.min(...rts) : null,
    reasoning_max: rts.length ? Math.max(...rts) : null,
    reasoning_median: rts.length ? median(rts) : null,
    ge_3000: chars.filter((c) => c >= 3000).length,
    ge_2400: chars.filter((c) => c >= 2400).length,
    lt_1800: chars.filter((c) => c < 1800).length,
    early_stop: rows.filter(
      (r) =>
        r.finish_reason &&
        r.finish_reason !== "stop" &&
        r.finish_reason !== "end_turn"
    ).length,
    providers_actual: rows.map((r) => r.provider_actual),
    pin_ok: rows.every((r) => r.provider_pin_ok === true),
  };
}

function classifyProviderArm(s: ReturnType<typeof summarizeArm>): {
  gate: "PROVIDER_STABILITY_CANDIDATE" | "PROVIDER_DIRECTIONAL_WINNER" | "FAIL";
  notes: string[];
} {
  const notes: string[] = [];
  if (!s.pin_ok) {
    return { gate: "FAIL", notes: ["provider fallback / mismatch"] };
  }
  const strong =
    s.min >= 2400 &&
    s.median >= 3000 &&
    (s.max_min_ratio ?? 99) <= 1.5 &&
    s.lt_1800 === 0;
  if (strong) {
    return { gate: "PROVIDER_STABILITY_CANDIDATE", notes: ["strong pass"] };
  }
  const directional =
    s.min >= 2000 &&
    s.median >= 2600 &&
    s.lt_1800 === 0;
  if (directional) {
    notes.push("weak/directional length stability");
    return { gate: "PROVIDER_DIRECTIONAL_WINNER", notes };
  }
  return { gate: "FAIL", notes: ["length/variance gate not met"] };
}

async function runCell(opts: {
  cellId: string;
  fixtureId: FixtureId;
  arm: string;
  draw: number;
  modelId: string;
  body: Record<string, unknown>;
  assembled: Awaited<ReturnType<typeof assembleProductionA>>;
  providerRequested: string;
  expectedDisplay: string;
  experimentGenerationConfig: Record<string, unknown>;
}): Promise<{
  apiCalls: number;
  row: Record<string, unknown>;
  providerRaw: string;
}> {
  const dir = join(OUT_ROOT, "live", opts.cellId);
  const rawPath = join(dir, "provider_raw.txt");
  let apiCalls = 0;
  let providerRaw: string;
  let meta: Record<string, unknown>;

  if (existsSync(rawPath) && existsSync(join(dir, "meta.json"))) {
    console.log(`skip existing ${opts.cellId}`);
    providerRaw = readFileSync(rawPath, "utf8");
    meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  } else {
    console.log(
      `\n=== ${opts.cellId} pin=${opts.providerRequested} draw=${opts.draw} ===`
    );
    let resp = await streamOpenRouter(opts.body);
    let reissued = 0;
    if (
      (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
      isTransportAbort(resp.error, resp.http_status)
    ) {
      reissued = 1;
      console.log("transport abort — reissue once (same payload)");
      resp = await streamOpenRouter(opts.body);
    }
    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      save(dir, "FAIL.json", resp);
      throw new Error(
        `OR fail ${opts.cellId}: ${resp.error ?? resp.http_status}`
      );
    }
    apiCalls = 1;
    const pinOk = providerMatchesArm(resp.provider, opts.expectedDisplay);
    if (!pinOk) {
      save(dir, "FALLBACK_REJECT.json", {
        provider_requested: opts.providerRequested,
        provider_actual: resp.provider,
        expected_display: opts.expectedDisplay,
        generation_id: resp.generation_id,
        response_headers: resp.response_headers,
      });
      throw new Error(
        `PROVIDER FALLBACK/MISMATCH ${opts.cellId}: requested=${opts.providerRequested} actual=${resp.provider}`
      );
    }
    providerRaw = resp.text;
    const { sanitizeStreamArtifacts } = await import(
      "../src/lib/responseLength"
    );
    const {
      normalizeAiNovelProsePreDisplay,
      applyDisplayParagraphGrouping,
    } = await import("../src/lib/novelParagraphs");
    const { visibleAssistantDisplayText } = await import(
      "../src/lib/chatDisplayLength"
    );
    const preNormalize = sanitizeStreamArtifacts(providerRaw);
    const preDisplay = normalizeAiNovelProsePreDisplay(preNormalize);
    const finalDisplay = visibleAssistantDisplayText(
      applyDisplayParagraphGrouping(preDisplay)
    );
    const tokens = usageTokens(resp.usage);
    meta = {
      cell_id: opts.cellId,
      phase: PHASE,
      fixture: opts.fixtureId,
      arm: opts.arm,
      draw: opts.draw,
      production_prompt: "BYTE_IDENTICAL",
      prompt_delta: 0,
      sole_variable: "provider",
      model_identifier: opts.modelId,
      resolved_model: resp.resolved_model,
      provider_requested: opts.providerRequested,
      provider_actual: resp.provider,
      provider_pin_ok: pinOk,
      provider_generation_id: resp.generation_id,
      response_headers: resp.response_headers,
      finish_reason: resp.finish_reason,
      saw_done: resp.saw_done,
      latency_s: resp.latency_s,
      transport_reissue: reissued,
      quality_retry: 0,
      continuation: 0,
      recovery: 0,
      system_sha256: opts.assembled.systemSha,
      messages_sha256: opts.assembled.messagesSha,
      user_tail_sha256: opts.assembled.userTailSha,
      production_generation_config: opts.assembled.productionGenerationConfig,
      experiment_generation_config: opts.experimentGenerationConfig,
      usage_raw: resp.usage,
      ...tokens,
      incomplete:
        !!resp.finish_reason &&
        resp.finish_reason !== "stop" &&
        resp.finish_reason !== "end_turn",
      visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
    };
    save(dir, "provider_raw.txt", providerRaw);
    save(dir, "final_display.txt", finalDisplay);
    save(dir, "meta.json", meta);
    save(dir, "request_fingerprint.json", {
      system_sha256: opts.assembled.systemSha,
      messages_sha256: opts.assembled.messagesSha,
      user_tail_sha256: opts.assembled.userTailSha,
      production_generation_config: opts.assembled.productionGenerationConfig,
      experiment_generation_config: opts.experimentGenerationConfig,
    });
  }

  const vector = computeRpQualityVectorV2({
    text: providerRaw,
    providerRaw,
    finishReason: (meta.finish_reason as string) ?? null,
    sawDone: (meta.saw_done as boolean) ?? null,
    incomplete: (meta.incomplete as boolean) ?? null,
    currentUserInput: FIXTURES[opts.fixtureId].userInput,
    priorAssistantText: opts.assembled.greeting,
    greetingOrIntroText: opts.assembled.greeting,
    settingSources: opts.assembled.settingSources,
  });
  const anchors = scoreResponseAnchorCount(providerRaw);
  const fnLoad = scoreDialogueFunctionLoad(providerRaw);
  const maxBlock = maxDialogueBlockChars(providerRaw);

  const rawMd = [
    `# ${opts.cellId}`,
    "",
    `- phase: ${PHASE}`,
    `- fixture: ${opts.fixtureId}`,
    `- arm: ${opts.arm}`,
    `- provider_requested: ${opts.providerRequested}`,
    `- provider_actual: ${meta.provider_actual ?? meta.provider}`,
    `- draw: ${opts.draw}`,
    `- finish_reason: ${meta.finish_reason ?? "null"}`,
    `- visible_chars_no_ws: ${meta.visible_chars_no_ws}`,
    "",
    "## visible_output",
    "",
    "```text",
    providerRaw,
    "```",
    "",
  ].join("\n");
  save(RAW_DOCS, `${opts.cellId}.md`, rawMd);

  return {
    apiCalls,
    providerRaw,
    row: {
      cell_id: opts.cellId,
      fixture: opts.fixtureId,
      arm: opts.arm,
      draw: opts.draw,
      provider_requested: opts.providerRequested,
      provider_actual: meta.provider_actual ?? meta.provider,
      provider_pin_ok: meta.provider_pin_ok ?? true,
      provider_generation_id: meta.provider_generation_id,
      visible_chars: vector.length.visible_chars_no_whitespace,
      length_band: vector.length.length_band,
      dialogue_chars: vector.composition.dialogue_chars,
      narration_chars: vector.composition.narration_chars,
      dialogue_char_share: vector.composition.dialogue_char_share,
      dialogue_share_band: dialogueShareBand(
        vector.composition.dialogue_char_share
      ),
      same_speaker_dialogue_fragments:
        vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
      max_dialogue_block_chars: maxBlock,
      max_consecutive_short_dialogue_run:
        vector.dialogue_fragmentation.max_consecutive_short_dialogue_run,
      response_anchor: anchors,
      dialogue_function_load: fnLoad,
      continuity: vector.continuity,
      setting_exact_overlap: vector.setting_exact_overlap,
      hard_alarms: vector.hard_alarms,
      review_flags: vector.review_flags,
      finish_reason: meta.finish_reason,
      incomplete: meta.incomplete,
      latency_s: meta.latency_s,
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens,
      reasoning_tokens: meta.reasoning_tokens,
      visible_budget_tokens: meta.visible_budget_tokens,
      system_sha256: meta.system_sha256,
      messages_sha256: meta.messages_sha256,
      user_tail_sha256: meta.user_tail_sha256,
      production_generation_config: meta.production_generation_config,
      experiment_generation_config: meta.experiment_generation_config,
    },
  };
}

async function runB1(modelId: string) {
  const spec = FIXTURES.G6T1;
  const fixture = loadFixture(spec.characterId);
  const assembled = await assembleProductionA({ modelId, fixture, spec });

  // Prove production body has null provider before experiment pin.
  if (assembled.productionGenerationConfig.provider != null) {
    throw new Error(
      "Production assemble unexpectedly retained provider — aborting (would violate harness contract)"
    );
  }

  let apiCalls = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const arm of PROVIDER_ARMS) {
    const pinned = withProviderPin(assembled.requestBody, arm.slug);
    const experimentGenerationConfig = {
      ...assembled.productionGenerationConfig,
      provider: pinned.provider,
    };
    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_${spec.id}_${arm.arm}_D${draw}`;
      const result = await runCell({
        cellId,
        fixtureId: spec.id,
        arm: arm.arm,
        draw,
        modelId,
        body: pinned,
        assembled,
        providerRequested: arm.slug,
        expectedDisplay: arm.expected_display,
        experimentGenerationConfig,
      });
      apiCalls += result.apiCalls;
      rows.push(result.row);
    }
  }

  const byArm: Record<string, unknown> = {};
  const gates: Record<string, unknown> = {};
  for (const arm of PROVIDER_ARMS) {
    const armRows = rows.filter((r) => r.arm === arm.arm);
    const summary = summarizeArm(armRows);
    const gate = classifyProviderArm(summary);
    byArm[arm.arm] = {
      slug: arm.slug,
      label: arm.label,
      expected_display: arm.expected_display,
      ...summary,
      gate: gate.gate,
      gate_notes: gate.notes,
    };
    gates[arm.arm] = gate;
  }

  const p1 = byArm.P1 as ReturnType<typeof summarizeArm> & {
    gate: string;
    max_min_ratio: number | null;
    median: number;
    min: number;
    lt_1800: number;
  };
  const p2 = byArm.P2 as typeof p1;

  let winner: "NONE" | "P1" | "P2" = "NONE";
  let stability: "PASS" | "DIRECTIONAL" | "FAIL" = "FAIL";

  const p1Strong = p1.gate === "PROVIDER_STABILITY_CANDIDATE";
  const p2Strong = p2.gate === "PROVIDER_STABILITY_CANDIDATE";
  const p1Dir = p1.gate === "PROVIDER_DIRECTIONAL_WINNER";
  const p2Dir = p2.gate === "PROVIDER_DIRECTIONAL_WINNER";

  if (p1Strong && !p2Strong) {
    winner = "P1";
    stability = "PASS";
  } else if (p2Strong && !p1Strong) {
    winner = "P2";
    stability = "PASS";
  } else if (p1Strong && p2Strong) {
    // Prefer materially lower variance / higher median.
    const r1 = p1.max_min_ratio ?? 99;
    const r2 = p2.max_min_ratio ?? 99;
    if (r1 < r2 - 0.05 || (Math.abs(r1 - r2) <= 0.05 && p1.median >= p2.median)) {
      winner = "P1";
    } else {
      winner = "P2";
    }
    stability = "PASS";
  } else if (p1Dir || p2Dir) {
    stability = "DIRECTIONAL";
    if (p1Dir && !p2Dir) winner = "P1";
    else if (p2Dir && !p1Dir) winner = "P2";
    else {
      const r1 = p1.max_min_ratio ?? 99;
      const r2 = p2.max_min_ratio ?? 99;
      winner = r1 <= r2 ? "P1" : "P2";
    }
  }

  const bothFailLength =
    (p1.median < 2400 || p1.lt_1800 > 0 || (p1.max_min_ratio ?? 0) > 1.8) &&
    (p2.median < 2400 || p2.lt_1800 > 0 || (p2.max_min_ratio ?? 0) > 1.8);

  const summary = {
    phase: "D5-B1",
    sole_variable: "provider",
    production_prompt: "BYTE_IDENTICAL",
    prompt_delta: 0,
    production_code_diff: 0,
    fixture: spec.id,
    messages_sha256: assembled.messagesSha,
    system_sha256: assembled.systemSha,
    user_tail_sha256: assembled.userTailSha,
    production_generation_config: assembled.productionGenerationConfig,
    api_calls_this_run: apiCalls,
    by_arm: byArm,
    gates,
    provider_winner: winner === "NONE" ? "NONE" : PROVIDER_ARMS.find((a) => a.arm === winner)?.slug ?? winner,
    provider_winner_arm: winner,
    PROVIDER_STABILITY: stability,
    PROVIDER_PINNING_NOT_SUFFICIENT: bothFailLength && stability === "FAIL",
    confirmation: "NOT_RUN",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
    rows,
  };

  save(join(DOCS, "b1"), "01_PROVIDER_ISOLATION.json", summary);
  save(
    join(DOCS, "b1"),
    "01_PROVIDER_ISOLATION.md",
    [
      "# D5-B1 — Provider Isolation (G6-T1)",
      "",
      "Sole variable: `provider.only` (harness-only, after production assemble).",
      "",
      "```json",
      JSON.stringify(
        {
          provider_winner: summary.provider_winner,
          PROVIDER_STABILITY: summary.PROVIDER_STABILITY,
          PROVIDER_PINNING_NOT_SUFFICIENT: summary.PROVIDER_PINNING_NOT_SUFFICIENT,
          by_arm: Object.fromEntries(
            Object.entries(byArm).map(([k, v]) => {
              const x = v as Record<string, unknown>;
              return [
                k,
                {
                  slug: x.slug,
                  chars: x.chars,
                  min: x.min,
                  max: x.max,
                  median: x.median,
                  max_min_ratio: x.max_min_ratio,
                  reasoning_median: x.reasoning_median,
                  lt_1800: x.lt_1800,
                  ge_2400: x.ge_2400,
                  ge_3000: x.ge_3000,
                  gate: x.gate,
                  providers_actual: x.providers_actual,
                },
              ];
            })
          ),
        },
        null,
        2
      ),
      "```",
      "",
    ].join("\n")
  );

  return summary;
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(join(DOCS, "b1"), { recursive: true });
  mkdirSync(RAW_DOCS, { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY required for D5-B live experiments");
  }

  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;

  if (PHASE === "B1") {
    const summary = await runB1(modelId);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  throw new Error(
    `Unsupported D5B_PHASE=${PHASE}. Implement B2/B3 only after B1 classification.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
