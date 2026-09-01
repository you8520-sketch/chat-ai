/**
 * PR #427 — Gemini 3.1 → Qwen 3.8 Max current-main production-parity audit.
 *
 * Reconstructs the exact current-main adult handoff assembly
 * (GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK on system) and, unless
 * SNAPSHOT_ONLY=1, makes exactly 3 Qwen calls. No Muse / source / Opus /
 * DeepSeek / GLM calls. Does not overwrite existing RAWs.
 *
 * Must be executed from an origin/main worktree so src/lib bytes are
 * current production. Frozen fixtures and Gemini source stay on the
 * audit branch / artifact paths.
 *
 *   SNAPSHOT_ONLY=1 node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-qwen-gemini-production-parity.ts
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
  isProductionLikeTaehyungRecord,
} from "../src/lib/likeTaehyungIdentity";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const AUDIT_DOCS =
  process.env.AUDIT_DOCS ??
  "/workspace/docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/real-taehyung-explicit-qwen38-vs-deepseek0813";
const LIVE_ROOT = join(OUT_ROOT, "live");
const FIXTURES_PATH = join(AUDIT_DOCS, "PRODUCTION_FIXTURES.json");
const GEMINI_SOURCE_PATH = join(LIVE_ROOT, "gemini/source/provider-raw.txt");
const QWEN_REQUESTED = "qwen-3-8-max";
const GEMINI_SOURCE_MODEL = "gemini-3.1-pro-preview";
const SNAPSHOT_ONLY = process.env.SNAPSHOT_ONLY === "1";
const MAX_NEW_CALLS = SNAPSHOT_ONLY ? 0 : 3;

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

function findForeignScripts(text: string) {
  const hits: Array<{ ch: string; index: number; class: string }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.codePointAt(0) ?? 0;
    let cls: string | null = null;
    if (code >= 0x4e00 && code <= 0x9fff) cls = "CJK_UNIFIED";
    else if (code >= 0x3400 && code <= 0x4dbf) cls = "CJK_EXT_A";
    else if (code >= 0x3040 && code <= 0x309f) cls = "HIRAGANA";
    else if (code >= 0x30a0 && code <= 0x30ff) cls = "KATAKANA";
    else if (code >= 0x0e00 && code <= 0x0e7f) cls = "THAI";
    if (cls) hits.push({ ch, index: i, class: cls });
  }
  return hits;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  firstContentAt: number | null;
};

function processSseLine(line: string, state: StreamState, started: number): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
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
      latency_ms: Date.now() - started,
      ttft_ms: null as number | null,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    firstContentAt: null,
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
    latency_ms: Date.now() - started,
    ttft_ms: state.firstContentAt,
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

async function assembleGeminiQwen(opts: {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  history: ChatMsg[];
  currentUserMessage: string;
  applyCurrentMainSourceAdapter: boolean;
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
    GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
    OPUS_QWEN_FRAGMENT_SENTENCE,
    resolveAdultHandoffModelForSource,
    resolveAdultHandoffTargetModelId,
  } = await import("../src/lib/adultHandoffSourceRouting");
  const { DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION } = await import(
    "../src/lib/adultSceneRouting"
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

  const adultCfg = resolveAdultRoutingConfig();
  const variants = selectAdultHandoffRawVariants(opts.history, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const history = variants.handoff.history;
  const lastAssistant =
    [...opts.history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
    text: lastAssistant,
    characterName: charName,
    personaName,
    currentUserText: opts.currentUserMessage,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: "explicit",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [charName, personaName],
    currentPov: narrativePov.mode,
    ...extractedHandoffContinuity,
  });

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
    modelId: QWEN_REQUESTED,
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
  });

  const sourceModelId = GEMINI_SOURCE_MODEL;
  const adultTargetModelId = resolveAdultHandoffTargetModelId({
    sourceModelId,
    existingAdultModelId: adultCfg.adultModelId,
    state: {},
  });
  const resolvedForSource = resolveAdultHandoffModelForSource(
    sourceModelId,
    adultCfg.adultModelId
  );

  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt,
    continuityPacket as never,
    opts.applyCurrentMainSourceAdapter
      ? { sourceModelId, adultTargetModelId }
      : undefined
  );

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: QWEN_REQUESTED,
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
  adapted.model = QWEN_REQUESTED;
  const messages = adapted.messages as ChatMsg[];
  const systemMsg = messages.find((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systemText = systemMsg?.content ?? "";
  const lastUserText = lastUser?.content ?? "";
  const fullMessages = messages.map((m) => `${m.role}\n${m.content}`).join("\n\n");
  return {
    requestBody: adapted,
    messages,
    systemPrompt,
    lastUserContent: lastUserText,
    continuityPacket,
    resolvedForSource,
    adultTargetModelId,
    sourceModelId,
    generation: {
      temperature: adapted.temperature ?? null,
      top_p: adapted.top_p ?? null,
      max_tokens: adapted.max_tokens ?? null,
      thinking: adapted.thinking ?? null,
      reasoning_effort: adapted.reasoning_effort ?? null,
    },
    blocks: {
      GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
      OPUS_QWEN_FRAGMENT_SENTENCE,
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
    },
    occurrences: {
      GEMINI_STYLE_BLOCK_OCCURRENCES: countOccurrences(
        `${systemText}\n${lastUserText}`,
        GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
      ),
      GEMINI_STYLE_BLOCK_SYSTEM: countOccurrences(
        systemText,
        GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
      ),
      GEMINI_STYLE_BLOCK_LAST_USER: countOccurrences(
        lastUserText,
        GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
      ),
      OPUS_FRAGMENT_BLOCK_OCCURRENCES: countOccurrences(
        `${systemText}\n${lastUserText}`,
        OPUS_QWEN_FRAGMENT_SENTENCE
      ),
      COMMON_HANDOFF_OCCURRENCES: countOccurrences(
        `${systemText}\n${lastUserText}`,
        DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION
      ),
      CONTINUITY_PACKET_OCCURRENCES: countOccurrences(
        `${systemText}\n${lastUserText}`,
        "[SceneContinuityPacket — 비공개 라우팅 문맥]"
      ),
    },
    shas: {
      system: sha256(systemText),
      last_user: sha256(lastUserText),
      full_messages: sha256(fullMessages),
    },
    promptSize: {
      system_chars: systemText.length,
      current_user_chars: lastUserText.length,
      assembled_chars: messages.reduce((sum, m) => sum + m.content.length, 0),
      est_input_tokens: estimateTokens(messages.map((m) => m.content).join("")),
    },
  };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown> | null;
  };
  if (
    !isProductionLikeTaehyungRecord({
      id: fixtures.character._internalId,
      name: String(fixtures.character.name ?? ""),
      description: String(fixtures.character.description ?? ""),
      system_prompt: String(fixtures.character.system_prompt ?? ""),
      world: String(fixtures.character.world ?? ""),
      greeting: String(fixtures.character.greeting ?? ""),
      example_dialog: String(fixtures.character.example_dialog ?? ""),
      setting_chunks: String(fixtures.character.setting_chunks ?? ""),
      speech_profile: String(fixtures.character.speech_profile ?? ""),
    }) ||
    !String(fixtures.persona?.name ?? "").includes("렌")
  ) {
    throw new Error("EXISTING_PRODUCTION_FIXTURES_INVALID");
  }
  if (!existsSync(GEMINI_SOURCE_PATH)) {
    throw new Error(`MISSING_FROZEN_GEMINI_SOURCE:${GEMINI_SOURCE_PATH}`);
  }

  const geminiSource = readFileSync(GEMINI_SOURCE_PATH, "utf8");
  const greeting = String(fixtures.character.greeting ?? "").trim();
  const history: ChatMsg[] = [
    ...(greeting ? [{ role: "assistant" as const, content: greeting }] : []),
    { role: "user", content: SOURCE_SEED_USER },
    { role: "assistant", content: geminiSource },
  ];

  const current = await assembleGeminiQwen({
    character: fixtures.character,
    persona: fixtures.persona!,
    history,
    currentUserMessage: ADULT_HANDOFF_USER,
    applyCurrentMainSourceAdapter: true,
  });
  const legacyFinalizedAssembly = await assembleGeminiQwen({
    character: fixtures.character,
    persona: fixtures.persona!,
    history,
    currentUserMessage: ADULT_HANDOFF_USER,
    applyCurrentMainSourceAdapter: false,
  });

  if (current.resolvedForSource !== QWEN_REQUESTED) {
    throw new Error(`PRODUCTION_TARGET_UNEXPECTED:${current.resolvedForSource}`);
  }
  if (current.adultTargetModelId !== QWEN_REQUESTED) {
    throw new Error(`ADULT_TARGET_UNEXPECTED:${current.adultTargetModelId}`);
  }
  if (current.occurrences.GEMINI_STYLE_BLOCK_SYSTEM !== 1) {
    throw new Error(
      `GEMINI_STYLE_BLOCK_SYSTEM_COUNT:${current.occurrences.GEMINI_STYLE_BLOCK_SYSTEM}`
    );
  }
  if (current.occurrences.GEMINI_STYLE_BLOCK_LAST_USER !== 0) {
    throw new Error("GEMINI_STYLE_BLOCK_LEAKED_TO_LAST_USER");
  }
  if (current.occurrences.OPUS_FRAGMENT_BLOCK_OCCURRENCES !== 0) {
    throw new Error("OPUS_FRAGMENT_LEAKED_INTO_GEMINI_PRODUCTION");
  }
  if (current.occurrences.COMMON_HANDOFF_OCCURRENCES !== 1) {
    throw new Error(
      `COMMON_HANDOFF_COUNT:${current.occurrences.COMMON_HANDOFF_OCCURRENCES}`
    );
  }
  if (current.occurrences.CONTINUITY_PACKET_OCCURRENCES !== 1) {
    throw new Error(
      `CONTINUITY_PACKET_COUNT:${current.occurrences.CONTINUITY_PACKET_OCCURRENCES}`
    );
  }
  if (legacyFinalizedAssembly.occurrences.GEMINI_STYLE_BLOCK_OCCURRENCES !== 0) {
    throw new Error("LEGACY_ASSEMBLY_UNEXPECTEDLY_HAS_GEMINI_BLOCK");
  }
  if (current.shas.system === legacyFinalizedAssembly.shas.system) {
    throw new Error("CURRENT_AND_LEGACY_SYSTEM_SHA_IDENTICAL");
  }
  if (!current.lastUserContent.includes("잡은 소매에서 손으로 올라가 허리를 감싼다")) {
    throw new Error("FROZEN_ADULT_SEED_MISSING");
  }
  if (current.lastUserContent.includes(current.blocks.OPUS_QWEN_FRAGMENT_SENTENCE)) {
    throw new Error("FRAGMENT_SENTENCE_LEAKED_TO_LAST_USER");
  }
  if (current.generation.temperature !== 0.7) {
    throw new Error(`TEMPERATURE_UNEXPECTED:${String(current.generation.temperature)}`);
  }
  if (current.generation.reasoning_effort !== "none") {
    throw new Error(
      `REASONING_UNEXPECTED:${String(current.generation.reasoning_effort)}`
    );
  }

  const parity =
    current.shas.system === legacyFinalizedAssembly.shas.system &&
    current.shas.last_user === legacyFinalizedAssembly.shas.last_user &&
    current.shas.full_messages === legacyFinalizedAssembly.shas.full_messages
      ? "EXACT"
      : "NOT_EXACT";

  const snapshot = {
    extractedAt: new Date().toISOString(),
    CURRENT_MAIN_HEAD: "64a6d1dd9e89b45b17c615a1841b07ebdf9db3c7",
    CURRENT_GEMINI_QWEN_PRODUCTION_TARGET: current.resolvedForSource,
    CURRENT_GEMINI_QWEN_BLOCKS: [
      "base system from buildContext(qwen-3-8-max, cheaperinference)",
      "SceneContinuityPacket",
      "DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
      "GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK",
    ],
    CURRENT_GEMINI_QWEN_BLOCK_ORDER: [
      "systemPrompt.trim()",
      "renderSceneContinuityPacket(packet)",
      "DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
      "GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK",
    ],
    GEMINI_STYLE_BLOCK_OCCURRENCES: current.occurrences.GEMINI_STYLE_BLOCK_OCCURRENCES,
    GEMINI_STYLE_BLOCK_SYSTEM: current.occurrences.GEMINI_STYLE_BLOCK_SYSTEM,
    GEMINI_STYLE_BLOCK_LAST_USER: current.occurrences.GEMINI_STYLE_BLOCK_LAST_USER,
    OPUS_FRAGMENT_BLOCK_OCCURRENCES: current.occurrences.OPUS_FRAGMENT_BLOCK_OCCURRENCES,
    COMMON_HANDOFF_OCCURRENCES: current.occurrences.COMMON_HANDOFF_OCCURRENCES,
    CONTINUITY_PACKET_OCCURRENCES: current.occurrences.CONTINUITY_PACKET_OCCURRENCES,
    CURRENT_GEMINI_QWEN_SYSTEM_SHA: current.shas.system,
    CURRENT_GEMINI_QWEN_LAST_USER_SHA: current.shas.last_user,
    CURRENT_GEMINI_QWEN_FULL_MESSAGES_SHA: current.shas.full_messages,
    LEGACY_FINALIZED_SYSTEM_SHA: legacyFinalizedAssembly.shas.system,
    LEGACY_FINALIZED_LAST_USER_SHA: legacyFinalizedAssembly.shas.last_user,
    LEGACY_FINALIZED_FULL_MESSAGES_SHA: legacyFinalizedAssembly.shas.full_messages,
    EXISTING_PRODUCTION_FINALIZED_PARITY: parity,
    EXISTING_QWEN_SAMPLE_REUSED: false,
    TOTAL_NEW_QWEN_CALLS_PLANNED: MAX_NEW_CALLS,
    TOTAL_NEW_MUSE_CALLS: 0,
    SOURCE_NEW_CALLS: 0,
    DEEPSEEK_NEW_CALLS: 0,
    GLM_NEW_CALLS: 0,
    generation: current.generation,
    promptSize: current.promptSize,
    frozen_gemini_source_sha256: sha256(geminiSource),
    frozen_adult_seed_present: true,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
  };

  save(AUDIT_DOCS, "QWEN_GEMINI_PRODUCTION_PARITY_RUNTIME.json", snapshot);
  save(OUT_ROOT, "QWEN_GEMINI_PRODUCTION_PARITY_RUNTIME.json", snapshot);
  console.log(JSON.stringify(snapshot, null, 2));

  if (SNAPSHOT_ONLY) {
    console.log("[parity] SNAPSHOT_ONLY — no provider calls");
    return;
  }

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  const cells: Record<string, unknown>[] = [];
  let calls = 0;
  for (const sample of [1, 2, 3] as const) {
    if (calls >= MAX_NEW_CALLS) throw new Error("CALL_BUDGET_EXCEEDED");
    const rawName = `QWEN_GEMINI_PRODUCTION_CURRENT_${sample}.txt`;
    if (existsSync(join(AUDIT_DOCS, rawName))) {
      throw new Error(`REFUSING_OVERWRITE:${rawName}`);
    }
    if (current.shas.full_messages !== snapshot.CURRENT_GEMINI_QWEN_FULL_MESSAGES_SHA) {
      throw new Error("ASSEMBLY_MUTATED_BETWEEN_SAMPLES");
    }
    console.log(`\n=== CALL ${calls + 1}/3 Gemini→Qwen current-main production sample ${sample} ===`);
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      current.requestBody
    );
    calls += 1;
    if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
      const fail = {
        sample,
        requested_model: QWEN_REQUESTED,
        HTTP_status: resp.http_status,
        error: resp.error,
        QWEN_CAPABILITY_FAIL: true,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
      };
      cells.push(fail);
      save(AUDIT_DOCS, `QWEN_GEMINI_PRODUCTION_CURRENT_${sample}_META.json`, fail);
      console.error(`[parity] QWEN_CAPABILITY_FAIL sample ${sample}`, fail);
      continue;
    }
    const stats = paragraphStats(resp.text);
    const visible = visibleAssistantDisplayCharCount(resp.text);
    const usage = extractUsage(resp.usage);
    const foreign = findForeignScripts(resp.text);
    const row = {
      source: "gemini",
      sample,
      requested_model: QWEN_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: visible,
      ...stats,
      paragraphs_per_1000:
        visible > 0 ? Number(((stats.paragraph_count / visible) * 1000).toFixed(3)) : 0,
      latency_ms: resp.latency_ms,
      ttft_ms: resp.ttft_ms,
      ...usage,
      cost_per_1000_visible_chars:
        usage.usage_cost != null && visible > 0
          ? Number(((usage.usage_cost / visible) * 1000).toFixed(6))
          : null,
      temperature: current.generation.temperature,
      reasoning_effort: current.generation.reasoning_effort,
      max_tokens: current.generation.max_tokens,
      gemini31_block_present: true,
      opus_fragment_present: false,
      last_user_sha256: current.shas.last_user,
      system_sha256: current.shas.system,
      full_messages_sha256: current.shas.full_messages,
      output_sha256: sha256(resp.text),
      foreign_script_chars: foreign.length,
      foreign_script_hits: foreign.slice(0, 20),
      FOREIGN_SCRIPT_CONTAMINATION: foreign.length > 0,
      incomplete_stream: resp.finish_reason !== "stop",
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      QWEN_CAPABILITY_FAIL: false,
      rawFile: rawName,
      error: resp.error,
    };
    save(AUDIT_DOCS, rawName, resp.text);
    save(OUT_ROOT, rawName, resp.text);
    save(AUDIT_DOCS, `QWEN_GEMINI_PRODUCTION_CURRENT_${sample}_META.json`, row);
    save(OUT_ROOT, `QWEN_GEMINI_PRODUCTION_CURRENT_${sample}_META.json`, row);
    cells.push(row);
    console.log(
      `[parity] ${calls}/3 sample=${sample} chars=${visible} paras=${stats.paragraph_count} cost=${usage.usage_cost} finish=${resp.finish_reason} foreign=${foreign.length}`
    );
  }

  if (calls !== MAX_NEW_CALLS) throw new Error(`CALL_COUNT_MISMATCH:${calls}`);

  const runtime = {
    ...snapshot,
    TOTAL_NEW_QWEN_CALLS: calls,
    cells,
  };
  save(AUDIT_DOCS, "QWEN_GEMINI_PRODUCTION_PARITY_RUNTIME.json", runtime);
  save(OUT_ROOT, "QWEN_GEMINI_PRODUCTION_PARITY_RUNTIME.json", runtime);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
