/**
 * DeepSeek 0813 TRUE THINKING OFF compatibility probe.
 * Audit only. Does not modify production. Does not rewrite existing 6 RAW.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-thinking-off-probe.ts --phase=body
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-thinking-off-probe.ts --phase=probe
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
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { flattenOpenRouterMessageContent } from "../src/lib/openRouterClient";
import {
  appendAdultHandoffPrompt,
  appendAdultHandoffToSystemSplit,
  buildSceneContinuityPacket,
  extractHandoffContinuityFromAssistantText,
  resolveAdultRoutingConfig,
  selectAdultHandoffRawVariants,
} from "../src/lib/adultSceneRouting";
import { resolveNarrativePov } from "../src/lib/narrativePov";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/deepseek0813-adult-handoff-final";
const OUT = join(DOCS, "thinking-off-probe");
const ARTIFACT = "/opt/cursor/artifacts/deepseek0813-adult-handoff-final/thinking-off-probe";
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const PRODUCTION_TIMEOUT_MS = 240_000;
const GEMINI31_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";
const FROZEN_GEMINI_REQUEST_BODY_RELEVANT_SHA =
  "bd26a233e21983feb86955a7a674b57e1d85ba146afe1c945694766ef7cd0468";
const FROZEN_RAW_SHA = {
  "DS0813_OPUS_VANILLA_1_RAW.txt":
    "5687cdb2f7d2d6cfeed3dab3ef7d96f978da1d8b5a97765cc991e97c1828f819",
  "DS0813_OPUS_VANILLA_2_RAW.txt":
    "2157309876de55e9f4724cfe710c0f88c0a88d45ef4dd1777b5e2a90618f16d9",
  "DS0813_OPUS_VANILLA_3_RAW.txt":
    "1b122b32d63b767d9425f97b844e1dd07ea879f70584bcfc91031347b3d629fd",
  "DS0813_GEMINI31_VANILLA_1_RAW.txt":
    "623b8cf37ed1c4b2c544775fa7dbf858fbea45cd4439d9f648d8ec995d85e5fb",
  "DS0813_GEMINI31_VANILLA_2_RAW.txt":
    "f1e24649ba844ea2086b23772107b746a8f6e5eec81ef9a89fb22a8b9884c2e1",
  "DS0813_GEMINI31_VANILLA_3_RAW.txt":
    "645a61d92ff597ce4b1afc9f37ada5e93924f41e288de3f561c4b523fd0063c2",
} as const;

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const REASONING_FIELDS = [
  "delta.reasoning",
  "delta.reasoning_content",
  "message.reasoning",
  "message.reasoning_content",
] as const;
type ReasoningField = (typeof REASONING_FIELDS)[number];

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function shaFile(rel: string): string {
  return createHash("sha256").update(readFileSync(join(DOCS, rel))).digest("hex");
}

function headSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function save(rel: string, content: string | object) {
  const text =
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  for (const root of [OUT, ARTIFACT]) {
    try {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, "utf8");
    } catch (err) {
      if (root === OUT) throw err;
      console.warn("[ds0813-thinking-off] artifact write skipped", rel, err);
    }
  }
}

function fieldPresence(body: Record<string, unknown>, key: string) {
  const present = Object.prototype.hasOwnProperty.call(body, key);
  return {
    present,
    value: present ? body[key] ?? null : "ABSENT",
  };
}

function sanitizeBodyKeys(body: Record<string, unknown>) {
  const keys = Object.keys(body).sort();
  const thinkingRelated = {
    model: fieldPresence(body, "model"),
    thinking: fieldPresence(body, "thinking"),
    reasoning: fieldPresence(body, "reasoning"),
    reasoning_effort: fieldPresence(body, "reasoning_effort"),
    include_reasoning: fieldPresence(body, "include_reasoning"),
  };
  return {
    topLevelKeys: keys,
    thinkingRelated,
    otherScalar: Object.fromEntries(
      keys
        .filter(
          (k) =>
            !["messages", "model", "thinking", "reasoning", "reasoning_effort", "include_reasoning"].includes(
              k
            )
        )
        .map((k) => [k, body[k]])
    ),
  };
}

function assertFrozenRawsUntouched() {
  for (const [rel, expect] of Object.entries(FROZEN_RAW_SHA)) {
    const actual = shaFile(rel);
    if (actual !== expect) {
      throw new Error(`FROZEN_RAW_MUTATED:${rel}:actual=${actual}`);
    }
  }
}

function assembleGemini31Vanilla() {
  const fixtures = JSON.parse(
    readFileSync(join(DOCS, "existing-muse-positive/PRODUCTION_FIXTURES.json"), "utf8")
  ) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
  };
  const sourceRaw = readFileSync(join(DOCS, "SOURCE_GEMINI31.txt"), "utf8");
  if (sha256(sourceRaw) !== GEMINI31_SOURCE_SHA) {
    throw new Error(`GEMINI31_SOURCE_SHA_MISMATCH actual=${sha256(sourceRaw)}`);
  }
  const ch = fixtures.character;
  const charName = String(ch.name);
  const personaName = String(fixtures.persona.name ?? "렌");
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch._internalId ?? 18),
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
    (fixtures.persona.gender as "male" | "female" | "other") ?? "other",
    String(fixtures.persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });
  const history: ChatMsg[] = [
    { role: "assistant", content: String(ch.greeting ?? "") },
    { role: "user", content: SOURCE_SEED_USER },
    { role: "assistant", content: sourceRaw },
  ];
  const adultCfg = resolveAdultRoutingConfig();
  const variants = selectAdultHandoffRawVariants(history, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const extracted = extractHandoffContinuityFromAssistantText({
    text: sourceRaw,
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
    shortTermHistory: variants.handoff.history,
    currentUserMessage: ADULT_HANDOFF_USER,
    nsfw: true,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: Math.max(0, Math.floor((variants.handoff.history.length - 2) / 2)),
    provider: "cheaperinference",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 0,
    narrativePov,
    preserveAdultHandoffRawHistory: true,
  });
  const handoffOpts = {
    sourceModelId: "gemini-3.1-pro-preview",
    adultTargetModelId: MODEL,
  };
  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt ?? "",
    continuityPacket,
    handoffOpts
  );
  const systemSplit = appendAdultHandoffToSystemSplit(
    built.openRouterSystemSplit,
    continuityPacket,
    handoffOpts
  );
  const assembled = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit,
      charName,
      personaName,
    },
  });
  const finalBody = assembled.requestBody as Record<string, unknown>;
  const adaptedAgain = adaptCheaperInferenceChatBody({ ...finalBody });
  const messages = (finalBody.messages ?? []) as Array<{
    role: string;
    content: string | Array<{ type: "text"; text: string }>;
  }>;
  const requestBodyRelevant = sha256(
    JSON.stringify({
      model: finalBody.model,
      temperature: finalBody.temperature,
      top_p: finalBody.top_p,
      max_tokens: finalBody.max_tokens,
      thinking: finalBody.thinking,
      reasoning_effort: finalBody.reasoning_effort,
      messages,
    })
  );
  return {
    sourceSha: sha256(sourceRaw),
    requestBodyBeforeAdapt: assembled.requestBodyBeforeAdapt,
    finalBody,
    adaptedAgain,
    adaptationKeyDiff: assembled.adaptationKeyDiff,
    requestBodyRelevant,
    lastUser: flattenOpenRouterMessageContent(
      ([...messages].reverse().find((m) => m.role === "user")?.content ?? "") as
        | string
        | Array<{ type: "text"; text: string }>
    ),
    continuityPacket,
  };
}

function emptyFieldStats(): Record<
  ReasoningField,
  { chars: number; firstMs: number | null; lastMs: number | null; chunks: number }
> {
  return {
    "delta.reasoning": { chars: 0, firstMs: null, lastMs: null, chunks: 0 },
    "delta.reasoning_content": { chars: 0, firstMs: null, lastMs: null, chunks: 0 },
    "message.reasoning": { chars: 0, firstMs: null, lastMs: null, chunks: 0 },
    "message.reasoning_content": { chars: 0, firstMs: null, lastMs: null, chunks: 0 },
  };
}

function takeReasoningPiece(
  obj: Record<string, unknown>,
  key: "reasoning" | "reasoning_content"
): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function recordField(
  stats: ReturnType<typeof emptyFieldStats>,
  field: ReasoningField,
  piece: string,
  elapsedMs: number
) {
  if (!piece) return;
  const row = stats[field];
  row.chars += [...piece].length;
  row.chunks += 1;
  if (row.firstMs == null) row.firstMs = elapsedMs;
  row.lastMs = elapsedMs;
}

async function streamProbe(body: Record<string, unknown>) {
  const requestStart = Date.now();
  const requestStartIso = new Date(requestStart).toISOString();
  const fieldStats = emptyFieldStats();
  let firstVisibleMs: number | null = null;
  let firstVisibleIso: string | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PRODUCTION_TIMEOUT_MS),
  });
  const httpStatus = res.status;
  if (!res.ok || !res.body) {
    let err: unknown = null;
    try {
      err = await res.json();
    } catch {
      err = await res.text().catch(() => "unreadable");
    }
    return {
      httpStatus,
      text: "",
      finishReason: null,
      resolvedModel: null,
      usageRaw: null,
      streamDone: false,
      incompleteStream: true,
      ttftMs: null,
      latencyMs: Date.now() - requestStart,
      requestStartIso,
      firstVisibleIso,
      streamEndIso: new Date().toISOString(),
      fieldStats,
      error: err,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let resolvedModel: string | null = null;
  let usageRaw: unknown = null;
  let streamDone = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        streamDone = true;
        continue;
      }
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const elapsed = Date.now() - requestStart;
      if (typeof ev.model === "string") resolvedModel = ev.model;
      if (ev.usage) usageRaw = ev.usage;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta =
        choice.delta && typeof choice.delta === "object"
          ? (choice.delta as Record<string, unknown>)
          : {};
      const message =
        choice.message && typeof choice.message === "object"
          ? (choice.message as Record<string, unknown>)
          : {};
      recordField(fieldStats, "delta.reasoning", takeReasoningPiece(delta, "reasoning"), elapsed);
      recordField(
        fieldStats,
        "delta.reasoning_content",
        takeReasoningPiece(delta, "reasoning_content"),
        elapsed
      );
      recordField(
        fieldStats,
        "message.reasoning",
        takeReasoningPiece(message, "reasoning"),
        elapsed
      );
      recordField(
        fieldStats,
        "message.reasoning_content",
        takeReasoningPiece(message, "reasoning_content"),
        elapsed
      );
      const piece = typeof delta.content === "string" ? delta.content : "";
      if (piece) {
        if (firstVisibleMs == null) {
          firstVisibleMs = elapsed;
          firstVisibleIso = new Date().toISOString();
        }
        text += piece;
      }
    }
  }
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data:") && trimmed.slice(5).trim() === "[DONE]") {
      streamDone = true;
    }
  }
  return {
    httpStatus,
    text,
    finishReason,
    resolvedModel,
    usageRaw,
    streamDone,
    incompleteStream: !streamDone || !text,
    ttftMs: firstVisibleMs,
    latencyMs: Date.now() - requestStart,
    requestStartIso,
    firstVisibleIso,
    streamEndIso: new Date().toISOString(),
    fieldStats,
    error: null as unknown,
  };
}

function primaryReasoningField(
  stats: ReturnType<typeof emptyFieldStats>
): { field: ReasoningField | null; chars: number; firstMs: number | null; lastMs: number | null } {
  let best: ReasoningField | null = null;
  let bestChars = 0;
  for (const field of REASONING_FIELDS) {
    if (stats[field].chars > bestChars) {
      best = field;
      bestChars = stats[field].chars;
    }
  }
  if (!best) return { field: null, chars: 0, firstMs: null, lastMs: null };
  return {
    field: best,
    chars: stats[best].chars,
    firstMs: stats[best].firstMs,
    lastMs: stats[best].lastMs,
  };
}

function parsePhase(): "body" | "probe" | "all" {
  const arg = process.argv.find((a) => a.startsWith("--phase="));
  const value = arg?.slice("--phase=".length) ?? "all";
  if (value === "body" || value === "probe" || value === "all") return value;
  throw new Error(`unknown --phase=${value}`);
}

function isUnsupportedParameter(httpStatus: number, error: unknown): boolean {
  if (httpStatus === 400) return true;
  const blob = JSON.stringify(error ?? "").toLowerCase();
  return (
    blob.includes("unsupported") ||
    blob.includes("unknown parameter") ||
    blob.includes("unrecognized") ||
    blob.includes("invalid parameter")
  );
}

async function main() {
  const phase = parsePhase();
  assertFrozenRawsUntouched();
  const assembled = assembleGemini31Vanilla();
  const before = assembled.requestBodyBeforeAdapt;
  const finalBody = assembled.finalBody;
  const adaptedAgain = assembled.adaptedAgain;
  if (JSON.stringify(finalBody.thinking) !== JSON.stringify(adaptedAgain.thinking)) {
    throw new Error("ADAPTER_NOT_IDEMPOTENT_THINKING");
  }
  if (finalBody.model !== MODEL || adaptedAgain.model !== MODEL) {
    throw new Error(`FINAL_MODEL_NOT_0813:${String(finalBody.model)}`);
  }

  const currentBody = {
    CURRENT_FINAL_BODY_MODEL: fieldPresence(finalBody, "model"),
    CURRENT_FINAL_BODY_THINKING: fieldPresence(finalBody, "thinking"),
    CURRENT_FINAL_BODY_REASONING: fieldPresence(finalBody, "reasoning"),
    CURRENT_FINAL_BODY_REASONING_EFFORT: fieldPresence(finalBody, "reasoning_effort"),
    CURRENT_FINAL_BODY_INCLUDE_REASONING: fieldPresence(finalBody, "include_reasoning"),
    beforeAdapt: sanitizeBodyKeys(before),
    afterAdapt: sanitizeBodyKeys(finalBody),
    adaptIdempotent: JSON.stringify(finalBody) === JSON.stringify(adaptedAgain),
    adaptationKeyDiff: assembled.adaptationKeyDiff,
    requestBodyRelevantSha: assembled.requestBodyRelevant,
    matchesFrozenGeminiVanillaRequestSha:
      assembled.requestBodyRelevant === FROZEN_GEMINI_REQUEST_BODY_RELEVANT_SHA,
    sourceSha: assembled.sourceSha,
    frozenRawsUntouched: true,
    note: "API key not dumped. messages omitted; SHA compared to frozen Gemini31 VANILLA assembly.",
  };
  save("CURRENT_FINAL_BODY.json", currentBody);
  console.log(
    JSON.stringify(
      {
        phase: "body",
        CURRENT_FINAL_BODY_MODEL: currentBody.CURRENT_FINAL_BODY_MODEL,
        CURRENT_FINAL_BODY_THINKING: currentBody.CURRENT_FINAL_BODY_THINKING,
        CURRENT_FINAL_BODY_REASONING: currentBody.CURRENT_FINAL_BODY_REASONING,
        CURRENT_FINAL_BODY_REASONING_EFFORT: currentBody.CURRENT_FINAL_BODY_REASONING_EFFORT,
        CURRENT_FINAL_BODY_INCLUDE_REASONING: currentBody.CURRENT_FINAL_BODY_INCLUDE_REASONING,
        matchesFrozenGeminiVanillaRequestSha: currentBody.matchesFrozenGeminiVanillaRequestSha,
      },
      null,
      2
    )
  );
  if (phase === "body") return;

  const probeBody: Record<string, unknown> = { ...finalBody, reasoning_effort: "none" };
  if (JSON.stringify(probeBody.thinking) !== JSON.stringify({ type: "disabled" })) {
    throw new Error("PROBE_THINKING_MUTATED");
  }
  if (probeBody.model !== MODEL) throw new Error("PROBE_MODEL_MUTATED");
  const probeDiffKeys = Object.keys(probeBody)
    .filter((k) => JSON.stringify(probeBody[k]) !== JSON.stringify(finalBody[k]))
    .sort();
  save("PROBE_REQUEST_OVERRIDE.json", {
    note: "Diagnostic override only. Not a production adapter change.",
    PROBE_OVERRIDE: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
    keysChangedFromProductionFinalBody: probeDiffKeys,
    probeThinking: probeBody.thinking,
    probeReasoningEffort: probeBody.reasoning_effort,
    productionReasoningEffort: fieldPresence(finalBody, "reasoning_effort"),
  });

  const rows: Array<Record<string, unknown>> = [];
  let stopReason: string | null = null;
  let ciUnsupported = false;
  let ciAcceptedButIneffective = false;

  for (let sample = 1; sample <= 3; sample++) {
    let resp: Awaited<ReturnType<typeof streamProbe>>;
    try {
      resp = await streamProbe(probeBody);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resp = {
        httpStatus: 0,
        text: "",
        finishReason: null,
        resolvedModel: null,
        usageRaw: null,
        streamDone: false,
        incompleteStream: true,
        ttftMs: null,
        latencyMs: 0,
        requestStartIso: new Date().toISOString(),
        firstVisibleIso: null,
        streamEndIso: new Date().toISOString(),
        fieldStats: emptyFieldStats(),
        error: msg,
      };
    }
    const usage = parseOpenRouterUsage(resp.usageRaw);
    const usageObj =
      resp.usageRaw && typeof resp.usageRaw === "object"
        ? (resp.usageRaw as Record<string, unknown>)
        : {};
    const primary = primaryReasoningField(resp.fieldStats);
    const visibleChars = [...resp.text].length;
    const actualCost =
      typeof usageObj.cost === "number" ? usageObj.cost : usage.upstreamCostUsd ?? null;
    const row = {
      cell: `GEMINI31_THINKING_OFF_PROBE_${sample}`,
      HTTP_STATUS: resp.httpStatus,
      TTFT_MS: resp.ttftMs,
      TOTAL_LATENCY_MS: resp.latencyMs,
      VISIBLE_CHARS: visibleChars,
      REASONING_STREAM_SEEN: primary.chars > 0,
      REASONING_FIELD: primary.field,
      REASONING_FIRST_MS: primary.firstMs,
      REASONING_LAST_MS: primary.lastMs,
      REASONING_TEXT_CHARS: primary.chars,
      REASONING_FIELD_BREAKDOWN: resp.fieldStats,
      INPUT_TOKENS: usage.promptTokens || null,
      COMPLETION_TOKENS: usage.completionTokens || null,
      REASONING_TOKENS_REPORTED: usage.reasoningTokens || 0,
      FINISH_REASON: resp.finishReason,
      TERMINAL_USAGE_PRESENT: resp.usageRaw != null,
      STREAM_DONE_PRESENT: resp.streamDone,
      INCOMPLETE_STREAM: resp.incompleteStream,
      ACTUAL_COST_USD: actualCost,
      RESPONSE_MODEL: resp.resolvedModel,
      FALLBACK_COUNT: 0,
      RETRY_COUNT: 0,
      CONTINUATION_COUNT: 0,
      RECOVERY_COUNT: 0,
      outputSha: sha256(resp.text),
      error: resp.error,
    };
    rows.push(row);
    save(`calls/${row.cell}.json`, row);
    if (resp.text) save(`${row.cell}_RAW.txt`, resp.text);
    console.log(JSON.stringify(row));

    if (isUnsupportedParameter(resp.httpStatus, resp.error)) {
      ciUnsupported = true;
      stopReason = "CI_REASONING_NONE_UNSUPPORTED";
      break;
    }
    if (resp.httpStatus === 200 && primary.chars > 0) {
      ciAcceptedButIneffective = true;
      stopReason = "CI_REASONING_NONE_ACCEPTED_BUT_INEFFECTIVE";
      break;
    }
    if (resp.httpStatus !== 200) {
      stopReason = `HTTP_${resp.httpStatus}_STOP`;
      break;
    }
  }

  assertFrozenRawsUntouched();
  const summary = {
    DEEPSEEK0813_THINKING_OFF_PROBE_COMPLETE: true,
    CURRENT_BODY_THINKING: finalBody.thinking ?? "ABSENT",
    CURRENT_BODY_REASONING_EFFORT: fieldPresence(finalBody, "reasoning_effort"),
    PROBE_OVERRIDE: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
    PROBE_CALLS: rows.length,
    HTTP: rows.map((r) => r.HTTP_STATUS),
    REASONING_STREAM_SEEN: rows.map((r) => r.REASONING_STREAM_SEEN),
    REASONING_FIELD: rows.map((r) => r.REASONING_FIELD),
    REASONING_CHARS: rows.map((r) => r.REASONING_TEXT_CHARS),
    TTFT: rows.map((r) => r.TTFT_MS),
    TOTAL_LATENCY: rows.map((r) => r.TOTAL_LATENCY_MS),
    VISIBLE_CHARS: rows.map((r) => r.VISIBLE_CHARS),
    COMPLETION_TOKENS: rows.map((r) => r.COMPLETION_TOKENS),
    FINISH_REASON: rows.map((r) => r.FINISH_REASON),
    TERMINAL_USAGE: rows.map((r) => r.TERMINAL_USAGE_PRESENT),
    COST: rows.map((r) => r.ACTUAL_COST_USD),
    REFERENCE_GEMINI_TTFT: [40255, 78059, 94295],
    REFERENCE_GEMINI_REASONING_CHARS: [6552, 6066, 15126],
    REFERENCE_GEMINI_VISIBLE_CHARS: [4085, 5929, 2592],
    REFERENCE_GEMINI_LATENCY: [106088, 179052, 117889],
    CI_REASONING_NONE_UNSUPPORTED: ciUnsupported,
    CI_REASONING_NONE_ACCEPTED_BUT_INEFFECTIVE: ciAcceptedButIneffective,
    STOP_REASON: stopReason,
    DS0813_VANILLA_LENGTH: "OBSERVED_ONLY",
    DS0813_LENGTH_RESCUE_REQUIRED: "NOT_YET",
    DS0813_THINKING_OFF_REQUESTED: true,
    DS0813_REASONING_ACTUALLY_OBSERVED: "5/6",
    DS0813_TRUE_NONTHINKING_CONFIRMED: rows.length === 3 && rows.every((r) => r.REASONING_STREAM_SEEN === false),
    QUALITY_SCORING_BY_CURSOR: false,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    frozenRawsUntouched: true,
    liveHeadSha: headSha(),
    rows,
  };
  save("THINKING_OFF_PROBE.json", summary);

  const manifestPath = join(DOCS, "MANIFEST.json");
  const prev = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
    : {};
  const next = {
    ...prev,
    DEEPSEEK0813_THINKING_OFF_PROBE_COMPLETE: true,
    DS0813_VANILLA_LENGTH: "OBSERVED_ONLY",
    DS0813_LENGTH_RESCUE_REQUIRED: "NOT_YET",
    DS0813_THINKING_OFF_REQUESTED: true,
    DS0813_REASONING_ACTUALLY_OBSERVED: "5/6",
    DS0813_TRUE_NONTHINKING_CONFIRMED: summary.DS0813_TRUE_NONTHINKING_CONFIRMED,
    CI_REASONING_NONE_UNSUPPORTED: ciUnsupported,
    CI_REASONING_NONE_ACCEPTED_BUT_INEFFECTIVE: ciAcceptedButIneffective,
    THINKING_OFF_PROBE_DIR: "docs/audits/deepseek0813-adult-handoff-final/thinking-off-probe",
    QUALITY_REVIEW_STATUS: "PENDING_TRUE_THINKING_OFF_THEN_CHATGPT_MANUAL_REVIEW",
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
  };
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    mkdirSync("/opt/cursor/artifacts/deepseek0813-adult-handoff-final", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/deepseek0813-adult-handoff-final/MANIFEST.json",
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* optional */
  }
  assertFrozenRawsUntouched();
  console.log(JSON.stringify({ phase: "probe", STOP_REASON: stopReason, calls: rows.length }, null, 2));
}

void main();
