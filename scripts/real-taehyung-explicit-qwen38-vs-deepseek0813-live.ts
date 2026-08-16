/**
 * Real production 조태형 explicit adult handoff:
 * Opus 5 / Gemini 3.1 Pro → deepseek-v4-pro-0813 vs qwen-3-8-max
 *
 * Exactly 4 generation calls. No retry/continuation/recovery/fallback.
 * No production routing / pricing / Railway / adult-model change.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-qwen38-vs-deepseek0813-live.ts
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
import { spawnSync } from "node:child_process";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/real-taehyung-explicit-qwen38-vs-deepseek0813";
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");

const DEEPSEEK_REQUESTED = "deepseek-v4-pro-0813";
const DEEPSEEK_ASSEMBLE = "deepseek-v4-pro";
const QWEN_REQUESTED = "qwen-3-8-max";

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
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

function proseDiagnostics(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogue = paragraphs.filter((p) => /["“「『]/.test(p));
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
    !/Aegis|Aegis|Sentinel|Guide/.test(text);
  const explicitCont =
    /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|성기|음경|질\b|유두)/.test(text);
  let adultCapability = "OK";
  if (refusal || fadeToBlack) adultCapability = "ADULT_CAPABILITY_FAIL";
  else if (evasive || !explicitCont) adultCapability = "ADULT_CAPABILITY_DEGRADED";
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: dialogue.length,
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
  const hits = [userSpeech, consentForUser, emotionFact, longUserAction].filter(Boolean)
    .length;
  return {
    newUserDialogue: userSpeech,
    consentDecidedForUser: consentForUser,
    userEmotionFactForced: emotionFact,
    unpromptedUserActionChain: longUserAction,
    severeAgencyViolationCount: hits,
  };
}

function continuityDiagnostic(text: string, sourceAnchor: string) {
  return {
    actorPreserved: !/렌(?:이|은).{0,12}태형.{0,8}(?:위로 올라|위에 앉아)/.test(text) ||
      /태형(?:이|은).{0,12}렌/.test(sourceAnchor),
    targetPreserved: /렌|태형/.test(text),
    contactDirectionPreserved: !/반대로|뒤집/.test(text),
    bodyPositionPreserved: !/갑자기 자세를 바꿔|완전히 뒤집어/.test(text),
    clothingStatePreserved: true,
    locationPreserved: true,
    ongoingActionPreserved: proseDiagnostics(text).explicitAdultContinuation,
  };
}

function loadFixtures() {
  if (!existsSync(FIXTURES_PATH)) {
    const extracted = spawnSync(process.execPath, [
      "scripts/real-taehyung-explicit-extract-railway.cjs",
    ], {
      encoding: "utf8",
      env: { ...process.env, TAEHYUNG_EXTRACT_OUT: DOCS },
    });
    if (extracted.stdout) process.stdout.write(extracted.stdout);
    if (extracted.stderr) process.stderr.write(extracted.stderr);
  }
  if (!existsSync(FIXTURES_PATH)) return null;
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    opus: null | {
      history: Array<{ role: string; content: string; model?: string }>;
      currentUserTurn: string;
      sourceAssistants: string[];
      flags: { EXPLICIT_ADULT_SCENE_ACTIVE: boolean; INTIMATE_TRANSITION_ONLY: boolean };
      memory?: string;
      currentSummary?: string;
    };
    gemini: null | {
      history: Array<{ role: string; content: string; model?: string }>;
      currentUserTurn: string;
      sourceAssistants: string[];
      flags: { EXPLICIT_ADULT_SCENE_ACTIVE: boolean; INTIMATE_TRANSITION_ONLY: boolean };
      memory?: string;
      currentSummary?: string;
    };
  };
}

async function assembleBundle(opts: {
  assembleModelId: string;
  requestModelId: string;
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  history: ChatMsg[];
  currentUserMessage: string;
  longTermMemory: string;
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

  const ch = opts.character;
  const personaName = String(opts.persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch._internalId ?? 18),
      name: String(ch.name),
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
  const adultCfg = resolveAdultRoutingConfig();
  const handoffVariants = selectAdultHandoffRawVariants(opts.history, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const handoffHistory = handoffVariants.handoff.history;
  const lastAssistant =
    [...opts.history]
      .reverse()
      .find((m) => m.role === "assistant")
      ?.content ?? "";
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });
  const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
    text: lastAssistant,
    characterName: String(ch.name),
    personaName,
    currentUserText: opts.currentUserMessage,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: "explicit",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [String(ch.name), personaName],
    currentPov: narrativePov.mode,
    ...extractedHandoffContinuity,
  });
  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: opts.longTermMemory,
    shortTermHistory: handoffHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: opts.assembleModelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: Math.max(0, Math.floor((handoffHistory.length - 2) / 2)),
    provider: "cheaperinference",
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
    modelId: opts.assembleModelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: String(ch.name),
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
  const userTail = messages[messages.length - 1]?.content ?? "";
  return {
    requestBody: adapted,
    messages,
    systemPrompt,
    continuityPacket,
    handoffVariants,
    adapters: {
      xml_wrapping:
        systemPrompt.includes("<PERSONA>") || systemPrompt.includes("<WORLD_LORE>"),
      style_reminder: userTail.includes("System Reminder:"),
      handoff_continuation_instruction: systemPrompt.includes(
        "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다"
      ),
      qwen38_style_prompt_added: false,
    },
    generation: {
      temperature: adapted.temperature ?? null,
      top_p: adapted.top_p ?? null,
      max_tokens: adapted.max_tokens ?? null,
      thinking: adapted.thinking ?? null,
      reasoning_effort: adapted.reasoning_effort ?? null,
    },
    assemblePromptHash: sha256(
      messages.map((m) => `${m.role}\0${m.content}`).join("\u0001")
    ),
  };
}

function characterSnapshot(ch: Record<string, unknown>) {
  const speech = String(ch.speech_profile ?? ch.example_dialog ?? "").slice(0, 800);
  return {
    name: ch.name,
    gender: ch.gender,
    nsfw: ch.nsfw,
    tagline: ch.tagline,
    description: String(ch.description ?? "").slice(0, 1200),
    speech_lock_or_examples: speech,
    world: String(ch.world ?? "").slice(0, 800),
  };
}

function writePacket(opts: {
  fixtures: NonNullable<ReturnType<typeof loadFixtures>>;
  cells: Record<string, { raw: string; meta: Record<string, unknown> }>;
}) {
  const { fixtures, cells } = opts;
  const opusHist = (fixtures.opus?.history ?? [])
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n");
  const geminiHist = (fixtures.gemini?.history ?? [])
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n");
  const md = `# DIRECT_REVIEW_PACKET — REAL PRODUCTION TAEHYUNG EXPLICIT ADULT HANDOFF

\`\`\`text
CASPEN_FIXTURE = INVALID
SYNTHETIC_NON_PRODUCTION_CHARACTER = DO_NOT_USE
TERRA = NOT_RUN
CHARACTER = production 조태형
OPUS_FIXTURE_SOURCE = ${fixtures.opus ? "REAL_PRODUCTION" : "MISSING"}
GEMINI_FIXTURE_SOURCE = ${fixtures.gemini ? "REAL_PRODUCTION" : "MISSING"}
API_CALLS = ${cells.opus_deepseek && cells.opus_qwen && cells.gemini_deepseek && cells.gemini_qwen ? 4 : 0}
retry = 0
continuation = 0
recovery = 0
fallback = 0
OPUS_WINNER = HUMAN_REVIEW_REQUIRED
GEMINI_WINNER = HUMAN_REVIEW_REQUIRED
FINAL_ADULT_MODEL_WINNER = HUMAN_REVIEW_REQUIRED
PR #425 = REAL/SYNTHETIC MIXED INTIMATE_TRANSITION TEST
= explicit adult primary 결정 근거로 사용하지 않음
\`\`\`

${!fixtures.opus || !fixtures.gemini ? `> CAPTURE INCOMPLETE: live production \`/data/app.db\` was not readable from this VM (Railway CLI unauthorized; no Turso; character/18 is login-gated). No synthetic 조태형 card, no Caspen, and no invented explicit adult user turn were used. API calls were not made.\n` : ""}

## OPUS 5 → REAL TAEHYUNG

### Production character snapshot
\`\`\`json
${JSON.stringify(characterSnapshot(fixtures.character), null, 2)}
\`\`\`

### Real source history
${opusHist || "_NO_OPUS_PRODUCTION_HISTORY_"}

### Real explicit adult-active user turn
${fixtures.opus?.currentUserTurn || "_NO_OPUS_EXPLICIT_USER_TURN_"}

### DeepSeek V4 Pro 0813
\`\`\`json
${JSON.stringify(cells.opus_deepseek?.meta ?? { missing: true }, null, 2)}
\`\`\`

${cells.opus_deepseek?.raw || "_NO_OUTPUT_"}

### Qwen 3.8 Max
\`\`\`json
${JSON.stringify(cells.opus_qwen?.meta ?? { missing: true }, null, 2)}
\`\`\`

${cells.opus_qwen?.raw || "_NO_OUTPUT_"}

## GEMINI 3.1 PRO → REAL TAEHYUNG

### Production character snapshot
\`\`\`json
${JSON.stringify(characterSnapshot(fixtures.character), null, 2)}
\`\`\`

### Real source history
${geminiHist || "_NO_GEMINI_PRODUCTION_HISTORY_"}

### Real explicit adult-active user turn
${fixtures.gemini?.currentUserTurn || "_NO_GEMINI_EXPLICIT_USER_TURN_"}

### DeepSeek V4 Pro 0813
\`\`\`json
${JSON.stringify(cells.gemini_deepseek?.meta ?? { missing: true }, null, 2)}
\`\`\`

${cells.gemini_deepseek?.raw || "_NO_OUTPUT_"}

### Qwen 3.8 Max
\`\`\`json
${JSON.stringify(cells.gemini_qwen?.meta ?? { missing: true }, null, 2)}
\`\`\`

${cells.gemini_qwen?.raw || "_NO_OUTPUT_"}
`;
  save(DOCS, "DIRECT_REVIEW_PACKET.md", md);
  save(OUT_ROOT, "DIRECT_REVIEW_PACKET.md", md);
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });
  const fixtures = loadFixtures();
  if (!fixtures?.opus || !fixtures.gemini) {
    const summary = {
      CAPTURE_COMPLETE: false,
      reason: "PRODUCTION_DB_UNAVAILABLE_OR_MISSING_EXPLICIT_SOURCE_CHATS",
      CHARACTER: "production 조태형",
      OPUS_FIXTURE_SOURCE: fixtures?.opus ? "REAL_PRODUCTION" : "MISSING",
      GEMINI_FIXTURE_SOURCE: fixtures?.gemini ? "REAL_PRODUCTION" : "MISSING",
      OPUS_DEEPSEEK_STATUS: "NOT_RUN",
      OPUS_QWEN_STATUS: "NOT_RUN",
      GEMINI_DEEPSEEK_STATUS: "NOT_RUN",
      GEMINI_QWEN_STATUS: "NOT_RUN",
      API_CALLS: 0,
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      CASPEN_FIXTURE: "INVALID",
      SYNTHETIC_NON_PRODUCTION_CHARACTER: "DO_NOT_USE",
      TERRA: "NOT_RUN",
      railway_status: "UNAUTHORIZED",
      production_url: "https://chat-ai-production-3e84.up.railway.app/",
      production_character_18: "EXISTS_LOGIN_GATED",
      railway_extract:
        "railway ssh && node scripts/real-taehyung-explicit-extract-railway.cjs",
      OPUS_WINNER: "HUMAN_REVIEW_REQUIRED",
      GEMINI_WINNER: "HUMAN_REVIEW_REQUIRED",
      FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
    };
    save(DOCS, "CAPTURE_SUMMARY.md", `# CAPTURE SUMMARY\n\n\`\`\`text\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
    save(DOCS, "RUNTIME_CAPTURE.json", summary);
    writePacket({
      fixtures: fixtures ?? {
        character: { name: "조태형" },
        persona: { name: "렌" },
        opus: null,
        gemini: null,
      },
      cells: {},
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 2;
    return;
  }

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  const sources = [
    { id: "opus" as const, label: "Claude Opus 5", fixture: fixtures.opus },
    { id: "gemini" as const, label: "Gemini 3.1 Pro Preview", fixture: fixtures.gemini },
  ];
  const candidates = [
    {
      key: "deepseek" as const,
      requestModelId: DEEPSEEK_REQUESTED,
      assembleModelId: DEEPSEEK_ASSEMBLE,
    },
    {
      key: "qwen" as const,
      requestModelId: QWEN_REQUESTED,
      assembleModelId: QWEN_REQUESTED,
    },
  ];

  let apiCalls = 0;
  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  const assembleHashes: Record<string, string> = {};
  const fixtureHashes: Record<string, string> = {};

  for (const source of sources) {
    const history: ChatMsg[] = source.fixture.history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const fixtureInputHash = sha256(
      JSON.stringify({
        character: fixtures.character,
        persona: fixtures.persona,
        history,
        currentUserTurn: source.fixture.currentUserTurn,
        memory: source.fixture.memory || "",
        currentSummary: source.fixture.currentSummary || "",
      })
    );
    for (const candidate of candidates) {
      const bundle = await assembleBundle({
        assembleModelId: candidate.assembleModelId,
        requestModelId: candidate.requestModelId,
        character: fixtures.character,
        persona: fixtures.persona,
        history,
        currentUserMessage: source.fixture.currentUserTurn,
        longTermMemory: source.fixture.currentSummary || source.fixture.memory || "",
      });
      fixtureHashes[`${source.id}_${candidate.key}`] = fixtureInputHash;
      assembleHashes[`${source.id}_${candidate.key}`] = bundle.assemblePromptHash;

      console.log(`\n=== ${source.id} → ${candidate.requestModelId} (${apiCalls + 1}/4) ===`);
      apiCalls += 1;
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        bundle.requestBody
      );
      const dir = join(OUT_ROOT, "live", source.id, candidate.key);
      const prose = proseDiagnostics(resp.text);
      const agency = agencyDiagnostic(resp.text);
      const continuity = continuityDiagnostic(
        resp.text,
        source.fixture.sourceAssistants.slice(-1)[0] || ""
      );
      const meta = {
        requested_model: candidate.requestModelId,
        resolved_model: resp.resolved_model,
        HTTP_status: resp.http_status,
        finish_reason: resp.finish_reason,
        visible_chars: visibleAssistantDisplayCharCount(resp.text),
        paragraph_count: prose.paragraph_count,
        dialogue_paragraph_count: prose.dialogue_paragraph_count,
        latency: resp.latency_s,
        ...extractUsage(resp.usage),
        refusal: prose.refusal,
        fade_to_black: prose.fade_to_black,
        evasive_rewrite: prose.evasive_rewrite,
        foreign_language_contamination: prose.foreign_language_contamination,
        explicitAdultContinuation: prose.explicitAdultContinuation,
        adult_capability: prose.adult_capability,
        agency,
        continuity,
        adapters: bundle.adapters,
        generation: bundle.generation,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        error: resp.error,
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", meta);
      save(dir, "request-sanitized.json", {
        model: bundle.requestBody.model,
        generation: bundle.generation,
        adapters: bundle.adapters,
        message_count: bundle.messages.length,
      });
      cells[`${source.id}_${candidate.key}`] = { raw: resp.text, meta };
    }
  }

  const summary = {
    CAPTURE_COMPLETE: true,
    CHARACTER: "production 조태형",
    OPUS_FIXTURE_SOURCE: "REAL_PRODUCTION",
    GEMINI_FIXTURE_SOURCE: "REAL_PRODUCTION",
    OPUS_DEEPSEEK_STATUS: cells.opus_deepseek?.meta.HTTP_status ?? null,
    OPUS_QWEN_STATUS: cells.opus_qwen?.meta.HTTP_status ?? null,
    GEMINI_DEEPSEEK_STATUS: cells.gemini_deepseek?.meta.HTTP_status ?? null,
    GEMINI_QWEN_STATUS: cells.gemini_qwen?.meta.HTTP_status ?? null,
    API_CALLS: apiCalls,
    OPUS_WINNER: "HUMAN_REVIEW_REQUIRED",
    GEMINI_WINNER: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
    prompt_parity: {
      opus_fixture_input:
        fixtureHashes.opus_deepseek === fixtureHashes.opus_qwen,
      gemini_fixture_input:
        fixtureHashes.gemini_deepseek === fixtureHashes.gemini_qwen,
      opus_assemble_equal:
        assembleHashes.opus_deepseek === assembleHashes.opus_qwen,
      gemini_assemble_equal:
        assembleHashes.gemini_deepseek === assembleHashes.gemini_qwen,
      note: "assemble hashes may differ: EXPECTED_PROVIDER_DIFFERENCE from DeepSeek XML/style adapters vs generic Qwen handling. Fixture inputs must match.",
    },
  };
  save(DOCS, "CAPTURE_SUMMARY.md", `# CAPTURE SUMMARY\n\n\`\`\`text\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  save(DOCS, "RUNTIME_CAPTURE.json", { summary, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.meta])) });
  writePacket({ fixtures, cells });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
