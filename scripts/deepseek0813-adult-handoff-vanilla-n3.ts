/**
 * DeepSeek V4 Pro 0813 adult-handoff VANILLA n=3 per source.
 * Audit only. No quality scores. No Muse/Qwen/source/GLM calls.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-adult-handoff-vanilla-n3.ts --phase=assemble
 *   node --conditions=react-server --import tsx \
 *     scripts/deepseek0813-adult-handoff-vanilla-n3.ts --phase=live
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
import { estimateTokens } from "../src/lib/tokenEstimate";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/deepseek0813-adult-handoff-final";
const ARTIFACT = "/opt/cursor/artifacts/deepseek0813-adult-handoff-final";
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const PRODUCTION_TIMEOUT_MS = 240_000;
const OPUS_SOURCE_SHA =
  "f49f3f9d489ba75d1485d2840209fbc2c5c87e5d9c6cd208f235a074ed5cf818";
const GEMINI31_SOURCE_SHA =
  "e9c618f9c8b5856abf8f392713327807d728091ea01dfb5b6e3eb714123ba64e";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

const MUSE_OPUS_POSITIVE = [
  "existing-muse-positive/MUSE12_POSITIVE_OPUS.txt",
  "existing-muse-positive/MUSE12_FINAL_OPUS_POSITIVE_2.txt",
  "existing-muse-positive/MUSE12_FINAL_OPUS_POSITIVE_3.txt",
] as const;
const MUSE_GEMINI_POSITIVE = [
  "existing-muse-positive/MUSE12_POSITIVE_GEMINI.txt",
  "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_2.txt",
  "existing-muse-positive/MUSE12_FINAL_GEMINI_POSITIVE_3.txt",
] as const;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
type SourceId = "opus" | "gemini31";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
  for (const root of [DOCS, ARTIFACT]) {
    try {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, "utf8");
    } catch (err) {
      if (root === DOCS) throw err;
      console.warn("[ds0813-vanilla] artifact write skipped", rel, err);
    }
  }
}

function mustRead(rel: string): string {
  const path = join(DOCS, rel);
  if (!existsSync(path)) throw new Error(`MISSING_FILE:${path}`);
  return readFileSync(path, "utf8");
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
  const dialogueChars = dialogue.map((p) => [...p].length);
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
    AVG_DIALOGUE_BLOCK_CHARS: dialogueChars.length ? mean(dialogueChars) : null,
    ADJACENT_SAME_SPEAKER_DIALOGUE_BLOCKS: adjacentSameSpeaker,
    SENTENCE_COUNT: sentences,
    AVG_SENTENCES_PER_PARAGRAPH: paragraphs.length ? sentences / paragraphs.length : null,
  };
}

function mechanicalMarkers(text: string) {
  return {
    EMPTY_OUTPUT: text.trim().length === 0,
    FOREIGN_SCRIPT_HITS: (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length,
    REFUSAL_MARKER: /I (can'?t|cannot|won't)|요청을 수행할 수 없|성인 콘텐츠를 생성할 수 없/i.test(
      text
    ),
    META_LEAK_MARKER: /SceneContinuityPacket|STATUS_VALUES|handoff|system prompt/i.test(text),
    REPETITION_LOOP_DETECTED: /(.{40,})\1\1/.test(text),
  };
}

async function streamChat(body: Record<string, unknown>) {
  const requestStart = Date.now();
  const requestStartIso = new Date(requestStart).toISOString();
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
      reasoningText: "",
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
      error: err,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoningText = "";
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
      if (typeof ev.model === "string") resolvedModel = ev.model;
      if (ev.usage) usageRaw = ev.usage;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      const reasonPiece =
        typeof delta.reasoning === "string"
          ? delta.reasoning
          : typeof delta.reasoning_content === "string"
            ? delta.reasoning_content
            : "";
      if (reasonPiece) reasoningText += reasonPiece;
      const piece = typeof delta.content === "string" ? delta.content : "";
      if (piece) {
        if (firstVisibleMs == null) {
          firstVisibleMs = Date.now() - requestStart;
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
    reasoningText,
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
    error: null as unknown,
  };
}

function assembleVanilla(opts: {
  sourceId: SourceId;
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
  const handoffOpts = {
    sourceModelId: opts.sourceModelId,
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
  const requestBody = assembled.requestBody as Record<string, unknown>;
  const adaptedCheck = adaptCheaperInferenceChatBody({ ...requestBody });
  if (JSON.stringify(adaptedCheck.thinking) !== JSON.stringify(requestBody.thinking)) {
    throw new Error("ADAPTER_THINKING_MISMATCH");
  }
  if (adaptedCheck.model !== requestBody.model) {
    throw new Error(`ADAPTER_MODEL_MISMATCH:${String(adaptedCheck.model)}`);
  }
  const messages = (requestBody.messages ?? []) as Array<{
    role: string;
    content: string | Array<{ type?: string; text?: string }>;
  }>;
  const flat = messages
    .map((m) => flattenOpenRouterMessageContent(m.content as string | Array<{ type: "text"; text: string }>))
    .join("\n");
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastUser = lastUserMsg
    ? flattenOpenRouterMessageContent(
        lastUserMsg.content as string | Array<{ type: "text"; text: string }>
      )
    : "";
  const forbidden = {
    musePositiveOpus: flat.includes("[MUSE SOURCE STYLE CONTINUITY — OPUS 5]"),
    musePositiveGemini: flat.includes("[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]"),
    opusQwenFragment: flat.includes(OPUS_QWEN_FRAGMENT_SENTENCE),
    geminiQwenBlock: flat.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK),
    deepseekLengthSingleCall: flat.includes(DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
    deepseekShortHistoryExtra: flat.includes(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA),
  };
  return {
    requestBody,
    adaptedCheck,
    messages,
    systemPrompt,
    lastUser,
    continuityPacket,
    extracted,
    generation: {
      temperature: requestBody.temperature ?? null,
      top_p: requestBody.top_p ?? null,
      max_tokens: requestBody.max_tokens ?? null,
      thinking: requestBody.thinking ?? null,
      reasoning_effort: requestBody.reasoning_effort ?? null,
      stream: requestBody.stream ?? null,
      model: requestBody.model ?? null,
    },
    shas: {
      system: sha256(systemPrompt),
      lastUser: sha256(lastUser),
      fullMessages: sha256(flat),
      requestBodyRelevant: sha256(
        JSON.stringify({
          model: requestBody.model,
          temperature: requestBody.temperature,
          top_p: requestBody.top_p,
          max_tokens: requestBody.max_tokens,
          thinking: requestBody.thinking,
          reasoning_effort: requestBody.reasoning_effort,
          messages,
        })
      ),
    },
    flags: {
      styleReminderPresent: lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY),
      handoffInstructionPresent: systemPrompt.includes(
        "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다."
      ),
      forbidden,
      forbiddenAny: Object.values(forbidden).some(Boolean),
    },
    promptSize: {
      systemChars: [...systemPrompt].length,
      lastUserChars: [...lastUser].length,
      assembledChars: [...flat].length,
      estimatedInputTokens: estimateTokens(flat),
    },
    adaptationKeyDiff: assembled.adaptationKeyDiff,
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
    const buf = randomBytes(4);
    const j = buf.readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  const phase = parsePhase();
  const fixtures = JSON.parse(mustRead("existing-muse-positive/PRODUCTION_FIXTURES.json")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
  };
  const opusRaw = mustRead("SOURCE_OPUS.txt");
  const geminiRaw = mustRead("SOURCE_GEMINI31.txt");
  if (sha256(opusRaw) !== OPUS_SOURCE_SHA) {
    throw new Error(`OPUS_SOURCE_SHA_MISMATCH actual=${sha256(opusRaw)}`);
  }
  if (sha256(geminiRaw) !== GEMINI31_SOURCE_SHA) {
    throw new Error(`GEMINI31_SOURCE_SHA_MISMATCH actual=${sha256(geminiRaw)}`);
  }

  const sources: Array<{
    id: SourceId;
    sourceModelId: string;
    raw: string;
    sha: string;
  }> = [
    { id: "opus", sourceModelId: "claude-opus-5", raw: opusRaw, sha: OPUS_SOURCE_SHA },
    {
      id: "gemini31",
      sourceModelId: "gemini-3.1-pro-preview",
      raw: geminiRaw,
      sha: GEMINI31_SOURCE_SHA,
    },
  ];

  const assemblies = sources.map((source) => {
    const assembled = assembleVanilla({
      sourceId: source.id,
      sourceModelId: source.sourceModelId,
      sourceRaw: source.raw,
      character: fixtures.character,
      persona: fixtures.persona,
    });
    if (assembled.flags.forbiddenAny) {
      throw new Error(`FORBIDDEN_PROMPT_PRESENT:${source.id}:${JSON.stringify(assembled.flags.forbidden)}`);
    }
    if (assembled.generation.model !== MODEL) {
      throw new Error(`REQUEST_MODEL_NOT_0813:${String(assembled.generation.model)}`);
    }
    if (JSON.stringify(assembled.generation.thinking) !== JSON.stringify({ type: "disabled" })) {
      throw new Error(`THINKING_NOT_DISABLED:${JSON.stringify(assembled.generation.thinking)}`);
    }
    save(`assembled/${source.id}-vanilla-system.txt`, assembled.systemPrompt);
    save(`assembled/${source.id}-vanilla-last-user.txt`, assembled.lastUser);
    save(`assembled/${source.id}-vanilla-request-meta.json`, {
      source: source.id,
      generation: assembled.generation,
      shas: assembled.shas,
      flags: assembled.flags,
      promptSize: assembled.promptSize,
      adaptationKeyDiff: assembled.adaptationKeyDiff,
      continuityPacket: assembled.continuityPacket,
    });
    return { source, assembled };
  });

  save("PROMPT_PARITY.json", {
    computed: true,
    note: "Vanilla only. No DeepSeek positive. Same fixture except source RAW / continuity packet.",
    sources: assemblies.map((row) => ({
      source: row.source.id,
      sourceSha: row.source.sha,
      ...row.assembled.shas,
      generation: row.assembled.generation,
      flags: row.assembled.flags,
    })),
  });

  console.log(
    JSON.stringify(
      {
        phase: "assemble",
        opusSha: OPUS_SOURCE_SHA,
        geminiSha: GEMINI31_SOURCE_SHA,
        model: assemblies[0]?.assembled.generation.model,
        thinking: assemblies[0]?.assembled.generation.thinking,
        forbidden: assemblies.map((r) => r.assembled.flags.forbidden),
        styleReminder: assemblies.map((r) => r.assembled.flags.styleReminderPresent),
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
          ? `DS0813_OPUS_VANILLA_${sample}`
          : `DS0813_GEMINI31_VANILLA_${sample}`;
      let resp: Awaited<ReturnType<typeof streamChat>>;
      try {
        resp = await streamChat(assembled.requestBody);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resp = {
          httpStatus: 0,
          text: "",
          reasoningText: "",
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
          error: msg,
        };
      }
      const usage = parseOpenRouterUsage(resp.usageRaw);
      const usageObj =
        resp.usageRaw && typeof resp.usageRaw === "object"
          ? (resp.usageRaw as Record<string, unknown>)
          : {};
      const costDetails =
        usageObj.cost_details && typeof usageObj.cost_details === "object"
          ? (usageObj.cost_details as Record<string, unknown>)
          : {};
      const visibleChars = [...resp.text].length;
      const completionTokens = usage.completionTokens || 0;
      const actualCost =
        typeof usageObj.cost === "number" ? usageObj.cost : usage.upstreamCostUsd ?? null;
      const row = {
        cell,
        source: source.id,
        condition: "VANILLA",
        sample,
        REQUESTED_MODEL: MODEL,
        RESOLVED_MODEL: resp.resolvedModel,
        RESPONSE_MODEL: resp.resolvedModel,
        HTTP_STATUS: resp.httpStatus,
        REQUEST_START_TIMESTAMP: resp.requestStartIso,
        FIRST_VISIBLE_TOKEN_TIMESTAMP: resp.firstVisibleIso,
        STREAM_END_TIMESTAMP: resp.streamEndIso,
        TTFT_MS: resp.ttftMs,
        TOTAL_LATENCY_MS: resp.latencyMs,
        VISIBLE_CHARS: visibleChars,
        VISIBLE_KOREAN_CHARS: countKoreanChars(resp.text),
        INPUT_TOKENS: usage.promptTokens || null,
        COMPLETION_TOKENS: usage.completionTokens || null,
        REASONING_TOKENS: usage.reasoningTokens || null,
        CACHE_READ_TOKENS: usage.cacheReadTokens || null,
        CACHE_WRITE_TOKENS: usage.cacheWriteTokens || null,
        ACTUAL_COST_USD: actualCost,
        UPSTREAM_INFERENCE_COST_USD:
          typeof costDetails.upstream_inference_cost === "number"
            ? costDetails.upstream_inference_cost
            : null,
        COST_PER_1000_VISIBLE_CHARS:
          visibleChars && actualCost != null ? (actualCost / visibleChars) * 1000 : null,
        CHARS_PER_COMPLETION_TOKEN:
          completionTokens > 0 ? visibleChars / completionTokens : null,
        COMPLETION_TOKENS_PER_1000_VISIBLE_CHARS:
          visibleChars > 0 && completionTokens > 0
            ? (completionTokens / visibleChars) * 1000
            : null,
        FINISH_REASON: resp.finishReason,
        TERMINAL_USAGE_PRESENT: resp.usageRaw != null,
        STREAM_DONE_PRESENT: resp.streamDone,
        INCOMPLETE_STREAM: resp.incompleteStream,
        REASONING_STREAM_SEEN: resp.reasoningText.length > 0,
        REASONING_TEXT_CHARS: [...resp.reasoningText].length,
        REASONING_TOKENS_REPORTED: usage.reasoningTokens || 0,
        FALLBACK_COUNT: 0,
        RETRY_COUNT: 0,
        CONTINUATION_COUNT: 0,
        RECOVERY_COUNT: 0,
        generation: assembled.generation,
        sourceSha: source.sha,
        outputSha: sha256(resp.text),
        structure: structureMetrics(resp.text),
        mechanical: mechanicalMarkers(resp.text),
        usageRaw: resp.usageRaw,
        error: resp.error,
      };
      rows.push(row);
      save(`${cell}_RAW.txt`, resp.text);
      if (resp.reasoningText) save(`${cell}_REASONING.txt`, resp.reasoningText);
      save(`calls/${cell}.json`, row);
      console.log(
        JSON.stringify({
          cell,
          http: row.HTTP_STATUS,
          finish: row.FINISH_REASON,
          chars: row.VISIBLE_CHARS,
          ttft: row.TTFT_MS,
          latency: row.TOTAL_LATENCY_MS,
          outTok: row.COMPLETION_TOKENS,
          cost: row.ACTUAL_COST_USD,
          usage: row.TERMINAL_USAGE_PRESENT,
        })
      );
    }
  }

  const bySource = (id: SourceId) => rows.filter((r) => r.source === id);
  const num = (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "number" ? (row[key] as number) : null;
  const nums = (id: SourceId, key: string) =>
    bySource(id)
      .map((r) => num(r, key))
      .filter((n): n is number => n != null);

  const runtime = {
    headSha: headSha(),
    model: MODEL,
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    timeoutMs: PRODUCTION_TIMEOUT_MS,
    DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: false,
    DEEPSEEK_POSITIVE_PROMPT_NOT_PROVABLE: true,
    rows,
    OPUS_DS0813: {
      HTTP: bySource("opus").map((r) => r.HTTP_STATUS),
      FINISH: bySource("opus").map((r) => r.FINISH_REASON),
      VISIBLE_CHARS: stats(nums("opus", "VISIBLE_CHARS")),
      TTFT: stats(nums("opus", "TTFT_MS")),
      LATENCY: stats(nums("opus", "TOTAL_LATENCY_MS")),
      COMPLETION_TOKENS: stats(nums("opus", "COMPLETION_TOKENS")),
      REASONING: bySource("opus").map((r) => ({
        seen: r.REASONING_STREAM_SEEN,
        textChars: r.REASONING_TEXT_CHARS,
        tokens: r.REASONING_TOKENS_REPORTED,
      })),
      COST: stats(nums("opus", "ACTUAL_COST_USD")),
    },
    GEMINI31_DS0813: {
      HTTP: bySource("gemini31").map((r) => r.HTTP_STATUS),
      FINISH: bySource("gemini31").map((r) => r.FINISH_REASON),
      VISIBLE_CHARS: stats(nums("gemini31", "VISIBLE_CHARS")),
      TTFT: stats(nums("gemini31", "TTFT_MS")),
      LATENCY: stats(nums("gemini31", "TOTAL_LATENCY_MS")),
      COMPLETION_TOKENS: stats(nums("gemini31", "COMPLETION_TOKENS")),
      REASONING: bySource("gemini31").map((r) => ({
        seen: r.REASONING_STREAM_SEEN,
        textChars: r.REASONING_TEXT_CHARS,
        tokens: r.REASONING_TOKENS_REPORTED,
      })),
      COST: stats(nums("gemini31", "ACTUAL_COST_USD")),
    },
    TERMINAL_USAGE_PRESENT: rows.map((r) => ({
      cell: r.cell,
      present: r.TERMINAL_USAGE_PRESENT,
    })),
    INCOMPLETE_STREAMS: rows.map((r) => ({ cell: r.cell, incomplete: r.INCOMPLETE_STREAM })),
  };
  save("RUNTIME_METRICS.json", runtime);
  save("STRUCTURE_METRICS.json", {
    note: "Objective structure counts only.",
    rows: rows.map((r) => ({ cell: r.cell, source: r.source, sample: r.sample, ...((r.structure as object) ?? {}) })),
  });

  const opusCandidates = [
    ...[1, 2, 3].map((n) => ({
      kind: "ds0813_vanilla",
      path: `DS0813_OPUS_VANILLA_${n}_RAW.txt`,
      text: readFileSync(join(DOCS, `DS0813_OPUS_VANILLA_${n}_RAW.txt`), "utf8"),
      runtimeCell: `DS0813_OPUS_VANILLA_${n}`,
    })),
    ...MUSE_OPUS_POSITIVE.map((rel, i) => ({
      kind: "muse_positive_existing",
      path: rel,
      text: mustRead(rel),
      runtimeCell: `MUSE_OPUS_POSITIVE_${i + 1}`,
    })),
  ];
  const geminiCandidates = [
    ...[1, 2, 3].map((n) => ({
      kind: "ds0813_vanilla",
      path: `DS0813_GEMINI31_VANILLA_${n}_RAW.txt`,
      text: readFileSync(join(DOCS, `DS0813_GEMINI31_VANILLA_${n}_RAW.txt`), "utf8"),
      runtimeCell: `DS0813_GEMINI31_VANILLA_${n}`,
    })),
    ...MUSE_GEMINI_POSITIVE.map((rel, i) => ({
      kind: "muse_positive_existing",
      path: rel,
      text: mustRead(rel),
      runtimeCell: `MUSE_GEMINI_POSITIVE_${i + 1}`,
    })),
  ];

  const opusShuffled = shuffle(opusCandidates);
  const geminiShuffled = shuffle(geminiCandidates);
  const opusIds = ["O-A", "O-B", "O-C", "O-D", "O-E", "O-F"];
  const geminiIds = ["G-A", "G-B", "G-C", "G-D", "G-E", "G-F"];

  function qualityPacket(
    title: string,
    sourceRaw: string,
    pairs: Array<{ id: string; text: string }>
  ) {
    return [
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
  }

  save(
    "BLIND_OPUS_QUALITY.md",
    qualityPacket(
      "BLIND_OPUS_QUALITY",
      opusRaw,
      opusShuffled.map((c, i) => ({ id: opusIds[i], text: c.text }))
    )
  );
  save(
    "BLIND_GEMINI31_QUALITY.md",
    qualityPacket(
      "BLIND_GEMINI31_QUALITY",
      geminiRaw,
      geminiShuffled.map((c, i) => ({ id: geminiIds[i], text: c.text }))
    )
  );

  const reveal: Record<string, unknown> = {};
  const runtimeBlind: Record<string, unknown> = {};
  opusShuffled.forEach((c, i) => {
    reveal[opusIds[i]] = { kind: c.kind, path: c.path, runtimeCell: c.runtimeCell };
    const row = rows.find((r) => r.cell === c.runtimeCell);
    runtimeBlind[opusIds[i]] = row
      ? pickRuntime(row)
      : { note: "existing_muse_positive_no_new_runtime" };
  });
  geminiShuffled.forEach((c, i) => {
    reveal[geminiIds[i]] = { kind: c.kind, path: c.path, runtimeCell: c.runtimeCell };
    const row = rows.find((r) => r.cell === c.runtimeCell);
    runtimeBlind[geminiIds[i]] = row
      ? pickRuntime(row)
      : { note: "existing_muse_positive_no_new_runtime" };
  });
  save("DEEPSEEK0813_VS_MUSE_REVEAL_MAP.json", {
    note: "Do not consult before quality scoring.",
    mapping: reveal,
  });
  save("BLIND_RUNTIME.json", runtimeBlind);

  const prev = existsSync(join(DOCS, "MANIFEST.json"))
    ? (JSON.parse(readFileSync(join(DOCS, "MANIFEST.json"), "utf8")) as Record<string, unknown>)
    : {};
  save("MANIFEST.json", {
    ...prev,
    AUDIT_LIVE_CAPTURE_COMPLETE: true,
    CURRENT_MAIN_HEAD: "7ee026a3222bba1a03a7e5bd096e71b67f06546b",
    DEEPSEEK_MODEL: MODEL,
    DEEPSEEK_PROVIDER: "cheaperinference",
    DEEPSEEK_THINKING_CONFIG: { type: "disabled" },
    PRODUCTION_ASSEMBLY_REUSED: true,
    TOTAL_NEW_DEEPSEEK_CALLS: rows.length,
    OTHER_MODEL_CALLS: 0,
    DEEPSEEK_POSITIVE_PROMPT_NOT_PROVABLE: true,
    DEEPSEEK0813_LENGTH_RESCUE_TEST_RUN: false,
    QUALITY_SCORING_BY_CURSOR: false,
    QUALITY_REVIEW_STATUS: "PENDING_CHATGPT_MANUAL_REVIEW",
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    BLIND_OPUS_QUALITY_PACKET: "docs/audits/deepseek0813-adult-handoff-final/BLIND_OPUS_QUALITY.md",
    BLIND_GEMINI31_QUALITY_PACKET:
      "docs/audits/deepseek0813-adult-handoff-final/BLIND_GEMINI31_QUALITY.md",
    BLIND_RUNTIME_PACKET: "docs/audits/deepseek0813-adult-handoff-final/BLIND_RUNTIME.json",
    REVEAL_MAP_CREATED: true,
    RAW_SHA_COMPLETE: rows.every((r) => typeof r.outputSha === "string"),
    liveHeadSha: headSha(),
  });
}

function pickRuntime(row: Record<string, unknown>) {
  return {
    TTFT: row.TTFT_MS,
    TOTAL_LATENCY: row.TOTAL_LATENCY_MS,
    VISIBLE_CHARS: row.VISIBLE_CHARS,
    INPUT_TOKENS: row.INPUT_TOKENS,
    COMPLETION_TOKENS: row.COMPLETION_TOKENS,
    REASONING_TOKENS: row.REASONING_TOKENS,
    COST: row.ACTUAL_COST_USD,
    FINISH_REASON: row.FINISH_REASON,
    TERMINAL_USAGE_PRESENT: row.TERMINAL_USAGE_PRESENT,
    INCOMPLETE_STREAM: row.INCOMPLETE_STREAM,
  };
}

void main();
