/**
 * Experiment A: Generic Mirror + Dynamic Source Style Fingerprint.
 * 6 new Muse calls. Baseline Generic RAWs are reference-only.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/muse12-style-fingerprint-experiment-a.ts
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

const DOCS = "docs/audits/muse12-style-fingerprint-experiment-a";
const BASELINE = "docs/audits/muse12-generic-single-fixture-regression";
const SOURCE_DIR = "docs/audits/muse12-source-style-generalization/recovered-sources";
const FIXTURES_PATH = join(BASELINE, "PRODUCTION_FIXTURES.json");
const MUSE_MODEL = "muse-spark-1.2";
const TOTAL_NEW_MUSE_CALLS = 6;

const FROZEN_OPUS_SOURCE_SHA =
  "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818";
const FROZEN_GEMINI_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";

const BASELINE_SHA: Record<string, string> = {
  "OPUS_GENERIC_1_RAW.txt":
    "e154e2d835c09ae90310ab5139b5e7bdd0943ee2e39970286c0022cd0b780ccd",
  "OPUS_GENERIC_2_RAW.txt":
    "3dbbe09438932814a3183e9aa5a7e40aa2178f88252bf1afc89ba425de11deab",
  "OPUS_GENERIC_3_RAW.txt":
    "ed44db35c17d395a5271b6dcc56b77147c11db8e1f5060467872cb992809f549",
  "GEMINI31_GENERIC_1_RAW.txt":
    "2b4089a7cb972060afb84cd687e13c25134cb941ef890b9bfd81cedff8f589b8",
  "GEMINI31_GENERIC_2_RAW.txt":
    "448e7a07462f535403579797a1ca580c3e244402235adf9b34f03f92d470e43d",
  "GEMINI31_GENERIC_3_RAW.txt":
    "1e5f975b3b80a0e5910ee6a599fd40ee2ceef553d654b9a35b5a834dce651353",
};

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type SourceId = "opus" | "gemini31";

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
  let n = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return n;
    n += 1;
    from = idx + needle.length;
  }
}

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
  const choice = Array.isArray(choices) ? choices[0] : null;
  const rec = choice && typeof choice === "object" ? choice : {};
  const delta = rec.delta as Record<string, unknown> | undefined;
  const message = rec.message as Record<string, unknown> | undefined;
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
  const reasoning =
    (typeof delta?.reasoning === "string" && delta.reasoning) ||
    (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
    "";
  if (reasoning) {
    state.reasoningEvents += 1;
    state.reasoningText += reasoning;
  }
  if (typeof rec.finish_reason === "string" && rec.finish_reason) {
    state.finish = rec.finish_reason;
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
    incomplete_stream:
      !state.sawDone || state.finish == null || state.finish === "length" || !state.text.trim(),
    error: null as string | null,
  };
}

async function assembleFingerprintBundle(opts: {
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
  const { CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL } = await import("../src/lib/chatModels");
  const {
    MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
    OPUS_QWEN_FRAGMENT_SENTENCE,
    GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  } = await import("../src/lib/adultHandoffSourceRouting");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const {
    MUSE_SOURCE_STYLE_FINGERPRINT_HEADER,
    LIKE_SPECIFIC_V1_PHRASES,
    MUSE_FINGERPRINT_FORBIDDEN_LABELS,
    buildMuseSourceStyleFingerprint,
  } = await import("../src/lib/museSourceStyleFingerprint");

  const ch = opts.character;
  const charName = String(ch.name);
  const personaName = String(opts.persona.name ?? "렌");
  if (charName !== "라이크" || Number(ch._internalId) !== 18) {
    throw new Error(`FIXTURE_CHARACTER_UNEXPECTED:${charName}`);
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
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");
  if (!lastUser || !systemMsg) throw new Error("ASSEMBLED_MESSAGES_MISSING_ROLES");
  const fp = buildMuseSourceStyleFingerprint(opts.sourceText);
  if (!fp.block) throw new Error(`FINGERPRINT_OMITTED_UNEXPECTED:${opts.sourceId}:${fp.confidence}`);
  if (countOccurrences(lastUser.content, fp.block) !== 1) {
    throw new Error("FINGERPRINT_NOT_EXACTLY_ONCE_ON_USER");
  }
  if (systemMsg.content.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER)) {
    throw new Error("FINGERPRINT_IN_SYSTEM");
  }
  if (
    lastUser.content.indexOf(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER) >
      lastUser.content.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) ||
    lastUser.content.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) >
      lastUser.content.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE) ||
    !lastUser.content.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE)
  ) {
    throw new Error("FINGERPRINT_PLACEMENT_INVALID");
  }
  if (countOccurrences(lastUser.content, MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) !== 1) {
    throw new Error("GENERIC_MIRROR_COUNT");
  }
  if (
    lastUser.content.includes(OPUS_QWEN_FRAGMENT_SENTENCE) ||
    lastUser.content.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK) ||
    systemMsg.content.includes(OPUS_QWEN_FRAGMENT_SENTENCE) ||
    systemMsg.content.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK)
  ) {
    throw new Error("QWEN_ADAPTER_LEAK");
  }
  for (const phrase of [...LIKE_SPECIFIC_V1_PHRASES, ...MUSE_FINGERPRINT_FORBIDDEN_LABELS]) {
    if (fp.block.includes(phrase)) throw new Error(`FORBIDDEN_IN_FINGERPRINT:${phrase}`);
  }
  if (adapted.model !== MUSE_MODEL || adapted.temperature !== 0.7) {
    throw new Error("WIRE_MODEL_OR_TEMP");
  }
  for (const field of ["reasoning", "include_reasoning", "reasoning_effort", "thinking"]) {
    if (Object.prototype.hasOwnProperty.call(adapted, field)) {
      throw new Error(`MUSE_FIELD_LEAKED:${field}`);
    }
  }
  return {
    requestBody: adapted,
    lastUserContent: lastUser.content,
    fingerprint: fp,
    wire: {
      model: adapted.model,
      temperature: adapted.temperature,
      keys: Object.keys(adapted).sort(),
      reasoning: "ABSENT",
      include_reasoning: "ABSENT",
      reasoning_effort: "ABSENT",
      thinking: "ABSENT",
    },
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

async function main() {
  mkdirSync(DOCS, { recursive: true });
  const opusSource = mustRead(join(SOURCE_DIR, "LIKE_ADULT_SOURCE_OPUS.txt"));
  const geminiSource = mustRead(join(SOURCE_DIR, "LIKE_ADULT_SOURCE_GEMINI31.txt"));
  if (sha256(opusSource) !== FROZEN_OPUS_SOURCE_SHA) throw new Error("OPUS_SOURCE_SHA");
  if (sha256(geminiSource) !== FROZEN_GEMINI_SOURCE_SHA) throw new Error("GEMINI_SOURCE_SHA");
  for (const [name, expected] of Object.entries(BASELINE_SHA)) {
    const hash = sha256(mustRead(join(BASELINE, name)));
    if (hash !== expected) throw new Error(`BASELINE_SHA:${name}`);
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
    CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  } = await import("../src/lib/chatModels");
  const { resolveAdultHandoffModelForSource } = await import(
    "../src/lib/adultHandoffSourceRouting"
  );
  const {
    buildMuseSourceStyleFingerprint,
    canonicalizeLastVisibleAssistantRaw,
    computeMuseSourceStyleMetrics,
    computeMuseStyleDistance,
    splitTextIntoCharThirds,
  } = await import("../src/lib/museSourceStyleFingerprint");

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
    rawPrefix: string;
    baselinePrefix: string;
  }> = [
    {
      id: "opus",
      sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      sourceText: opusSource,
      rawPrefix: "OPUS_FP",
      baselinePrefix: "OPUS_GENERIC",
    },
    {
      id: "gemini31",
      sourceModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      sourceText: geminiSource,
      rawPrefix: "GEMINI31_FP",
      baselinePrefix: "GEMINI31_GENERIC",
    },
  ];

  const assembled: Record<string, Awaited<ReturnType<typeof assembleFingerprintBundle>>> =
    {};
  for (const source of sources) {
    assembled[source.id] = await assembleFingerprintBundle({
      sourceId: source.id,
      sourceModelId: source.sourceModelId,
      sourceText: source.sourceText,
      character: fixtures.character,
      persona: fixtures.persona,
    });
    save(join(DOCS, "assemble", source.id), "fingerprint.txt", assembled[source.id]!.fingerprint.block ?? "");
    save(join(DOCS, "assemble", source.id), "request-wire.json", assembled[source.id]!.wire);
    save(join(DOCS, "assemble", source.id), "fingerprint-metrics.json", assembled[source.id]!.fingerprint);
  }

  const headers = buildCheaperInferenceHeaders();
  let apiCalls = 0;
  const newRows: Array<Record<string, unknown>> = [];
  const newRaws: Record<string, string> = {};

  for (const source of sources) {
    const bundle = assembled[source.id]!;
    for (let n = 1; n <= 3; n += 1) {
      if (apiCalls >= TOTAL_NEW_MUSE_CALLS) throw new Error("BUDGET");
      const rawName = `${source.rawPrefix}_${n}_RAW.txt`;
      if (existsSync(join(DOCS, rawName)) && mustRead(join(DOCS, rawName)).trim()) {
        throw new Error(`REFUSING_OVERWRITE:${rawName}`);
      }
      apiCalls += 1;
      console.log(`\n=== ${source.id} FP n=${n} (${apiCalls}/${TOTAL_NEW_MUSE_CALLS}) ===`);
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        bundle.requestBody
      );
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        save(join(DOCS, "failures"), `${source.id}_${n}.json`, resp);
        throw new Error(`CALL_FAIL ${source.id} n=${n}`);
      }
      save(DOCS, rawName, resp.text);
      newRaws[rawName] = resp.text;
      const usage = resp.usage ?? {};
      const row = {
        cell: `${source.id}_fp_${n}`,
        source_id: source.id,
        n,
        raw_file: rawName,
        raw_sha256: sha256(resp.text),
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        visible_chars: resp.text.length,
        input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
        completion_tokens:
          typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
        usage_cost: typeof usage.cost === "number" ? usage.cost : null,
        reasoning_stream_observed: resp.reasoning_events > 0,
        reasoning_chars: resp.reasoning_text.length,
        terminal_usage: resp.usage != null,
        incomplete_stream: resp.incomplete_stream,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
      };
      newRows.push(row);
      save(join(DOCS, "calls", `${source.id}_${n}`), "meta.json", row);
      console.log(row);
    }
  }

  const styleRows: Record<string, unknown> = {};
  const review: string[] = [
    "# Experiment A review — Generic vs Generic + Fingerprint",
    "",
    "Cursor did **not** score literary quality.",
    "ChatGPT reads the RAWs directly. Conditions are named.",
    "`GENERALIZATION_PROVEN=false`. Single Like/Ren fixture only.",
    "",
    "Axes for ChatGPT only: PURE_PROSE / SOURCE_STYLE / CHARACTER / SCENE / RHYTHM / PROGRESSION / LATE_VOICE.",
    "",
  ];

  for (const source of sources) {
    const sourceCanon = canonicalizeLastVisibleAssistantRaw(source.sourceText);
    const sourceMetrics = computeMuseSourceStyleMetrics(sourceCanon);
    const sourceFp = buildMuseSourceStyleFingerprint(source.sourceText);
    styleRows[`${source.id}_source`] = sourceMetrics;
    review.push(`## ${source.id}`, "");
    review.push("### Source metrics", "");
    review.push("```json");
    review.push(JSON.stringify({ confidence: sourceFp.confidence, metrics: sourceMetrics }, null, 2));
    review.push("```", "");
    review.push("### Baseline Generic (frozen, not recalled)", "");
    for (let n = 1; n <= 3; n += 1) {
      const name = `${source.baselinePrefix}_${n}_RAW.txt`;
      const raw = mustRead(join(BASELINE, name));
      const metrics = computeMuseSourceStyleMetrics(canonicalizeLastVisibleAssistantRaw(raw));
      const distance = computeMuseStyleDistance(sourceMetrics, metrics);
      styleRows[`${source.id}_baseline_${n}`] = { metrics, distance };
      review.push(`#### BASELINE ${source.id} n=${n} \`${name}\``, "");
      review.push("```json");
      review.push(JSON.stringify({ metrics, distance }, null, 2));
      review.push("```", "");
      review.push("```text");
      review.push(raw.replace(/```/g, "``\\`"));
      review.push("```", "");
    }
    review.push("### Fingerprint candidate (new)", "");
    for (let n = 1; n <= 3; n += 1) {
      const name = `${source.rawPrefix}_${n}_RAW.txt`;
      const raw = newRaws[name] ?? mustRead(join(DOCS, name));
      const canon = canonicalizeLastVisibleAssistantRaw(raw);
      const metrics = computeMuseSourceStyleMetrics(canon);
      const [first, middle, last] = splitTextIntoCharThirds(canon);
      const thirds = {
        FIRST_THIRD: computeMuseSourceStyleMetrics(first),
        MIDDLE_THIRD: computeMuseSourceStyleMetrics(middle),
        LAST_THIRD: computeMuseSourceStyleMetrics(last),
      };
      const distances = {
        overall: computeMuseStyleDistance(sourceMetrics, metrics),
        FIRST_THIRD_DISTANCE: computeMuseStyleDistance(sourceMetrics, thirds.FIRST_THIRD),
        MIDDLE_THIRD_DISTANCE: computeMuseStyleDistance(sourceMetrics, thirds.MIDDLE_THIRD),
        LAST_THIRD_DISTANCE: computeMuseStyleDistance(sourceMetrics, thirds.LAST_THIRD),
      };
      styleRows[`${source.id}_fingerprint_${n}`] = { metrics, thirds, distances };
      review.push(`#### FINGERPRINT ${source.id} n=${n} \`${name}\``, "");
      review.push("```json");
      review.push(JSON.stringify({ metrics, thirds, distances }, null, 2));
      review.push("```", "");
      review.push("```text");
      review.push(raw.replace(/```/g, "``\\`"));
      review.push("```", "");
    }
  }

  const opusRows = newRows.filter((r) => r.source_id === "opus");
  const geminiRows = newRows.filter((r) => r.source_id === "gemini31");
  const manifest = {
    status: "MUSE_DYNAMIC_STYLE_FINGERPRINT_CAPTURE_COMPLETE",
    FINGERPRINT_IMPLEMENTED: true,
    FINGERPRINT_MODEL_CALLS: 0,
    REFERENCE_OWNER: "LAST_VISIBLE_CANONICAL_ASSISTANT",
    SOURCE_FILTERS: [
      "noncanonical_ooc",
      "status_widget",
      "internal_json_markers",
      "hidden_reasoning",
      "tool_system_syntax",
    ],
    FINGERPRINT_METRICS: [
      "SOURCE_VISIBLE_CHARS",
      "SENTENCE_CHAR_MEDIAN",
      "SENTENCE_CHAR_P75",
      "PARAGRAPH_CHAR_MEDIAN",
      "PARAGRAPH_CHAR_P75",
      "PARAGRAPHS_PER_1000_CHARS",
      "ONE_SENTENCE_PARAGRAPH_SHARE",
      "DIALOGUE_CHAR_SHARE",
      "DIALOGUE_BLOCKS_PER_1000_CHARS",
    ],
    FINGERPRINT_MAX_CHARS: 500,
    CONFIDENCE_HIGH_RULE: "visible>=2000 AND usable_paragraphs>=8",
    CONFIDENCE_MEDIUM_RULE: "visible>=1000",
    CONFIDENCE_LOW_RULE: "otherwise omit",
    LIKE_SPECIFIC_PHRASES: 0,
    OPUS_NEW_CALLS: 3,
    GEMINI31_NEW_CALLS: 3,
    TOTAL_MUSE_CALLS: apiCalls,
    OTHER_MODEL_CALLS: 0,
    QUALITY_SCORING_BY_CURSOR: false,
    GENERALIZATION_PROVEN: false,
    PRODUCTION_ROUTING_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    opus_summary: {
      VISIBLE_CHARS: listMetrics(opusRows.map((r) => r.visible_chars as number)),
      TTFT: listMetrics(opusRows.map((r) => r.ttft_ms as number | null)),
      LATENCY: listMetrics(opusRows.map((r) => r.latency_ms as number)),
      COST: listMetrics(opusRows.map((r) => r.usage_cost as number | null)),
    },
    gemini_summary: {
      VISIBLE_CHARS: listMetrics(geminiRows.map((r) => r.visible_chars as number)),
      TTFT: listMetrics(geminiRows.map((r) => r.ttft_ms as number | null)),
      LATENCY: listMetrics(geminiRows.map((r) => r.latency_ms as number)),
      COST: listMetrics(geminiRows.map((r) => r.usage_cost as number | null)),
    },
    REASONING_STREAMS: newRows.filter((r) => r.reasoning_stream_observed === true).length,
    TERMINAL_USAGE: newRows.filter((r) => r.terminal_usage === true).length,
    INCOMPLETE: newRows.filter((r) => r.incomplete_stream === true).length,
    RAW_SHA_COMPLETE: newRows.every((r) => String(r.raw_sha256).length === 64),
    new_raw_sha: Object.fromEntries(newRows.map((r) => [r.raw_file, r.raw_sha256])),
    calls: newRows,
    style: styleRows,
    REVIEW_PACKET: `${DOCS}/REVIEW_PACKET.md`,
  };
  save(DOCS, "MANIFEST.json", manifest);
  save(DOCS, "STYLE_METRICS.json", styleRows);
  save(DOCS, "REVIEW_PACKET.md", `${review.join("\n")}\n`);
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        TOTAL_MUSE_CALLS: apiCalls,
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
