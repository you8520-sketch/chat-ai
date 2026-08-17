/**
 * DeepSeek 0813 true-nonthinking final n=3 per source.
 * Uses audit-branch adapter (thinking disabled + reasoning_effort none).
 * Does not rewrite existing Vanilla 6 RAW or thinking-off probe files.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-true-nonthinking-n3.ts --phase=assemble
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-true-nonthinking-n3.ts --phase=live
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

import { createHash, randomBytes } from "node:crypto";
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
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
} from "../src/lib/deepseekPromptStructure";
import {
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  OPUS_QWEN_FRAGMENT_SENTENCE,
} from "../src/lib/adultHandoffSourceRouting";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/deepseek0813-adult-handoff-final";
const OUT = join(DOCS, "true-nonthinking");
const ARTIFACT = "/opt/cursor/artifacts/deepseek0813-adult-handoff-final/true-nonthinking";
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const PRODUCTION_TIMEOUT_MS = 240_000;
const OPUS_SOURCE_SHA =
  "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818";
const GEMINI31_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";
const FROZEN_VANILLA_RAW_SHA = {
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

const MUSE_OPUS = [
  "existing-muse-positive/MUSE12_POSITIVE_OPUS.txt",
  "existing-muse-positive/MUSE12_FINAL_OPUS_POSITIVE_2.txt",
  "existing-muse-positive/MUSE12_FINAL_OPUS_POSITIVE_3.txt",
] as const;
const MUSE_GEMINI = [
  "existing-muse-positive/MUSE12_POSITIVE_GEMINI.txt",
  "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_2.txt",
  "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_3.txt",
] as const;

const REASONING_FIELDS = [
  "delta.reasoning",
  "delta.reasoning_content",
  "message.reasoning",
  "message.reasoning_content",
] as const;
type ReasoningField = (typeof REASONING_FIELDS)[number];
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type SourceId = "opus" | "gemini31";

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
      console.warn("[ds0813-tn] artifact write skipped", rel, err);
    }
  }
}

function fieldPresence(body: Record<string, unknown>, key: string) {
  const present = Object.prototype.hasOwnProperty.call(body, key);
  return { present, value: present ? body[key] ?? null : "ABSENT" };
}

function assertFrozenVanillaUntouched() {
  for (const [rel, expect] of Object.entries(FROZEN_VANILLA_RAW_SHA)) {
    const actual = shaFile(rel);
    if (actual !== expect) throw new Error(`FROZEN_VANILLA_MUTATED:${rel}:${actual}`);
  }
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stats(xs: number[]) {
  return {
    run: xs,
    min: xs.length ? Math.min(...xs) : null,
    median: median(xs),
    mean: mean(xs),
    max: xs.length ? Math.max(...xs) : null,
  };
}

function countKoreanChars(text: string): number {
  return [...text].filter((ch) => /\p{Script=Hangul}/u.test(ch)).length;
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
  return typeof obj[key] === "string" ? (obj[key] as string) : "";
}

function recordField(
  statsMap: ReturnType<typeof emptyFieldStats>,
  field: ReasoningField,
  piece: string,
  elapsedMs: number
) {
  if (!piece) return;
  const row = statsMap[field];
  row.chars += [...piece].length;
  row.chunks += 1;
  if (row.firstMs == null) row.firstMs = elapsedMs;
  row.lastMs = elapsedMs;
}

function primaryReasoningField(statsMap: ReturnType<typeof emptyFieldStats>) {
  let best: ReasoningField | null = null;
  let bestChars = 0;
  for (const field of REASONING_FIELDS) {
    if (statsMap[field].chars > bestChars) {
      best = field;
      bestChars = statsMap[field].chars;
    }
  }
  if (!best) return { field: null as ReasoningField | null, chars: 0, firstMs: null, lastMs: null };
  return {
    field: best,
    chars: statsMap[best].chars,
    firstMs: statsMap[best].firstMs,
    lastMs: statsMap[best].lastMs,
  };
}

async function streamChat(body: Record<string, unknown>) {
  const requestStart = Date.now();
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
      requestStartIso: new Date(requestStart).toISOString(),
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
      recordField(fieldStats, "message.reasoning", takeReasoningPiece(message, "reasoning"), elapsed);
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
  if (buffer.trim().startsWith("data:") && buffer.trim().slice(5).trim() === "[DONE]") {
    streamDone = true;
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
    requestStartIso: new Date(requestStart).toISOString(),
    firstVisibleIso,
    streamEndIso: new Date().toISOString(),
    fieldStats,
    error: null as unknown,
  };
}

function assembleTrueNonthinking(opts: {
  sourceModelId: string;
  sourceRaw: string;
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
}) {
  const ch = opts.character;
  const charName = String(ch.name);
  const personaName = String(opts.persona.name ?? "렌");
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
    (opts.persona.gender as "male" | "female" | "other") ?? "other",
    String(opts.persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });
  const history: ChatMsg[] = [
    { role: "assistant", content: String(ch.greeting ?? "") },
    { role: "user", content: SOURCE_SEED_USER },
    { role: "assistant", content: opts.sourceRaw },
  ];
  const adultCfg = resolveAdultRoutingConfig();
  const variants = selectAdultHandoffRawVariants(history, {
    baseExchanges: adultCfg.baseRawExchanges,
    targetExchanges: adultCfg.handoffTargetRawExchanges,
    extraRawTokens: adultCfg.handoffExtraRawTokens,
  });
  const extracted = extractHandoffContinuityFromAssistantText({
    text: opts.sourceRaw,
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
  const handoffOpts = { sourceModelId: opts.sourceModelId, adultTargetModelId: MODEL };
  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt ?? "",
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
      systemSplit: appendAdultHandoffToSystemSplit(
        built.openRouterSystemSplit,
        continuityPacket,
        handoffOpts
      ),
      charName,
      personaName,
    },
  });
  const requestBody = assembled.requestBody as Record<string, unknown>;
  const adaptedAgain = adaptCheaperInferenceChatBody({ ...requestBody });
  if (requestBody.model !== MODEL) throw new Error(`MODEL_NOT_0813:${String(requestBody.model)}`);
  if (JSON.stringify(requestBody.thinking) !== JSON.stringify({ type: "disabled" })) {
    throw new Error(`THINKING_NOT_DISABLED:${JSON.stringify(requestBody.thinking)}`);
  }
  if (requestBody.reasoning_effort !== "none") {
    throw new Error(`REASONING_EFFORT_NOT_NONE:${JSON.stringify(requestBody.reasoning_effort)}`);
  }
  if (Object.prototype.hasOwnProperty.call(requestBody, "reasoning")) {
    throw new Error("REASONING_OBJECT_PRESENT");
  }
  if (Object.prototype.hasOwnProperty.call(requestBody, "include_reasoning")) {
    throw new Error("INCLUDE_REASONING_PRESENT");
  }
  const messages = (requestBody.messages ?? []) as Array<{
    role: string;
    content: string | Array<{ type: "text"; text: string }>;
  }>;
  const flat = messages
    .map((m) => flattenOpenRouterMessageContent(m.content))
    .join("\n");
  const lastUser = flattenOpenRouterMessageContent(
    ([...messages].reverse().find((m) => m.role === "user")?.content ?? "") as
      | string
      | Array<{ type: "text"; text: string }>
  );
  const forbidden = {
    musePositiveOpus: flat.includes("[MUSE SOURCE STYLE CONTINUITY — OPUS 5]"),
    musePositiveGemini: flat.includes("[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]"),
    opusQwenFragment: flat.includes(OPUS_QWEN_FRAGMENT_SENTENCE),
    geminiQwenBlock: flat.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK),
    deepseekLengthSingleCall: flat.includes(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
    deepseekShortHistoryExtra: flat.includes(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA),
  };
  if (Object.values(forbidden).some(Boolean)) {
    throw new Error(`FORBIDDEN_PROMPT:${JSON.stringify(forbidden)}`);
  }
  return {
    requestBody,
    adaptedAgain,
    systemPrompt,
    lastUser,
    continuityPacket,
    generation: {
      model: requestBody.model,
      thinking: requestBody.thinking,
      reasoning_effort: requestBody.reasoning_effort,
      reasoning: fieldPresence(requestBody, "reasoning"),
      include_reasoning: fieldPresence(requestBody, "include_reasoning"),
      temperature: requestBody.temperature ?? null,
      top_p: requestBody.top_p ?? null,
      stream: requestBody.stream ?? null,
    },
    flags: {
      styleReminderPresent: lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY),
      handoffInstructionPresent: systemPrompt.includes(
        "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다."
      ),
      forbidden,
    },
    shas: {
      system: sha256(systemPrompt),
      lastUser: sha256(lastUser),
      fullMessages: sha256(flat),
    },
  };
}

function parsePhase(): "assemble" | "live" | "all" {
  const arg = process.argv.find((a) => a.startsWith("--phase="));
  const value = arg?.slice("--phase=".length) ?? "all";
  if (value === "assemble" || value === "live" || value === "all") return value;
  throw new Error(`unknown --phase=${value}`);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickRuntime(row: Record<string, unknown>) {
  return {
    TTFT: row.TTFT_MS,
    TOTAL_LATENCY: row.TOTAL_LATENCY_MS,
    VISIBLE_CHARS: row.VISIBLE_CHARS,
    COMPLETION_TOKENS: row.COMPLETION_TOKENS,
    COST: row.ACTUAL_COST_USD,
    FINISH_REASON: row.FINISH_REASON,
    REASONING_STREAM_SEEN: row.REASONING_STREAM_SEEN,
    REASONING_TEXT_CHARS: row.REASONING_TEXT_CHARS,
    TERMINAL_USAGE_PRESENT: row.TERMINAL_USAGE_PRESENT,
    INCOMPLETE_STREAM: row.INCOMPLETE_STREAM,
  };
}

async function main() {
  const phase = parsePhase();
  assertFrozenVanillaUntouched();
  const fixtures = JSON.parse(
    readFileSync(join(DOCS, "existing-muse-positive/PRODUCTION_FIXTURES.json"), "utf8")
  ) as { character: Record<string, unknown>; persona: Record<string, unknown> };
  const opusRaw = readFileSync(join(DOCS, "SOURCE_OPUS.txt"), "utf8");
  const geminiRaw = readFileSync(join(DOCS, "SOURCE_GEMINI31.txt"), "utf8");
  if (sha256(opusRaw) !== OPUS_SOURCE_SHA) throw new Error("OPUS_SOURCE_SHA_MISMATCH");
  if (sha256(geminiRaw) !== GEMINI31_SOURCE_SHA) throw new Error("GEMINI31_SOURCE_SHA_MISMATCH");

  const sources: Array<{ id: SourceId; sourceModelId: string; raw: string; sha: string }> = [
    { id: "opus", sourceModelId: "claude-opus-5", raw: opusRaw, sha: OPUS_SOURCE_SHA },
    {
      id: "gemini31",
      sourceModelId: "gemini-3.1-pro-preview",
      raw: geminiRaw,
      sha: GEMINI31_SOURCE_SHA,
    },
  ];
  const assemblies = sources.map((source) => {
    const assembled = assembleTrueNonthinking({
      sourceModelId: source.sourceModelId,
      sourceRaw: source.raw,
      character: fixtures.character,
      persona: fixtures.persona,
    });
    save(`assembled/${source.id}-final-body.json`, {
      source: source.id,
      generation: assembled.generation,
      shas: assembled.shas,
      flags: assembled.flags,
      continuityPacket: assembled.continuityPacket,
    });
    return { source, assembled };
  });
  console.log(
    JSON.stringify(
      {
        phase: "assemble",
        generation: assemblies[0]?.assembled.generation,
        frozenVanillaUntouched: true,
      },
      null,
      2
    )
  );
  if (phase === "assemble") return;

  const rows: Array<Record<string, unknown>> = [];
  for (const { source, assembled } of assemblies) {
    for (let sample = 1; sample <= 3; sample++) {
      const cell =
        source.id === "opus"
          ? `DS0813_OPUS_TRUE_NONTHINKING_${sample}`
          : `DS0813_GEMINI31_TRUE_NONTHINKING_${sample}`;
      let resp: Awaited<ReturnType<typeof streamChat>>;
      try {
        resp = await streamChat(assembled.requestBody);
      } catch (err) {
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
          error: err instanceof Error ? err.message : String(err),
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
        cell,
        source: source.id,
        condition: "TRUE_NONTHINKING",
        sample,
        REQUESTED_MODEL: MODEL,
        RESPONSE_MODEL: resp.resolvedModel,
        HTTP_STATUS: resp.httpStatus,
        TTFT_MS: resp.ttftMs,
        TOTAL_LATENCY_MS: resp.latencyMs,
        VISIBLE_CHARS: visibleChars,
        VISIBLE_KOREAN_CHARS: countKoreanChars(resp.text),
        INPUT_TOKENS: usage.promptTokens || null,
        COMPLETION_TOKENS: usage.completionTokens || null,
        REASONING_STREAM_SEEN: primary.chars > 0,
        REASONING_FIELD: primary.field,
        REASONING_FIRST_MS: primary.firstMs,
        REASONING_LAST_MS: primary.lastMs,
        REASONING_TEXT_CHARS: primary.chars,
        REASONING_FIELD_BREAKDOWN: resp.fieldStats,
        REASONING_TOKENS_REPORTED: usage.reasoningTokens || 0,
        FINISH_REASON: resp.finishReason,
        TERMINAL_USAGE_PRESENT: resp.usageRaw != null,
        STREAM_DONE_PRESENT: resp.streamDone,
        INCOMPLETE_STREAM: resp.incompleteStream,
        ACTUAL_COST_USD: actualCost,
        FALLBACK_COUNT: 0,
        RETRY_COUNT: 0,
        CONTINUATION_COUNT: 0,
        RECOVERY_COUNT: 0,
        sourceSha: source.sha,
        outputSha: sha256(resp.text),
        error: resp.error,
      };
      rows.push(row);
      save(`${cell}_RAW.txt`, resp.text);
      save(`calls/${cell}.json`, row);
      console.log(
        JSON.stringify({
          cell,
          http: row.HTTP_STATUS,
          reasoning: row.REASONING_STREAM_SEEN,
          chars: row.VISIBLE_CHARS,
          ttft: row.TTFT_MS,
          latency: row.TOTAL_LATENCY_MS,
          cost: row.ACTUAL_COST_USD,
        })
      );
    }
  }

  const bySource = (id: SourceId) => rows.filter((r) => r.source === id);
  const nums = (id: SourceId, key: string) =>
    bySource(id)
      .map((r) => (typeof r[key] === "number" ? (r[key] as number) : null))
      .filter((n): n is number => n != null);
  const trueNonthinkingRate = `${rows.filter((r) => r.REASONING_STREAM_SEEN === false).length}/${rows.length}`;

  save("TRUE_NONTHINKING_RUNTIME.json", {
    DS0813_REASONING_CONTAMINATED_REFERENCE: "docs/audits/deepseek0813-adult-handoff-final",
    ADAPTER_AUDIT_CHANGE: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
    DEEPSEEK_PRO_ONLY: true,
    FLASH_CHANGED: false,
    TRUE_NONTHINKING_RATE: trueNonthinkingRate,
    OPUS: {
      HTTP: bySource("opus").map((r) => r.HTTP_STATUS),
      REASONING_STREAM: bySource("opus").map((r) => r.REASONING_STREAM_SEEN),
      REASONING_CHARS: bySource("opus").map((r) => r.REASONING_TEXT_CHARS),
      VISIBLE_CHARS: stats(nums("opus", "VISIBLE_CHARS")),
      TTFT: stats(nums("opus", "TTFT_MS")),
      LATENCY: stats(nums("opus", "TOTAL_LATENCY_MS")),
      COMPLETION_TOKENS: stats(nums("opus", "COMPLETION_TOKENS")),
      COST: stats(nums("opus", "ACTUAL_COST_USD")),
    },
    GEMINI31: {
      HTTP: bySource("gemini31").map((r) => r.HTTP_STATUS),
      REASONING_STREAM: bySource("gemini31").map((r) => r.REASONING_STREAM_SEEN),
      REASONING_CHARS: bySource("gemini31").map((r) => r.REASONING_TEXT_CHARS),
      VISIBLE_CHARS: stats(nums("gemini31", "VISIBLE_CHARS")),
      TTFT: stats(nums("gemini31", "TTFT_MS")),
      LATENCY: stats(nums("gemini31", "TOTAL_LATENCY_MS")),
      COMPLETION_TOKENS: stats(nums("gemini31", "COMPLETION_TOKENS")),
      COST: stats(nums("gemini31", "ACTUAL_COST_USD")),
    },
    rows,
    frozenVanillaUntouched: true,
    liveHeadSha: headSha(),
  });

  const opusCandidates = [
    ...[1, 2, 3].map((n) => ({
      kind: "ds0813_true_nonthinking",
      path: `DS0813_OPUS_TRUE_NONTHINKING_${n}_RAW.txt`,
      text: readFileSync(join(OUT, `DS0813_OPUS_TRUE_NONTHINKING_${n}_RAW.txt`), "utf8"),
      runtimeCell: `DS0813_OPUS_TRUE_NONTHINKING_${n}`,
    })),
    ...MUSE_OPUS.map((rel, i) => ({
      kind: "existing_reference",
      path: rel,
      text: readFileSync(join(DOCS, rel), "utf8"),
      runtimeCell: `EXISTING_REFERENCE_OPUS_${i + 1}`,
    })),
  ];
  const geminiCandidates = [
    ...[1, 2, 3].map((n) => ({
      kind: "ds0813_true_nonthinking",
      path: `DS0813_GEMINI31_TRUE_NONTHINKING_${n}_RAW.txt`,
      text: readFileSync(join(OUT, `DS0813_GEMINI31_TRUE_NONTHINKING_${n}_RAW.txt`), "utf8"),
      runtimeCell: `DS0813_GEMINI31_TRUE_NONTHINKING_${n}`,
    })),
    ...MUSE_GEMINI.map((rel, i) => ({
      kind: "existing_reference",
      path: rel,
      text: readFileSync(join(DOCS, rel), "utf8"),
      runtimeCell: `EXISTING_REFERENCE_GEMINI_${i + 1}`,
    })),
  ];
  const opusShuffled = shuffle(opusCandidates);
  const geminiShuffled = shuffle(geminiCandidates);
  const opusIds = ["TN-O-A", "TN-O-B", "TN-O-C", "TN-O-D", "TN-O-E", "TN-O-F"];
  const geminiIds = ["TN-G-A", "TN-G-B", "TN-G-C", "TN-G-D", "TN-G-E", "TN-G-F"];
  const qualityPacket = (title: string, sourceRaw: string, pairs: Array<{ id: string; text: string }>) =>
    [
      `# ${title}`,
      "",
      "Opaque candidates only. Do not infer model or condition from this file.",
      "",
      "## Source assistant RAW",
      "",
      sourceRaw,
      "",
      "## Current user",
      "",
      ADULT_HANDOFF_USER,
      "",
      ...pairs.flatMap((p) => ["", `## SAMPLE ${p.id}`, "", p.text, ""]),
    ].join("\n");

  save(
    "BLIND_OPUS_TRUE_NONTHINKING_QUALITY.md",
    qualityPacket(
      "BLIND_OPUS_TRUE_NONTHINKING_QUALITY",
      opusRaw,
      opusShuffled.map((c, i) => ({ id: opusIds[i], text: c.text }))
    )
  );
  save(
    "BLIND_GEMINI31_TRUE_NONTHINKING_QUALITY.md",
    qualityPacket(
      "BLIND_GEMINI31_TRUE_NONTHINKING_QUALITY",
      geminiRaw,
      geminiShuffled.map((c, i) => ({ id: geminiIds[i], text: c.text }))
    )
  );
  const reveal: Record<string, unknown> = {};
  const runtimeBlind: Record<string, unknown> = {};
  opusShuffled.forEach((c, i) => {
    reveal[opusIds[i]] = { kind: c.kind, path: c.path, runtimeCell: c.runtimeCell };
    const row = rows.find((r) => r.cell === c.runtimeCell);
    runtimeBlind[opusIds[i]] = row ? pickRuntime(row) : { note: "existing_reference_no_new_runtime" };
  });
  geminiShuffled.forEach((c, i) => {
    reveal[geminiIds[i]] = { kind: c.kind, path: c.path, runtimeCell: c.runtimeCell };
    const row = rows.find((r) => r.cell === c.runtimeCell);
    runtimeBlind[geminiIds[i]] = row
      ? pickRuntime(row)
      : { note: "existing_reference_no_new_runtime" };
  });
  save("DEEPSEEK0813_TRUE_NONTHINKING_VS_MUSE_REVEAL_MAP.json", {
    note: "Do not consult before quality scoring.",
    mapping: reveal,
  });
  save("BLIND_TRUE_NONTHINKING_RUNTIME.json", runtimeBlind);

  const manifestPath = join(DOCS, "MANIFEST.json");
  const prev = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
    : {};
  const next = {
    ...prev,
    DS0813_TRUE_NONTHINKING_FINAL_CAPTURE_COMPLETE: true,
    DS0813_REASONING_CONTAMINATED_REFERENCE: true,
    ADAPTER_AUDIT_CHANGE: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
    DEEPSEEK_PRO_ONLY: true,
    FLASH_CHANGED: false,
    TOTAL_NEW_DEEPSEEK_TRUE_NONTHINKING_CALLS: rows.length,
    TRUE_NONTHINKING_RATE: trueNonthinkingRate,
    BLIND_OPUS_TRUE_NONTHINKING_QUALITY_PACKET:
      "docs/audits/deepseek0813-adult-handoff-final/true-nonthinking/BLIND_OPUS_TRUE_NONTHINKING_QUALITY.md",
    BLIND_GEMINI31_TRUE_NONTHINKING_QUALITY_PACKET:
      "docs/audits/deepseek0813-adult-handoff-final/true-nonthinking/BLIND_GEMINI31_TRUE_NONTHINKING_QUALITY.md",
    BLIND_TRUE_NONTHINKING_RUNTIME_PACKET:
      "docs/audits/deepseek0813-adult-handoff-final/true-nonthinking/BLIND_TRUE_NONTHINKING_RUNTIME.json",
    TRUE_NONTHINKING_REVEAL_MAP:
      "docs/audits/deepseek0813-adult-handoff-final/true-nonthinking/DEEPSEEK0813_TRUE_NONTHINKING_VS_MUSE_REVEAL_MAP.json",
    QUALITY_SCORING_BY_CURSOR: false,
    QUALITY_REVIEW_STATUS: "PENDING_CHATGPT_MANUAL_REVIEW",
    PRODUCTION_CODE_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: false,
    frozenVanillaUntouched: true,
  };
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  assertFrozenVanillaUntouched();
}

void main();
