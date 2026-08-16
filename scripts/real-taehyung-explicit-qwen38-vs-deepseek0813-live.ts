/**
 * Production 라이크 (real name 조태형) source generation + explicit adult handoff.
 *
 * CALL 1: 라이크 → claude-opus-5 source RP
 * CALL 2: Opus source → deepseek-v4-pro-0813 adult
 * CALL 3: Opus source → qwen-3-8-max adult
 * CALL 4: 라이크 → gemini-3.1-pro-preview source RP
 * CALL 5: Gemini source → deepseek-v4-pro-0813 adult
 * CALL 6: Gemini source → qwen-3-8-max adult
 *
 * Exactly 6 generation calls. retry/continuation/recovery/fallback = 0.
 * Past chats are not required. Fake 조태형 / Caspen are forbidden.
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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");
const PRODUCTION_URL = "https://chat-ai-production-3e84.up.railway.app/";

const OPUS_SOURCE = "claude-opus-5";
const GEMINI_SOURCE = "gemini-3.1-pro-preview";
const DEEPSEEK_REQUESTED = "deepseek-v4-pro-0813";
const DEEPSEEK_ASSEMBLE = "deepseek-v4-pro";
const QWEN_REQUESTED = "qwen-3-8-max";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

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
      typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : null,
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
    !/Aegis|Sentinel|Guide/.test(text);
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
  characterLookup?: string;
  personaLookup?: string;
};

function tryExtractFixtures(): Fixtures | null {
  const extracted = spawnSync(process.execPath, [
    "scripts/real-taehyung-explicit-extract-railway.cjs",
  ], {
    encoding: "utf8",
    env: { ...process.env, TAEHYUNG_EXTRACT_OUT: DOCS },
  });
  if (extracted.stdout) process.stdout.write(extracted.stdout);
  if (extracted.stderr) process.stderr.write(extracted.stderr);
  if (!existsSync(FIXTURES_PATH)) return null;
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Fixtures;
}

async function probeAccess() {
  const localDb = "data/app.db";
  const localStat = existsSync(localDb) ? statSync(localDb) : null;
  let productionCharacter18 = "UNREACHABLE";
  try {
    const res = await fetch(`${PRODUCTION_URL}character/${PRODUCTION_LIKE_CHARACTER_ID}`, {
      redirect: "follow",
    });
    productionCharacter18 = res.redirected || res.url.includes("/login")
      ? "EXISTS_LOGIN_GATED"
      : `HTTP_${res.status}`;
  } catch (err) {
    productionCharacter18 = `FETCH_ERROR:${err instanceof Error ? err.message : "unknown"}`;
  }
  return {
    railway_cli: spawnSync("which", ["railway"], { encoding: "utf8" }).status === 0
      ? "PRESENT"
      : "NOT_INSTALLED",
    RAILWAY_TOKEN: process.env.RAILWAY_TOKEN ? "PRESENT" : "MISSING",
    OPUS5_SHADOW_DB: process.env.OPUS5_SHADOW_DB || null,
    TAEHYUNG_DB: process.env.TAEHYUNG_DB || null,
    production_db_path: "/data/app.db",
    production_db_exists: existsSync("/data/app.db"),
    local_app_db_bytes: localStat?.size ?? 0,
    production_url: PRODUCTION_URL,
    production_character_18: productionCharacter18,
    injected_secrets: (process.env.CLOUD_AGENT_INJECTED_SECRET_NAMES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function assembleBundle(opts: {
  assembleModelId: string;
  requestModelId: string;
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  history: ChatMsg[];
  currentUserMessage: string;
  adultHandoff: boolean;
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
  let systemExtra = "";
  let continuityPacket: unknown = null;
  let handoffVariants: unknown = null;
  if (opts.adultHandoff) {
    const adultCfg = resolveAdultRoutingConfig();
    const variants = selectAdultHandoffRawVariants(opts.history, {
      baseExchanges: adultCfg.baseRawExchanges,
      targetExchanges: adultCfg.handoffTargetRawExchanges,
      extraRawTokens: adultCfg.handoffExtraRawTokens,
    });
    handoffVariants = variants;
    history = variants.handoff.history;
    const lastAssistant =
      [...opts.history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
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

  const built = buildContext({
    charName,
    chunks,
    userNickname: personaName,
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: history,
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
    completedTurns: Math.max(0, Math.floor((history.length - 2) / 2)),
    provider: "cheaperinference",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 0,
    narrativePov,
    preserveAdultHandoffRawHistory: opts.adultHandoff,
  });
  const systemPrompt = opts.adultHandoff
    ? appendAdultHandoffPrompt(built.systemPrompt, continuityPacket as never)
    : built.systemPrompt;
  systemExtra = systemPrompt;
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
  return {
    requestBody: adapted,
    messages,
    systemPrompt: systemExtra,
    continuityPacket,
    handoffVariants,
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
  return {
    registered_name: ch.name,
    real_name_in_settings: String(
      `${ch.system_prompt ?? ""}\n${ch.description ?? ""}\n${ch.world ?? ""}`
    ).includes(PRODUCTION_LIKE_REAL_NAME),
    gender: ch.gender,
    nsfw: ch.nsfw,
    tagline: ch.tagline,
    description: String(ch.description ?? "").slice(0, 1200),
    greeting: String(ch.greeting ?? "").slice(0, 800),
    world: String(ch.world ?? "").slice(0, 800),
    example_dialog: String(ch.example_dialog ?? "").slice(0, 800),
    speech_profile: String(ch.speech_profile ?? "").slice(0, 800),
    recommended_writing_style: String(ch.recommended_writing_style ?? "").slice(0, 400),
    status_window_prompt: String(ch.status_window_prompt ?? "").slice(0, 400),
  };
}

function accessRequiredDoc(probe: Awaited<ReturnType<typeof probeAccess>>) {
  return `# ACCESS REQUIRED — production 라이크 snapshot

Past Opus/Gemini chats are no longer a blocker.
API generation was not run because the real production character/persona snapshot is missing.

## Character to load

\`\`\`text
PRODUCTION_CHARACTER_DISPLAY_NAME = 라이크
CHARACTER_REAL_NAME = 조태형
preferred id = 18
lookup = name = '라이크' then verify settings contain 조태형
do not search name = '조태형'
\`\`\`

## Credentials that would unblock this VM

One of the following is enough. Do not create a new public endpoint. SELECT-only.

1. \`RAILWAY_TOKEN\` for the production Railway project that hosts \`${PRODUCTION_URL}\`, plus permission to \`railway ssh\` and read \`/data/app.db\`.
2. A readable production SQLite path via \`OPUS5_SHADOW_DB\` or \`TAEHYUNG_DB\` (already SELECT-only in \`scripts/real-taehyung-explicit-extract-railway.cjs\`).
3. A production login session that can open \`/character/18\` **and** an existing authenticated/internal read path. This VM has no session cookie and \`/character/18\` is login-gated.

Then run:

\`\`\`text
railway ssh
node scripts/real-taehyung-explicit-extract-railway.cjs
\`\`\`

Required SELECT tables:

- \`characters\` — id 18 or verified \`name='라이크'\` whose settings contain \`조태형\`
- \`user_personas\` — production \`렌\` only if a unique verified row exists

Not required:

- past Opus chats
- past Gemini chats

## This VM probe

\`\`\`json
${JSON.stringify(probe, null, 2)}
\`\`\`

## Forbidden substitutes

\`\`\`text
SYNTHETIC_TAEHYUNG = FORBIDDEN
CASPEN = FORBIDDEN
invented 렌 persona = FORBIDDEN
\`\`\`
`;
}

function writeIncomplete(opts: {
  probe: Awaited<ReturnType<typeof probeAccess>>;
  fixtures: Fixtures | null;
  reason: string;
}) {
  const summary = {
    CAPTURE_COMPLETE: false,
    reason: opts.reason,
    CHARACTER: "production 라이크",
    CHARACTER_REAL_NAME: PRODUCTION_LIKE_REAL_NAME,
    REAL_OPUS_LIKE_TAEHYUNG: "NOT_GENERATED",
    REAL_GEMINI_LIKE_TAEHYUNG: "NOT_GENERATED",
    OPUS_FIXTURE_SOURCE: "NOT_REQUIRED",
    GEMINI_FIXTURE_SOURCE: "NOT_REQUIRED",
    CHARACTER_SNAPSHOT: opts.fixtures &&
      isProductionLikeTaehyungRecord({
        id: opts.fixtures.character._internalId,
        name: String(opts.fixtures.character.name ?? ""),
        description: String(opts.fixtures.character.description ?? ""),
        system_prompt: String(opts.fixtures.character.system_prompt ?? ""),
        world: String(opts.fixtures.character.world ?? ""),
        greeting: String(opts.fixtures.character.greeting ?? ""),
        example_dialog: String(opts.fixtures.character.example_dialog ?? ""),
        setting_chunks: String(opts.fixtures.character.setting_chunks ?? ""),
        speech_profile: String(opts.fixtures.character.speech_profile ?? ""),
      })
      ? "PRESENT"
      : "MISSING",
    PERSONA_SNAPSHOT: opts.fixtures?.persona ? "PRODUCTION_렌" : "MISSING",
    API_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    CASPEN_FIXTURE: "INVALID",
    SYNTHETIC_NON_PRODUCTION_CHARACTER: "DO_NOT_USE",
    railway_status: opts.probe.railway_cli,
    production_url: PRODUCTION_URL,
    production_character_18: opts.probe.production_character_18,
    railway_extract:
      "railway ssh && node scripts/real-taehyung-explicit-extract-railway.cjs",
    OPUS_WINNER: "HUMAN_REVIEW_REQUIRED",
    GEMINI_WINNER: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
  };
  const accessDoc = accessRequiredDoc(opts.probe);
  save(DOCS, "CAPTURE_SUMMARY.md", `# CAPTURE SUMMARY\n\n\`\`\`text\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  save(DOCS, "RUNTIME_CAPTURE.json", { summary, probe: opts.probe });
  save(DOCS, "ACCESS_REQUIRED.md", accessDoc);
  save(OUT_ROOT, "CAPTURE_SUMMARY.md", `# CAPTURE SUMMARY\n\n\`\`\`text\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  save(OUT_ROOT, "ACCESS_REQUIRED.md", accessDoc);
  save(OUT_ROOT, "RUNTIME_CAPTURE.json", { summary, probe: opts.probe });
  const packet = `# DIRECT_REVIEW_PACKET — REAL PRODUCTION LIKE/TAEHYUNG SOURCE + ADULT HANDOFF

\`\`\`text
CASPEN_FIXTURE = INVALID
SYNTHETIC_NON_PRODUCTION_CHARACTER = DO_NOT_USE
CHARACTER = production 라이크
CHARACTER_REAL_NAME = 조태형
REAL_OPUS_LIKE_TAEHYUNG = NOT_GENERATED
REAL_GEMINI_LIKE_TAEHYUNG = NOT_GENERATED
API_CALLS = 0
retry = 0
continuation = 0
recovery = 0
fallback = 0
\`\`\`

> API generation was not run. Real production 라이크/렌 snapshots are required. See ACCESS_REQUIRED.md.

${opts.fixtures?.character ? `### Partial character row\n\`\`\`json\n${JSON.stringify(characterSnapshot(opts.fixtures.character), null, 2)}\n\`\`\`\n` : ""}
`;
  save(DOCS, "DIRECT_REVIEW_PACKET.md", packet);
  save(OUT_ROOT, "DIRECT_REVIEW_PACKET.md", packet);
  return summary;
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });
  const probe = await probeAccess();
  const fixtures = tryExtractFixtures();
  const characterOk =
    !!fixtures?.character &&
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
  const personaOk = Boolean(fixtures?.persona && String(fixtures.persona.name ?? "").includes("렌"));

  if (!characterOk || !personaOk) {
    const summary = writeIncomplete({
      probe,
      fixtures,
      reason: !characterOk
        ? "PRODUCTION_LIKE_CHARACTER_SNAPSHOT_MISSING"
        : "PRODUCTION_REN_PERSONA_SNAPSHOT_MISSING",
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

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];

  const sources = [
    { id: "opus" as const, label: "REAL_OPUS_LIKE_TAEHYUNG", model: OPUS_SOURCE },
    { id: "gemini" as const, label: "REAL_GEMINI_LIKE_TAEHYUNG", model: GEMINI_SOURCE },
  ];
  const candidates = [
    { key: "deepseek" as const, requestModelId: DEEPSEEK_REQUESTED, assembleModelId: DEEPSEEK_ASSEMBLE },
    { key: "qwen" as const, requestModelId: QWEN_REQUESTED, assembleModelId: QWEN_REQUESTED },
  ];

  let apiCalls = 0;
  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};

  for (const source of sources) {
    const sourceBundle = await assembleBundle({
      assembleModelId: source.model,
      requestModelId: source.model,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: baseHistory,
      currentUserMessage: SOURCE_SEED_USER,
      adultHandoff: false,
    });
    console.log(`\n=== CALL ${apiCalls + 1} ${source.label} source ===`);
    apiCalls += 1;
    const sourceResp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      sourceBundle.requestBody
    );
    const sourceDir = join(OUT_ROOT, "live", source.id, "source");
    const sourceMeta = {
      call: source.id === "opus" ? 1 : 4,
      requested_model: source.model,
      resolved_model: sourceResp.resolved_model,
      HTTP_status: sourceResp.http_status,
      finish_reason: sourceResp.finish_reason,
      visible_chars: visibleAssistantDisplayCharCount(sourceResp.text),
      latency: sourceResp.latency_s,
      ...extractUsage(sourceResp.usage),
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: sourceResp.error,
    };
    save(sourceDir, "provider-raw.txt", sourceResp.text);
    save(sourceDir, "meta.json", sourceMeta);
    cells[`${source.id}_source`] = { raw: sourceResp.text, meta: sourceMeta };

    const adultHistory: ChatMsg[] = [
      ...baseHistory,
      { role: "user", content: SOURCE_SEED_USER },
      { role: "assistant", content: sourceResp.text },
    ];

    for (const candidate of candidates) {
      const bundle = await assembleBundle({
        assembleModelId: candidate.assembleModelId,
        requestModelId: candidate.requestModelId,
        character: fixtures.character,
        persona: fixtures.persona!,
        history: adultHistory,
        currentUserMessage: ADULT_HANDOFF_USER,
        adultHandoff: true,
      });
      console.log(`\n=== CALL ${apiCalls + 1} ${source.id} → ${candidate.requestModelId} ===`);
      apiCalls += 1;
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        bundle.requestBody
      );
      const dir = join(OUT_ROOT, "live", source.id, candidate.key);
      const prose = proseDiagnostics(resp.text);
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
        ...prose,
        agency: agencyDiagnostic(resp.text),
        generation: bundle.generation,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        error: resp.error,
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", meta);
      cells[`${source.id}_${candidate.key}`] = { raw: resp.text, meta };
    }
  }

  const summary = {
    CAPTURE_COMPLETE: apiCalls === 6,
    CHARACTER: "production 라이크",
    CHARACTER_REAL_NAME: PRODUCTION_LIKE_REAL_NAME,
    REAL_OPUS_LIKE_TAEHYUNG: cells.opus_source ? "GENERATED" : "MISSING",
    REAL_GEMINI_LIKE_TAEHYUNG: cells.gemini_source ? "GENERATED" : "MISSING",
    API_CALLS: apiCalls,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    OPUS_WINNER: "HUMAN_REVIEW_REQUIRED",
    GEMINI_WINNER: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
  };
  const packet = `# DIRECT_REVIEW_PACKET — REAL PRODUCTION LIKE/TAEHYUNG SOURCE + ADULT HANDOFF

\`\`\`text
CHARACTER = production 라이크
CHARACTER_REAL_NAME = 조태형
REAL_OPUS_LIKE_TAEHYUNG
REAL_GEMINI_LIKE_TAEHYUNG
API_CALLS = ${apiCalls}
retry = 0
continuation = 0
recovery = 0
fallback = 0
\`\`\`

## Production character snapshot
\`\`\`json
${JSON.stringify(characterSnapshot(fixtures.character), null, 2)}
\`\`\`

## REAL_OPUS_LIKE_TAEHYUNG

${cells.opus_source?.raw || "_NO_SOURCE_"}

### DeepSeek V4 Pro 0813
${cells.opus_deepseek?.raw || "_NO_OUTPUT_"}

### Qwen 3.8 Max
${cells.opus_qwen?.raw || "_NO_OUTPUT_"}

## REAL_GEMINI_LIKE_TAEHYUNG

${cells.gemini_source?.raw || "_NO_SOURCE_"}

### DeepSeek V4 Pro 0813
${cells.gemini_deepseek?.raw || "_NO_OUTPUT_"}

### Qwen 3.8 Max
${cells.gemini_qwen?.raw || "_NO_OUTPUT_"}
`;
  save(DOCS, "CAPTURE_SUMMARY.md", `# CAPTURE SUMMARY\n\n\`\`\`text\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  save(DOCS, "RUNTIME_CAPTURE.json", { summary, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.meta])) });
  save(DOCS, "DIRECT_REVIEW_PACKET.md", packet);
  save(OUT_ROOT, "DIRECT_REVIEW_PACKET.md", packet);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
