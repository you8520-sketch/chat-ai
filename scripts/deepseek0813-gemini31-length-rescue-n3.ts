/**
 * Gemini 3.1 → DS0813 true-nonthinking + historical DeepSeek length instruction.
 * Audit only. Does not rewrite Vanilla / probe / true-nonthinking RAW.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-gemini31-length-rescue-n3.ts --phase=assemble
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-gemini31-length-rescue-n3.ts --phase=live
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
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
} from "../src/lib/deepseekPromptStructure";
import { GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK } from "../src/lib/adultHandoffSourceRouting";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/deepseek0813-adult-handoff-final";
const OUT = join(DOCS, "length-rescue");
const ARTIFACT = "/opt/cursor/artifacts/deepseek0813-adult-handoff-final/length-rescue";
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const PRODUCTION_TIMEOUT_MS = 240_000;
const GEMINI31_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";
const BASELINE_LAST_USER_SHA =
  "12d1190b38c05415e589faea80a5f56f73a7d645605cacfff01afe9ac28a2f6e";
const BASELINE_SYSTEM_SHA =
  "6dee5d7edb03099ecf8bf896a7641da5a0ad25cdd96eb78c433bfe1c024f0080";
const BASELINE_FULL_MESSAGES_SHA =
  "cd555aeaedf8cc595737a343c9c29f93b49e4bd47dc98fcf2ba779461bd1ba5c";
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
const FROZEN_TN_GEMINI_RAW_SHA = {
  "DS0813_GEMINI31_TRUE_NONTHINKING_1_RAW.txt":
    "e4a723661f2655023eb4be12b25666994268ba80182939d2e5bc5e5cd9914e20",
  "DS0813_GEMINI31_TRUE_NONTHINKING_2_RAW.txt":
    "1a8e3cf1cf65c300150c5412655cd4acfa0b672ee01e2f346d7a49ddae2d771a",
  "DS0813_GEMINI31_TRUE_NONTHINKING_3_RAW.txt":
    "115365ec0137558675179acffa91450bc7709f1b2c98e6528d21b5c1a0242195",
} as const;

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const MUSE_GEMINI = [
  {
    rel: "existing-muse-positive/MUSE12_POSITIVE_GEMINI.txt",
    VISIBLE_CHARS: 4306,
    TTFT: 12117,
    TOTAL_LATENCY: 36853,
    COMPLETION_TOKENS: 4256,
    COST: 0.027286,
    FINISH_REASON: "stop",
    REASONING_STREAM_SEEN: null,
    REASONING_TEXT_CHARS: null,
    TERMINAL_USAGE_PRESENT: true,
    INCOMPLETE_STREAM: false,
  },
  {
    rel: "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_2.txt",
    VISIBLE_CHARS: 5460,
    TTFT: 14148,
    TOTAL_LATENCY: 50510,
    COMPLETION_TOKENS: 4965,
    COST: 0.019274,
    FINISH_REASON: "stop",
    REASONING_STREAM_SEEN: null,
    REASONING_TEXT_CHARS: null,
    TERMINAL_USAGE_PRESENT: true,
    INCOMPLETE_STREAM: false,
  },
  {
    rel: "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_3.txt",
    VISIBLE_CHARS: 3646,
    TTFT: 13832,
    TOTAL_LATENCY: 40481,
    COMPLETION_TOKENS: 3931,
    COST: 0.015539,
    FINISH_REASON: "stop",
    REASONING_STREAM_SEEN: null,
    REASONING_TEXT_CHARS: null,
    TERMINAL_USAGE_PRESENT: true,
    INCOMPLETE_STREAM: false,
  },
] as const;

const BASELINE_VISIBLE = [1339, 2258, 2159] as const;
const BASELINE_TTFT = [3042, 1709, 2005] as const;
const BASELINE_LATENCY = [28331, 43677, 43102] as const;
const BASELINE_COMPLETION = [1051, 1755, 1691] as const;

const REASONING_FIELDS = [
  "delta.reasoning",
  "delta.reasoning_content",
  "message.reasoning",
  "message.reasoning_content",
] as const;
type ReasoningField = (typeof REASONING_FIELDS)[number];
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type Message = { role: string; content: string | Array<{ type: "text"; text: string }> };

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function shaFile(rel: string): string {
  return createHash("sha256").update(readFileSync(join(DOCS, rel))).digest("hex");
}

function headSha(ref = "HEAD"): string {
  try {
    return execSync(`git rev-parse ${ref}`, { encoding: "utf8" }).trim();
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
      console.warn("[ds0813-lr] artifact write skipped", rel, err);
    }
  }
}

function fieldPresence(body: Record<string, unknown>, key: string) {
  const present = Object.prototype.hasOwnProperty.call(body, key);
  return { present, value: present ? body[key] ?? null : "ABSENT" };
}

function assertFrozenReferencesUntouched() {
  for (const [rel, expect] of Object.entries(FROZEN_VANILLA_RAW_SHA)) {
    const actual = shaFile(rel);
    if (actual !== expect) throw new Error(`FROZEN_VANILLA_MUTATED:${rel}:${actual}`);
  }
  for (const [rel, expect] of Object.entries(FROZEN_TN_GEMINI_RAW_SHA)) {
    const actual = shaFile(join("true-nonthinking", rel));
    if (actual !== expect) throw new Error(`FROZEN_TN_MUTATED:${rel}:${actual}`);
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

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  return /["“”「」『』]/.test(p);
}

function countSentences(p: string): number {
  const parts = p
    .split(/(?<=[.!?。！？])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return p.trim() ? 1 : 0;
  return parts.length;
}

function structureMetrics(text: string) {
  const paragraphs = paragraphsOf(text);
  const chars = [...text].length;
  const oneSentence = paragraphs.filter((p) => countSentences(p) === 1);
  const dialogue = paragraphs.filter(isDialogueParagraph);
  const paraChars = paragraphs.map((p) => [...p].length);
  const sentenceCounts = paragraphs.map(countSentences);
  let adjacentSameSpeaker = 0;
  for (let i = 1; i < paragraphs.length; i++) {
    if (isDialogueParagraph(paragraphs[i - 1]) && isDialogueParagraph(paragraphs[i])) {
      adjacentSameSpeaker += 1;
    }
  }
  const sentences = sentenceCounts.reduce((a, b) => a + b, 0);
  return {
    PARAGRAPH_COUNT: paragraphs.length,
    PARAGRAPHS_PER_1000_CHARS: chars ? (paragraphs.length / chars) * 1000 : null,
    ONE_SENTENCE_PARAGRAPH_COUNT: oneSentence.length,
    ONE_SENTENCE_PARAGRAPH_SHARE: paragraphs.length
      ? oneSentence.length / paragraphs.length
      : null,
    AVG_PARAGRAPH_CHARS: paraChars.length ? mean(paraChars) : null,
    MEDIAN_PARAGRAPH_CHARS: median(paraChars),
    DIALOGUE_BLOCK_COUNT: dialogue.length,
    DIALOGUE_BLOCKS_PER_1000_CHARS: chars ? (dialogue.length / chars) * 1000 : null,
    ADJACENT_SAME_SPEAKER_DIALOGUE_BLOCKS: adjacentSameSpeaker,
    SENTENCE_COUNT: sentences,
    AVG_SENTENCES_PER_PARAGRAPH: paragraphs.length ? sentences / paragraphs.length : null,
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

function lastUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  throw new Error("NO_LAST_USER");
}

function setMessageText(msg: Message, text: string) {
  if (typeof msg.content === "string") {
    msg.content = text;
    return;
  }
  if (Array.isArray(msg.content) && msg.content[0] && msg.content[0].type === "text") {
    msg.content = [{ type: "text", text }];
    return;
  }
  msg.content = text;
}

function historyText(messages: Message[]): string {
  const idx = lastUserIndex(messages);
  return messages
    .filter((_, i) => i !== idx)
    .filter((m) => m.role !== "system")
    .map((m) => flattenOpenRouterMessageContent(m.content))
    .join("\n");
}

function stripHistoricalLength(text: string): string {
  return text.replace(`\n${DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK}`, "");
}

function injectHistoricalLength(requestBody: Record<string, unknown>) {
  const messages = [...((requestBody.messages ?? []) as Message[])].map((m) => ({
    ...m,
    content: Array.isArray(m.content) ? m.content.map((p) => ({ ...p })) : m.content,
  }));
  const idx = lastUserIndex(messages);
  const baselineLastUser = flattenOpenRouterMessageContent(messages[idx].content);
  if (baselineLastUser.includes(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK)) {
    throw new Error("HISTORICAL_LENGTH_ALREADY_PRESENT");
  }
  if (!baselineLastUser.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)) {
    throw new Error("STYLE_REMINDER_MISSING_CANNOT_PLACE");
  }
  const injected =
    DEEPSEEK_BOTTOM_REMINDER + baselineLastUser.slice(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.length);
  if (stripHistoricalLength(injected) !== baselineLastUser) {
    throw new Error("LENGTH_STRIP_DID_NOT_RESTORE_BASELINE_LAST_USER");
  }
  setMessageText(messages[idx], injected);
  return { messages, baselineLastUser, injectedLastUser: injected };
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

function assembleBaseline(opts: {
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
  const handoffOpts = {
    sourceModelId: "gemini-3.1-pro-preview",
    adultTargetModelId: MODEL,
  };
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
  adaptCheaperInferenceChatBody(requestBody);
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
  const messages = (requestBody.messages ?? []) as Message[];
  const flat = messages.map((m) => flattenOpenRouterMessageContent(m.content)).join("\n");
  const lastUser = flattenOpenRouterMessageContent(messages[lastUserIndex(messages)].content);
  if (lastUser.includes(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK)) {
    throw new Error("HISTORICAL_LENGTH_ALREADY_PRESENT");
  }
  if (flat.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK)) {
    throw new Error("QWEN_PROMPT_PRESENT");
  }
  if (flat.includes("[MUSE SOURCE STYLE CONTINUITY")) {
    throw new Error("MUSE_PROMPT_PRESENT");
  }
  if (flat.includes(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA)) {
    throw new Error("SHORT_HISTORY_EXTRA_PRESENT");
  }
  if (!lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)) {
    throw new Error("COMMON_USER_TAIL_LENGTH_OWNER_MISSING");
  }
  if (USER_TAIL_LENGTH_OWNER_SENTENCE === DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK) {
    throw new Error("COMMON_OWNER_EQUALS_HISTORICAL_DEEPSEEK");
  }
  return {
    requestBody,
    systemPrompt,
    lastUser,
    continuityPacket,
    messages,
    flat,
    shas: {
      SOURCE_SHA: GEMINI31_SOURCE_SHA,
      SYSTEM_SHA: sha256(systemPrompt),
      HISTORY_SHA: sha256(historyText(messages)),
      LAST_USER_SHA: sha256(lastUser),
      FULL_MESSAGES_SHA: sha256(flat),
    },
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
    VISIBLE_CHARS: row.VISIBLE_CHARS,
    TTFT: row.TTFT_MS,
    TOTAL_LATENCY: row.TOTAL_LATENCY_MS,
    COMPLETION_TOKENS: row.COMPLETION_TOKENS,
    REASONING: {
      STREAM_SEEN: row.REASONING_STREAM_SEEN,
      TEXT_CHARS: row.REASONING_TEXT_CHARS,
    },
    COST: row.ACTUAL_COST_USD,
    FINISH_REASON: row.FINISH_REASON,
    TERMINAL_USAGE: row.TERMINAL_USAGE_PRESENT,
    INCOMPLETE_STREAM: row.INCOMPLETE_STREAM,
  };
}

async function main() {
  const phase = parsePhase();
  assertFrozenReferencesUntouched();
  const fixtures = JSON.parse(
    readFileSync(join(DOCS, "existing-muse-positive/PRODUCTION_FIXTURES.json"), "utf8")
  ) as { character: Record<string, unknown>; persona: Record<string, unknown> };
  const geminiRaw = readFileSync(join(DOCS, "SOURCE_GEMINI31.txt"), "utf8");
  if (sha256(geminiRaw) !== GEMINI31_SOURCE_SHA) throw new Error("GEMINI31_SOURCE_SHA_MISMATCH");

  const baseline = assembleBaseline({
    sourceRaw: geminiRaw,
    character: fixtures.character,
    persona: fixtures.persona,
  });
  if (baseline.shas.SYSTEM_SHA !== BASELINE_SYSTEM_SHA) {
    throw new Error(`BASELINE_SYSTEM_SHA_DRIFT:${baseline.shas.SYSTEM_SHA}`);
  }
  if (baseline.shas.LAST_USER_SHA !== BASELINE_LAST_USER_SHA) {
    throw new Error(`BASELINE_LAST_USER_SHA_DRIFT:${baseline.shas.LAST_USER_SHA}`);
  }
  if (baseline.shas.FULL_MESSAGES_SHA !== BASELINE_FULL_MESSAGES_SHA) {
    throw new Error(`BASELINE_FULL_MESSAGES_SHA_DRIFT:${baseline.shas.FULL_MESSAGES_SHA}`);
  }

  const injected = injectHistoricalLength(baseline.requestBody);
  const rescueBody: Record<string, unknown> = {
    ...baseline.requestBody,
    messages: injected.messages,
  };
  adaptCheaperInferenceChatBody(rescueBody);
  if (JSON.stringify(rescueBody.thinking) !== JSON.stringify({ type: "disabled" })) {
    throw new Error("RESCUE_THINKING_CHANGED");
  }
  if (rescueBody.reasoning_effort !== "none") throw new Error("RESCUE_REASONING_EFFORT_CHANGED");
  if (Object.prototype.hasOwnProperty.call(rescueBody, "reasoning")) {
    throw new Error("RESCUE_REASONING_OBJECT_PRESENT");
  }
  if (Object.prototype.hasOwnProperty.call(rescueBody, "include_reasoning")) {
    throw new Error("RESCUE_INCLUDE_REASONING_PRESENT");
  }

  const rescueFlat = injected.messages
    .map((m) => flattenOpenRouterMessageContent(m.content))
    .join("\n");
  const rescueLastUser = injected.injectedLastUser;
  const strippedLastUser = stripHistoricalLength(rescueLastUser);
  const strippedFlat = stripHistoricalLength(rescueFlat);
  const nonLengthParity =
    strippedLastUser === baseline.lastUser &&
    sha256(strippedLastUser) === baseline.shas.LAST_USER_SHA &&
    sha256(historyText(injected.messages)) === baseline.shas.HISTORY_SHA &&
    sha256(baseline.systemPrompt) === baseline.shas.SYSTEM_SHA &&
    sha256(strippedFlat) === baseline.shas.FULL_MESSAGES_SHA;

  const provenance = {
    DEEPSEEK_LENGTH_PROMPT_PROVEN: true,
    DEEPSEEK_LENGTH_PROMPT_NOT_PROVABLE: false,
    HISTORICAL_LENGTH_ALREADY_PRESENT: false,
    LIVE_CALLS_NOT_RUN: phase === "assemble",
    DEEPSEEK_LENGTH_PROMPT_PROVENANCE: {
      file: "src/lib/deepseekPromptStructure.ts",
      symbol: "DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK",
      commit_introduced: "53efcab01ab86c9b1485b9e10c1c9e46a400f939",
      commit_removed_from_production_injection: "64d6c47ce761eba46dc88ec2158a9cfbdd18be0a",
      artifact: "src/lib/deepseekPromptStructure.ts",
      exact_text: DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
      exact_text_sha256: sha256(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
      placement:
        "current user-turn prefix, immediately after DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY (historical prependDeepSeekBottomReminder)",
      historical_model: "DeepSeek V4 Pro (xml-mode user-turn reminder)",
      historical_purpose:
        "DeepSeek-only single-call length stabilization so recent short assistant replies are not imitated as the desired length",
    },
    common_length_owner: {
      symbol: "USER_TAIL_LENGTH_OWNER_SENTENCE",
      identical_to_historical: false,
      already_present_in_baseline: baseline.lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    },
    rejected_as_not_historical_production: [
      "SNPV2 DEEPSEEK LENGTH ADAPTER B/C (experiment env, default OFF)",
      "DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA / SHORT USER / REGEN (also OFF on production path)",
      "Muse / Qwen length or style prompts",
    ],
  };

  save("LENGTH_PROMPT_PROVENANCE.md", [
    "# DeepSeek historical length instruction provenance",
    "",
    `DEEPSEEK_LENGTH_PROMPT_PROVEN: ${provenance.DEEPSEEK_LENGTH_PROMPT_PROVEN}`,
    `DEEPSEEK_LENGTH_PROMPT_NOT_PROVABLE: ${provenance.DEEPSEEK_LENGTH_PROMPT_NOT_PROVABLE}`,
    `HISTORICAL_LENGTH_ALREADY_PRESENT: ${provenance.HISTORICAL_LENGTH_ALREADY_PRESENT}`,
    "",
    "## Provenance",
    "",
    `- file: \`${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.file}\``,
    `- commit/ref introduced: \`${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.commit_introduced}\``,
    `- commit/ref removed from production injection: \`${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.commit_removed_from_production_injection}\``,
    `- artifact: \`${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.artifact}\``,
    `- exact_text_sha256: \`${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.exact_text_sha256}\``,
    `- placement: ${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.placement}`,
    `- historical_model: ${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.historical_model}`,
    `- historical_purpose: ${provenance.DEEPSEEK_LENGTH_PROMPT_PROVENANCE.historical_purpose}`,
    "",
    "## exact_text",
    "",
    "```",
    DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
    "```",
    "",
    "No new wording. Common USER_TAIL length owner is a different Korean sentence and is already present; it is not duplicated.",
    "",
  ].join("\n"));
  save("LENGTH_PROMPT_PROVENANCE.json", provenance);
  save("PROMPT_PARITY.json", {
    SOURCE_SHA: GEMINI31_SOURCE_SHA,
    baseline: baseline.shas,
    rescue: {
      SOURCE_SHA: GEMINI31_SOURCE_SHA,
      SYSTEM_SHA: sha256(baseline.systemPrompt),
      HISTORY_SHA: sha256(historyText(injected.messages)),
      LAST_USER_SHA: sha256(rescueLastUser),
      FULL_MESSAGES_SHA: sha256(rescueFlat),
    },
    NON_LENGTH_PROMPT_PARITY: nonLengthParity,
    transport: baseline.generation,
    historical_length_present_in_rescue: rescueLastUser.includes(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
    historical_length_present_in_baseline: false,
  });
  save("assembled/gemini31-baseline-final-body.json", {
    generation: baseline.generation,
    shas: baseline.shas,
    continuityPacket: baseline.continuityPacket,
  });
  save("assembled/gemini31-rescue-final-body.json", {
    generation: {
      model: rescueBody.model,
      thinking: rescueBody.thinking,
      reasoning_effort: rescueBody.reasoning_effort,
      reasoning: fieldPresence(rescueBody, "reasoning"),
      include_reasoning: fieldPresence(rescueBody, "include_reasoning"),
      temperature: rescueBody.temperature ?? null,
      top_p: rescueBody.top_p ?? null,
      stream: rescueBody.stream ?? null,
    },
    shas: {
      SOURCE_SHA: GEMINI31_SOURCE_SHA,
      SYSTEM_SHA: sha256(baseline.systemPrompt),
      HISTORY_SHA: sha256(historyText(injected.messages)),
      LAST_USER_SHA: sha256(rescueLastUser),
      FULL_MESSAGES_SHA: sha256(rescueFlat),
    },
    historicalLengthPresent: true,
  });

  if (!nonLengthParity) throw new Error("NON_LENGTH_PROMPT_PARITY_FALSE");

  console.log(
    JSON.stringify(
      {
        phase: "assemble",
        DEEPSEEK_LENGTH_PROMPT_PROVEN: true,
        HISTORICAL_LENGTH_ALREADY_PRESENT: false,
        NON_LENGTH_PROMPT_PARITY: true,
        TRUE_NONTHINKING_CONFIG: {
          thinking: { type: "disabled" },
          reasoning_effort: "none",
        },
        DEEPSEEK_LENGTH_PROMPT_SHA: sha256(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
      },
      null,
      2
    )
  );
  if (phase === "assemble") return;

  const rows: Array<Record<string, unknown>> = [];
  const structures: Array<Record<string, unknown>> = [];
  for (let sample = 1; sample <= 3; sample++) {
    const cell = `DS0813_GEMINI31_LENGTH_RESCUE_${sample}`;
    const resp = await streamChat(rescueBody);
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
      source: "gemini31",
      condition: "TRUE_NONTHINKING_LENGTH_RESCUE",
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
      sourceSha: GEMINI31_SOURCE_SHA,
      outputSha: sha256(resp.text),
      error: resp.error,
    };
    rows.push(row);
    structures.push({ cell, sample, ...structureMetrics(resp.text) });
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

  const rescueChars = rows.map((r) => r.VISIBLE_CHARS as number);
  const rescueTtft = rows.map((r) => r.TTFT_MS as number);
  const rescueLatency = rows.map((r) => r.TOTAL_LATENCY_MS as number);
  const rescueTokens = rows.map((r) => r.COMPLETION_TOKENS as number);
  const rescueCost = rows.map((r) => r.ACTUAL_COST_USD as number);

  save("LENGTH_RESCUE_RUNTIME.json", {
    OPUS_WORKSTREAM_REOPENED: false,
    TOTAL_NEW_DEEPSEEK_CALLS: rows.length,
    OTHER_MODEL_CALLS: 0,
    TRUE_NONTHINKING_CONFIG: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
    BASELINE_VISIBLE_CHARS: BASELINE_VISIBLE,
    RESCUE_VISIBLE_CHARS: rescueChars,
    BASELINE_VISIBLE_STATS: stats([...BASELINE_VISIBLE]),
    RESCUE_VISIBLE_STATS: stats(rescueChars),
    BASELINE_TTFT: BASELINE_TTFT,
    RESCUE_TTFT: rescueTtft,
    BASELINE_TTFT_STATS: stats([...BASELINE_TTFT]),
    RESCUE_TTFT_STATS: stats(rescueTtft),
    BASELINE_LATENCY: BASELINE_LATENCY,
    RESCUE_LATENCY: rescueLatency,
    BASELINE_LATENCY_STATS: stats([...BASELINE_LATENCY]),
    RESCUE_LATENCY_STATS: stats(rescueLatency),
    BASELINE_COMPLETION_TOKENS: BASELINE_COMPLETION,
    RESCUE_COMPLETION_TOKENS: rescueTokens,
    RESCUE_REASONING_STREAM: rows.map((r) => r.REASONING_STREAM_SEEN),
    RESCUE_REASONING_CHARS: rows.map((r) => r.REASONING_TEXT_CHARS),
    RESCUE_FINISH_REASON: rows.map((r) => r.FINISH_REASON),
    RESCUE_TERMINAL_USAGE: rows.map((r) => r.TERMINAL_USAGE_PRESENT),
    RESCUE_INCOMPLETE_STREAM: rows.map((r) => r.INCOMPLETE_STREAM),
    RESCUE_COST: rescueCost,
    rows,
    liveHeadSha: headSha(),
  });
  save("LENGTH_RESCUE_STRUCTURE.json", { note: "Objective structure counts only.", rows: structures });

  const candidates = [
    ...[1, 2, 3].map((n) => ({
      kind: "ds0813_true_nonthinking_baseline",
      path: `true-nonthinking/DS0813_GEMINI31_TRUE_NONTHINKING_${n}_RAW.txt`,
      text: readFileSync(
        join(DOCS, `true-nonthinking/DS0813_GEMINI31_TRUE_NONTHINKING_${n}_RAW.txt`),
        "utf8"
      ),
      runtime: {
        VISIBLE_CHARS: BASELINE_VISIBLE[n - 1],
        TTFT: BASELINE_TTFT[n - 1],
        TOTAL_LATENCY: BASELINE_LATENCY[n - 1],
        COMPLETION_TOKENS: BASELINE_COMPLETION[n - 1],
        REASONING: { STREAM_SEEN: false, TEXT_CHARS: 0 },
        COST: [0.001077, 0.001505, 0.001467][n - 1],
        FINISH_REASON: "stop",
        TERMINAL_USAGE: true,
        INCOMPLETE_STREAM: false,
      },
    })),
    ...rows.map((r, i) => ({
      kind: "ds0813_true_nonthinking_length_rescue",
      path: `length-rescue/DS0813_GEMINI31_LENGTH_RESCUE_${i + 1}_RAW.txt`,
      text: readFileSync(join(OUT, `DS0813_GEMINI31_LENGTH_RESCUE_${i + 1}_RAW.txt`), "utf8"),
      runtime: pickRuntime(r),
    })),
    ...MUSE_GEMINI.map((m) => ({
      kind: "existing_muse_positive",
      path: m.rel,
      text: readFileSync(join(DOCS, m.rel), "utf8"),
      runtime: {
        VISIBLE_CHARS: m.VISIBLE_CHARS,
        TTFT: m.TTFT,
        TOTAL_LATENCY: m.TOTAL_LATENCY,
        COMPLETION_TOKENS: m.COMPLETION_TOKENS,
        REASONING: {
          STREAM_SEEN: m.REASONING_STREAM_SEEN,
          TEXT_CHARS: m.REASONING_TEXT_CHARS,
        },
        COST: m.COST,
        FINISH_REASON: m.FINISH_REASON,
        TERMINAL_USAGE: m.TERMINAL_USAGE_PRESENT,
        INCOMPLETE_STREAM: m.INCOMPLETE_STREAM,
        note: "existing_reference_no_new_call",
      },
    })),
  ];
  const shuffled = shuffle(candidates);
  const ids = [
    "FINAL-G-A",
    "FINAL-G-B",
    "FINAL-G-C",
    "FINAL-G-D",
    "FINAL-G-E",
    "FINAL-G-F",
    "FINAL-G-G",
    "FINAL-G-H",
    "FINAL-G-I",
  ];
  save(
    "BLIND_GEMINI31_FINAL_9_QUALITY.md",
    [
      "# BLIND_GEMINI31_QUALITY",
      "",
      "Opaque candidates only. Do not infer model or condition from this file.",
      "",
      "## Source assistant RAW",
      "",
      geminiRaw,
      "",
      "## Current user",
      "",
      ADULT_HANDOFF_USER,
      "",
      ...shuffled.flatMap((c, i) => ["", `## SAMPLE ${ids[i]}`, "", c.text, ""]),
    ].join("\n")
  );
  const reveal: Record<string, unknown> = {};
  const runtimeBlind: Record<string, unknown> = {};
  shuffled.forEach((c, i) => {
    reveal[ids[i]] = { kind: c.kind, path: c.path };
    runtimeBlind[ids[i]] = c.runtime;
  });
  save("GEMINI31_DS0813_LENGTH_RESCUE_REVEAL_MAP.json", {
    note: "Do not consult before quality scoring.",
    mapping: reveal,
  });
  save("BLIND_GEMINI31_FINAL_9_RUNTIME.json", runtimeBlind);
  save("README_FOR_CHATGPT_MANUAL_REVIEW.md", [
    "# Gemini 3.1 → DS0813 length-rescue — ChatGPT manual review",
    "",
    "QUALITY_SCORING_BY_CURSOR: false",
    "QUALITY_REVIEW_STATUS: PENDING_CHATGPT_MANUAL_REVIEW",
    "OPUS_WORKSTREAM_REOPENED: false",
    "PRODUCTION_CHANGED: false",
    "MAIN_MERGED: false",
    "RAILWAY_DEPLOYED: false",
    "",
    "Cursor recorded RAW + numeric metrics only. Cursor does not score quality, length success/failure, progression, or declare a winner.",
    "",
    "## ChatGPT manual axes (do not score here)",
    "",
    "A. PURE PROSE QUALITY /5",
    "B. SOURCE STYLE FIDELITY /5",
    "C. CHARACTER IDENTITY /5",
    "D. SCENE CONTINUITY /5",
    "E. PARAGRAPH / RHYTHM /5",
    "F. ADULT PROGRESSION /5",
    "G. LATE-SCENE CHARACTER VOICE /5",
    "",
    "Defects to inspect in RAW: CONSENT_CHECKPOINT_STALL, USER_SEMANTIC_DIALOGUE_INVENTION, GENERIC_ADULT_VOICE, CHARACTER_VOICE_LOSS, FOREIGN_SCRIPT_CONTAMINATION, REFUSAL, FADE_EVADE, REPETITION, MALFORMED_OUTPUT.",
    "",
    "## Packets",
    "",
    "- `BLIND_GEMINI31_FINAL_9_QUALITY.md`",
    "- `BLIND_GEMINI31_FINAL_9_RUNTIME.json`",
    "- `GEMINI31_DS0813_LENGTH_RESCUE_REVEAL_MAP.json` (after scoring only)",
    "",
    "No Length V2 / V3 or extra prompt was added after these 3 calls.",
    "",
  ].join("\n"));

  const rawSha: Record<string, string> = {};
  for (let n = 1; n <= 3; n++) {
    const name = `DS0813_GEMINI31_LENGTH_RESCUE_${n}_RAW.txt`;
    rawSha[name] = sha256(readFileSync(join(OUT, name), "utf8"));
  }
  save("RAW_SHA256.json", rawSha);

  const manifestPath = join(DOCS, "MANIFEST.json");
  const prev = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
    : {};
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...prev,
        DEEPSEEK0813_GEMINI_LENGTH_RESCUE_CAPTURE_COMPLETE: true,
        DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: true,
        DEEPSEEK_LENGTH_PROMPT_PROVEN: true,
        DEEPSEEK_LENGTH_PROMPT_SHA: sha256(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
        NON_LENGTH_PROMPT_PARITY: true,
        TOTAL_NEW_DEEPSEEK_LENGTH_RESCUE_CALLS: rows.length,
        OPUS_WORKSTREAM_REOPENED: false,
        QUALITY_SCORING_BY_CURSOR: false,
        QUALITY_REVIEW_STATUS: "PENDING_CHATGPT_MANUAL_REVIEW",
        PRODUCTION_CHANGED: false,
        MAIN_MERGED: false,
        RAILWAY_DEPLOYED: false,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  assertFrozenReferencesUntouched();
}

void main();
