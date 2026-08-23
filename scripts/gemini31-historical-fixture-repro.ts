/**
 * Gemini 3.1 — Audit #255 historical fixture reproduction (current main).
 *
 * Parity (no provider):
 *   node --conditions=react-server --import tsx scripts/gemini31-historical-fixture-repro.ts --parity
 *
 * Live (exactly 4 Cheaper Inference calls; retry/continuation/recovery/regen = 0):
 *   node --conditions=react-server --import tsx scripts/gemini31-historical-fixture-repro.ts --live
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { resolveNarrativePov } from "../src/lib/narrativePov";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/gemini31-historical-fixture-repro"
);
const FIXTURE_PATH = path.join(
  OUT_DIR,
  "fixtures/merged_c18_persona61_bundle.json"
);

const REL_T1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";
const REL_T2 = "너는 이름이뭐야? 뭐하는 중이었어?";
const ACT_T1 =
  "*로비 천장에서 갑자기 비상 경보가 울리고 출입문 쪽에서 둔탁한 폭발음이 터진다. 렌은 소리가 난 쪽으로 고개를 돌린다.* 저거 뭐야?";
const ACT_T2 = "*렌은 태형의 소매를 잡고 곁에 붙는다.* 나도 같이 갈게.";

const HISTORICAL = {
  "REL-T1": { chars: 4659, input: 17514 },
  "REL-T2": { chars: 4254, input: 21726 },
  "ACT-T1": { chars: 4743, input: 17536 },
  "ACT-T2": { chars: 4327, input: 21862 },
} as const;

type CallId = keyof typeof HISTORICAL;

type Bundle = {
  character: Record<string, unknown>;
  persona: Record<string, unknown>;
  user: Record<string, unknown>;
  provenance?: Record<string, unknown>;
};

const PARITY = process.argv.includes("--parity");
const LIVE = process.argv.includes("--live");

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function charCount(text: string): number {
  return [...text].length;
}

function save(name: string, content: string | object, subdir = "") {
  const dir = subdir ? path.join(OUT_DIR, subdir) : OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function loadBundle(): Bundle {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Bundle;
}

function seedHistory(greeting: string): ChatMsg[] {
  return [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: greeting },
  ];
}

function assembleTurn(opts: {
  bundle: Bundle;
  history: ChatMsg[];
  currentUserMessage: string;
}) {
  const ch = opts.bundle.character;
  const persona = opts.bundle.persona;
  const personaName = String(persona.name ?? "렌");
  const personaGender =
    (persona.gender as "male" | "female" | "other") ?? "other";
  const greeting = String(ch.greeting ?? "");

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      setting_chunks_en: String(ch.setting_chunks_en ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
      creator_compiled_description_json: String(
        ch.creator_compiled_description_json ?? ""
      ),
      appearance_raw: String(ch.appearance_raw ?? ""),
      appearance_compiled: String(ch.appearance_compiled ?? ""),
      prompt_translation_hash: String(ch.prompt_translation_hash ?? ""),
    },
    personaName,
    String(opts.bundle.user.nickname ?? personaName)
  );

  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    personaGender,
    String(persona.description ?? "")
  );

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const shortHistory =
    opts.history.length > 0 ? opts.history : seedHistory(greeting);
  const completedTurns = Math.max(0, Math.floor((shortHistory.length - 2) / 2));

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(opts.bundle.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: shortHistory,
    currentUserMessage: opts.currentUserMessage,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(opts.bundle.user.id ?? 4),
    narrativePov,
    useEnglishCharacterPrompt: usedEnglish,
    userPersonaGender: personaGender,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: String(ch.name),
      personaName,
    },
  });

  const requestBody = {
    ...(assembled.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };

  const messages = (requestBody.messages ?? []) as Array<{
    role?: string;
    content?: unknown;
  }>;
  const flatMessages = messages.map((m) => ({
    role: m.role ?? "",
    content: flattenContent(m.content),
  }));
  const fullPayload = flatMessages.map((m) => m.content).join("\n\n");
  const lastUser = [...flatMessages].reverse().find((m) => m.role === "user");

  return {
    built,
    assembled,
    requestBody,
    chunks,
    usedEnglish,
    flatMessages,
    system: built.systemPrompt ?? "",
    currentUser: lastUser?.content ?? opts.currentUserMessage,
    fullPayload,
    completedTurns,
    narrativePov,
    greeting,
    estimatedInputTokens: estimateTokens(fullPayload),
    systemChars: charCount(built.systemPrompt ?? ""),
    messageCount: flatMessages.length,
  };
}

function countParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  return /["“”『』「」]/.test(p);
}

function maxConsecutive(flags: boolean[]): number {
  let max = 0;
  let cur = 0;
  for (const f of flags) {
    if (f) {
      cur += 1;
      if (cur > max) max = cur;
    } else cur = 0;
  }
  return max;
}

function structuralMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const paragraphs = countParagraphs(visible);
  const dialogueFlags = paragraphs.map(isDialogueParagraph);
  const narration = paragraphs.filter((_, i) => !dialogueFlags[i]);
  const dialogue = paragraphs.filter((_, i) => dialogueFlags[i]);
  return {
    VISIBLE_CHARS_INCL_SPACES: charCount(visible),
    VISIBLE_CHARS_EXCL_SPACES: charCount(visible.replace(/\s/g, "")),
    PARAGRAPH_COUNT: paragraphs.length,
    NARRATION_PARAGRAPH_COUNT: narration.length,
    DIALOGUE_PARAGRAPH_COUNT: dialogue.length,
    DIALOGUE_PARAGRAPH_RATIO:
      paragraphs.length > 0
        ? Math.round((dialogue.length / paragraphs.length) * 1000) / 1000
        : 0,
    MAX_CONSECUTIVE_DIALOGUE_PARAGRAPHS: maxConsecutive(dialogueFlags),
  };
}

function deterministicAlarms(text: string, userLine: string) {
  const alarms: Array<{ flag: string; passage: string }> = [];
  if (!text.trim()) {
    alarms.push({ flag: "EMPTY_OUTPUT", passage: "(empty)" });
    return alarms;
  }
  if (
    /\[SYSTEM|as an AI|language model|I am Gemini|safety policy/i.test(text)
  ) {
    alarms.push({
      flag: "META_LEAK",
      passage: text.slice(0, 280),
    });
  }
  if (/(.{24,})\1\1/.test(text)) {
    alarms.push({
      flag: "SEMANTIC_REPETITION_CANDIDATE",
      passage: text.slice(0, 280),
    });
  }
  for (const p of countParagraphs(text)) {
    if (/렌(?:은|이)\s*[「“"]/.test(p) && !userLine.includes(p.slice(0, 24))) {
      alarms.push({ flag: "NEW_USER_DIALOGUE_CANDIDATE", passage: p.slice(0, 280) });
    }
    if (
      /렌(?:은|이)\s*(?:말했다|대답했다|고개를|손을|달렸다|키스)/.test(p) &&
      !userLine.includes(p.slice(0, 24))
    ) {
      alarms.push({ flag: "NEW_USER_ACTION_CANDIDATE", passage: p.slice(0, 280) });
    }
  }
  return alarms;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : Math.round((a[mid - 1]! + a[mid]!) / 2);
}

function mean(nums: number[]): number {
  return nums.length
    ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
    : 0;
}

function sanitizeMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map((m, i) => ({
    index: i,
    role: m.role,
    chars: charCount(m.content),
    sha256: sha256(m.content),
    preview_head: m.content.slice(0, 120),
  }));
}

async function callOnce(requestBody: Record<string, unknown>) {
  const started = Date.now();
  let ttftMs: number | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) {
    return {
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null as string | null,
      resolvedModel: null as string | null,
      text: "",
      usageRaw: null as unknown,
      error: (await res.text()).slice(0, 4000),
    };
  }
  if (!res.body) {
    return {
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null,
      resolvedModel: null,
      text: "",
      usageRaw: null,
      error: "missing body",
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let resolvedModel: string | null = null;
  let usageRaw: unknown = null;
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
      if (!data || data === "[DONE]") continue;
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
        choice0 && typeof choice0 === "object"
          ? (choice0 as Record<string, unknown>)
          : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      const piece = typeof delta.content === "string" ? delta.content : "";
      if (piece) {
        if (ttftMs == null) ttftMs = Date.now() - started;
        text += piece;
      }
    }
  }
  return {
    httpStatus: res.status,
    latencyMs: Date.now() - started,
    ttftMs,
    finishReason,
    resolvedModel,
    text,
    usageRaw,
    error: null as string | null,
  };
}

function buildParityReport(bundle: Bundle) {
  const ch = bundle.character;
  const persona = bundle.persona;
  const greeting = String(ch.greeting ?? "");
  const relT1 = assembleTurn({
    bundle,
    history: seedHistory(greeting),
    currentUserMessage: REL_T1,
  });
  const relT2 = assembleTurn({
    bundle,
    history: [
      ...seedHistory(greeting),
      { role: "user", content: REL_T1 },
      { role: "assistant", content: "(T1 assistant placeholder for parity sizing)" },
    ],
    currentUserMessage: REL_T2,
  });

  const settingChunksRaw = String(ch.setting_chunks ?? "");
  let settingChunksContentChars = 0;
  try {
    const parsed = JSON.parse(settingChunksRaw) as Array<{ content?: string }>;
    settingChunksContentChars = parsed.reduce(
      (n, c) => n + charCount(String(c.content ?? "")),
      0
    );
  } catch {
    settingChunksContentChars = charCount(settingChunksRaw);
  }

  const historicalInputT1 = HISTORICAL["REL-T1"].input;
  const ratioT1 = relT1.estimatedInputTokens / historicalInputT1;

  const parityProven =
    Number(ch.id) === 18 &&
    String(persona.id) === "61" &&
    charCount(String(ch.system_prompt ?? "")) >= 1000 &&
    settingChunksContentChars >= 5000 &&
    charCount(greeting) >= 1000 &&
    relT1.systemChars >= 15000 &&
    relT1.estimatedInputTokens >= Math.round(historicalInputT1 * 0.65);

  return {
    FIXTURE_PARITY_PROVEN: parityProven,
    CHARACTER_18_SOURCE:
      "docs/audits/gemini31-historical-fixture-repro/fixtures/character-18-like.json (H5 production dump, blob ef61c1bb)",
    PERSONA_61_SOURCE:
      "docs/audits/gemini31-historical-fixture-repro/fixtures/c18_persona61_fixture.json persona block (id=61)",
    GREETING_SOURCE: "character-18-like.json greeting field (1318 chars)",
    SYSTEM_PROMPT_SOURCE: "character-18-like.json system_prompt (3643 chars)",
    WORLD_SOURCE: "character-18-like.json world (6344 chars)",
    SETTING_CHUNKS_SOURCE:
      "character-18-like.json setting_chunks JSON (21 chunks)",
    EXAMPLE_DIALOG_SOURCE: "character-18-like.json example_dialog (1101 chars)",
    PERSONA_DESCRIPTION_SOURCE:
      "c18_persona61_fixture.json persona.description (38 chars; G11-C5 remapped id=61)",
    CHARACTER_NAME: String(ch.name),
    CHARACTER_ID: Number(ch.id),
    PERSONA_ID: Number(persona.id),
    CHARACTER_ROW_EXACT: false,
    PERSONA_ROW_EXACT: false,
    field_classification: {
      character_row: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      persona_row: "RECONSTRUCTED",
      greeting: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      system_prompt: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      world: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      setting_chunks: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      example_dialog: "TRUSTWORTHY_SANITIZED_HISTORICAL_VALUE",
      persona_description: "RECONSTRUCTED",
    },
    SYSTEM_PROMPT_CHARS: charCount(String(ch.system_prompt ?? "")),
    WORLD_CHARS: charCount(String(ch.world ?? "")),
    SETTING_CHUNKS_CHARS: charCount(settingChunksRaw),
    SETTING_CHUNKS_CONTENT_CHARS: settingChunksContentChars,
    EXAMPLE_DIALOG_CHARS: charCount(String(ch.example_dialog ?? "")),
    PERSONA_CHARS: charCount(String(persona.description ?? "")),
    GREETING_CHARS: charCount(greeting),
    USED_ENGLISH_CHARACTER_PROMPT: relT1.usedEnglish,
    CHUNK_COUNT: relT1.chunks.length,
    CURRENT_ASSEMBLED_INPUT_TOKENS_REL_T1_EST: relT1.estimatedInputTokens,
    CURRENT_ASSEMBLED_INPUT_TOKENS_REL_T2_EST: relT2.estimatedInputTokens,
    CURRENT_ASSEMBLED_SYSTEM_CHARS_REL_T1: relT1.systemChars,
    CURRENT_ASSEMBLED_MESSAGE_COUNT_REL_T1: relT1.messageCount,
    HISTORICAL_INPUT_TOKENS_REL_T1: historicalInputT1,
    INPUT_TOKEN_RATIO_REL_T1: Math.round(ratioT1 * 1000) / 1000,
    HISTORICAL_INPUT_RANGE: "17514-21862",
    NOT_USED_SHORT_CARD:
      "c18_persona61_fixture.json character block (419-char reconstructed card rejected)",
  };
}

async function runParity() {
  const bundle = loadBundle();
  const report = buildParityReport(bundle);
  save("PARITY_REPORT.json", report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function runLive() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY missing");
  }
  const bundle = loadBundle();
  const parity = buildParityReport(bundle);
  if (!parity.FIXTURE_PARITY_PROVEN) {
    save("PARITY_REPORT.json", parity);
    throw new Error("FIXTURE_PARITY_PROVEN=false — refusing live calls");
  }

  const greeting = String(bundle.character.greeting ?? "");
  const results: Record<string, unknown> = {};
  let providerCalls = 0;

  async function runChain(id: CallId, t1User: string, t2User: string) {
    const t1Asm = assembleTurn({
      bundle,
      history: seedHistory(greeting),
      currentUserMessage: t1User,
    });
    save(`${id}-current-user.txt`, t1User, "requests");
    save(`${id}-system-sanitized.txt`, t1Asm.system, "requests");
    save(
      `${id}-messages-sanitized.json`,
      {
        model: t1Asm.requestBody.model,
        temperature: t1Asm.requestBody.temperature,
        top_p: t1Asm.requestBody.top_p ?? null,
        max_tokens: t1Asm.requestBody.max_tokens ?? null,
        reasoning_effort: t1Asm.requestBody.reasoning_effort ?? null,
        message_count: t1Asm.messageCount,
        system_chars: t1Asm.systemChars,
        estimated_input_tokens: t1Asm.estimatedInputTokens,
        messages: sanitizeMessages(t1Asm.flatMessages),
        request_sha256: sha256(JSON.stringify(t1Asm.requestBody)),
      },
      "requests"
    );

    providerCalls += 1;
    const t1Res = await callOnce(t1Asm.requestBody);
    if (t1Res.error) {
      throw new Error(`${id} provider error: ${t1Res.error}`);
    }
    const t1Text = t1Res.text;
    const t1RequestSha = sha256(JSON.stringify(t1Asm.requestBody));
    const t1RawSha = sha256(t1Text);
    save(`${id}.txt`, t1Text, "raw");
    const t1Usage = parseOpenRouterUsage(t1Res.usageRaw);
    const t1Thinking =
      t1Res.usageRaw &&
      typeof t1Res.usageRaw === "object" &&
      typeof (t1Res.usageRaw as Record<string, unknown>).thinking_tokens ===
        "number"
        ? Number((t1Res.usageRaw as Record<string, unknown>).thinking_tokens)
        : t1Usage.reasoningTokens;
    const t1Meta = {
      call: id,
      ...structuralMetrics(t1Text),
      INPUT_TOKENS: t1Usage.promptTokens,
      OUTPUT_TOKENS: t1Usage.completionTokens,
      THINKING_TOKENS: t1Thinking,
      CACHE_READ: t1Usage.cacheReadTokens,
      CACHE_WRITE: t1Usage.cacheWriteTokens,
      LATENCY_MS: t1Res.latencyMs,
      TTFT_MS: t1Res.ttftMs,
      FINISH_REASON: t1Res.finishReason,
      REQUEST_SHA: t1RequestSha,
      RAW_SHA: t1RawSha,
      RESOLVED_MODEL: t1Res.resolvedModel,
      historical_visible_chars: HISTORICAL[id].chars,
      historical_input_tokens: HISTORICAL[id].input,
      alarms: deterministicAlarms(t1Text, t1User),
      RETRY: 0,
      CONTINUATION: 0,
      RECOVERY_CALL: 0,
      REGEN: 0,
    };
    save(`${id}.json`, t1Meta, "meta");
    results[id] = t1Meta;

    const t2Id = id.replace("T1", "T2") as CallId;
    const t2Asm = assembleTurn({
      bundle,
      history: [
        ...seedHistory(greeting),
        { role: "user", content: t1User },
        { role: "assistant", content: t1Text },
      ],
      currentUserMessage: t2User,
    });
    save(`${t2Id}-current-user.txt`, t2User, "requests");
    save(`${t2Id}-system-sanitized.txt`, t2Asm.system, "requests");
    save(
      `${t2Id}-messages-sanitized.json`,
      {
        model: t2Asm.requestBody.model,
        temperature: t2Asm.requestBody.temperature,
        top_p: t2Asm.requestBody.top_p ?? null,
        max_tokens: t2Asm.requestBody.max_tokens ?? null,
        reasoning_effort: t2Asm.requestBody.reasoning_effort ?? null,
        message_count: t2Asm.messageCount,
        system_chars: t2Asm.systemChars,
        estimated_input_tokens: t2Asm.estimatedInputTokens,
        messages: sanitizeMessages(t2Asm.flatMessages),
        request_sha256: sha256(JSON.stringify(t2Asm.requestBody)),
      },
      "requests"
    );

    providerCalls += 1;
    const t2Res = await callOnce(t2Asm.requestBody);
    if (t2Res.error) {
      throw new Error(`${t2Id} provider error: ${t2Res.error}`);
    }
    const t2Text = t2Res.text;
    const t2RequestSha = sha256(JSON.stringify(t2Asm.requestBody));
    const t2RawSha = sha256(t2Text);
    save(`${t2Id}.txt`, t2Text, "raw");
    const t2Usage = parseOpenRouterUsage(t2Res.usageRaw);
    const t2Thinking =
      t2Res.usageRaw &&
      typeof t2Res.usageRaw === "object" &&
      typeof (t2Res.usageRaw as Record<string, unknown>).thinking_tokens ===
        "number"
        ? Number((t2Res.usageRaw as Record<string, unknown>).thinking_tokens)
        : t2Usage.reasoningTokens;
    const t2Meta = {
      call: t2Id,
      ...structuralMetrics(t2Text),
      INPUT_TOKENS: t2Usage.promptTokens,
      OUTPUT_TOKENS: t2Usage.completionTokens,
      THINKING_TOKENS: t2Thinking,
      CACHE_READ: t2Usage.cacheReadTokens,
      CACHE_WRITE: t2Usage.cacheWriteTokens,
      LATENCY_MS: t2Res.latencyMs,
      TTFT_MS: t2Res.ttftMs,
      FINISH_REASON: t2Res.finishReason,
      REQUEST_SHA: t2RequestSha,
      RAW_SHA: t2RawSha,
      RESOLVED_MODEL: t2Res.resolvedModel,
      historical_visible_chars: HISTORICAL[t2Id].chars,
      historical_input_tokens: HISTORICAL[t2Id].input,
      alarms: deterministicAlarms(t2Text, t2User),
      RETRY: 0,
      CONTINUATION: 0,
      RECOVERY_CALL: 0,
      REGEN: 0,
    };
    save(`${t2Id}.json`, t2Meta, "meta");
    results[t2Id] = t2Meta;
  }

  await runChain("REL-T1", REL_T1, REL_T2);
  await runChain("ACT-T1", ACT_T1, ACT_T2);

  const currentChars = (["REL-T1", "REL-T2", "ACT-T1", "ACT-T2"] as CallId[]).map(
    (k) => (results[k] as { VISIBLE_CHARS_INCL_SPACES: number }).VISIBLE_CHARS_INCL_SPACES
  );

  const summary = {
    FIXTURE_PARITY_PROVEN: true,
    TOTAL_PROVIDER_CALLS: providerCalls,
    RETRIES: 0,
    CONTINUATIONS: 0,
    RECOVERY_CALLS: 0,
    CURRENT_AVG_CHARS: mean(currentChars),
    CURRENT_MEDIAN_CHARS: median(currentChars),
    historical_vs_current: Object.fromEntries(
      (Object.keys(HISTORICAL) as CallId[]).map((k) => [
        k,
        {
          historical: HISTORICAL[k].chars,
          current: (results[k] as { VISIBLE_CHARS_INCL_SPACES: number })
            .VISIBLE_CHARS_INCL_SPACES,
        },
      ])
    ),
    CURSOR_QUALITY_SCORE_ASSIGNED: false,
    CURSOR_MODEL_VERDICT_ASSIGNED: false,
    PRODUCTION_PROMPT_CHANGED: false,
    HUMAN_CHATGPT_REVIEW_REQUIRED: true,
  };
  save("LIVE_SUMMARY.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  if (LIVE) {
    await runLive();
    return;
  }
  await runParity();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
