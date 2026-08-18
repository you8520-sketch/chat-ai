/**
 * Flood F1 local preflight — snapshot-backed production assembly.
 * Gemini 3.7 Flash source voice (n=3) then DeepSeek 0813 Vanilla TRUE-OFF (n=2).
 *
 *   node --conditions=react-server --import tsx scripts/deepseek-flood-local-preflight-f1.ts
 *
 * Does not commit character / Persona / Speech Lock / world RAW.
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
import type { ChatMsg } from "../src/lib/ai";
import {
  loadCharacterChunksForPromptReadOnly,
  loadCharacterChunksReadOnly,
  mergeEnglishLayerWithKoreanSpeech,
  type CharacterSettingRow,
} from "../src/lib/characterChunks";
import { parseGenresJson } from "../src/lib/characterGenres";
import { resolveCharacterGender } from "../src/lib/characterGender";
import { resolveChatRuntimeMode } from "../src/lib/chatRuntimeMode";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "../src/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { resolveNarrativePov } from "../src/lib/narrativePov";
import { resolveExampleDialogForPrompt } from "../src/lib/narrationFewShotTemplates";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { toPublicPersonaDescription } from "../src/lib/personaSecretLegacyMarkers";
import { formatPublicPersonaForPrompt } from "../src/lib/personaSecretPrompt";
import { hashKoreanChunks, loadEnglishChunks } from "../src/lib/promptTranslation";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { parseStoredSpeechProfile } from "../src/lib/speechLock";
import { resolveUserImpersonationAllowance } from "../src/lib/userImpersonationPolicy";
import { replaceUserPlaceholderInChunks } from "../src/lib/userPlaceholder";
import { deserializeCharacterChunks } from "../src/utils/characterParser";
import { buildContext } from "../src/services/contextBuilder";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const SNAPSHOT_ID = "handoff-17-1-2026-08-18T11-38-17-786Z";
const EXPECTED = {
  CHARACTER_SHA: "f1f941ab3964d8561484553ee0ebfd2ccd121cea7b367690f3d718942fe393d2",
  PERSONA_SHA: "019047714e494c1b1f874b8bca0fc463522a4ff83d76d6b482f7caddbee7876c",
  SPEECH_LOCK_SHA: "a02b5b82500eba1c5d45fa2d877d31fd4ce23782c5bf8fdfcdcc19ece2188d21",
  WORLD_CANON_SHA: "de6c8097f83027ec0d1b0d80ced2b161b02b1cf551fb5864c0b6b59b3785ae98",
} as const;

const SOURCE_MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const TARGET_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const DOCS = path.join(process.cwd(), "docs/audits/deepseek-flood-local-preflight-f1");
const ARTIFACTS = path.join("/opt/cursor/artifacts", "deepseek-flood-local-preflight-f1");

const SYNTHETIC_USERS = {
  turn1: "여기… 평가 때문에 온 거야? 나는 렌이라고 해.",
  turn2: "*주변을 한번 둘러본다.* 사람이 많아서 그런가, 표정이 좀 굳어 있는데.",
  turn3: "*한 걸음 다가선다.* 잠깐, 그렇게만 서 있지 말고. 나 좀 보고 가.",
  adult:
    "*그의 옷깃을 잡고 한 뼘 더 붙인다.* 지금 이 거리에서 입 맞춰도 되지? 더 하고 싶어.",
} as const;

type SnapshotFile = {
  SNAPSHOT_ID: string;
  PRODUCTION_RECORD_PROVEN: boolean;
  FLOOD_PRODUCTION_RECORD_PROVEN: boolean;
  ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: boolean;
  database_source: string;
  CHARACTER_SHA: string;
  PERSONA_SHA: string;
  SPEECH_LOCK_SHA: string;
  WORLD_CANON_SHA: string;
  character: {
    id: number;
    name: string;
    official: number;
    creator_id: number | null;
    nsfw: number;
    visibility: string;
    moderation_status: string;
    content_kind: string;
    gender: string;
    fields: Record<string, string>;
    hashes: Record<string, { sha256: string; chars: number }>;
  };
  persona: {
    id: number;
    user_id: number;
    owner_email: string;
    name: string;
    gender: string;
    fields: Record<string, string>;
    formatted_public_prompt: string | null;
  };
  speech_lock: {
    fields: Record<string, string>;
    hashes: Record<string, { sha256: string; chars: number }>;
  };
  world_canon: {
    fields: Record<string, string>;
  };
  prompt_relevant_config: {
    greeting_chars: number;
    example_dialog_prompt_chars: number;
    used_english_character_prompt: boolean;
    chunk_count: number;
  };
};

type ReasoningAcc = {
  reasoning_stream_events: number;
  reasoning_chars: number;
  reasoning_delta_keys: string[];
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function save(dir: string, name: string, content: string | object): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function resolveSnapshotPath(): string {
  const candidates = [
    path.join("/data/handoff-audit-exports", SNAPSHOT_ID, "SNAPSHOT.json"),
    path.join(process.cwd(), "data/handoff-audit-exports", SNAPSHOT_ID, "SNAPSHOT.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`private snapshot missing: ${SNAPSHOT_ID}`);
}

function flattenMessageContent(content: unknown): string {
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

function hashMessages(messages: Array<{ role: string; content: unknown }>): string {
  return sha256(
    messages
      .map((m) => `${m.role}\u0000${flattenMessageContent(m.content)}`)
      .join("\u0001")
  );
}

function lateQuarter(text: string): string {
  const chars = [...text];
  if (chars.length === 0) return "";
  const n = Math.max(1, Math.ceil(chars.length * 0.25));
  return chars.slice(-n).join("");
}

function collectReasoningPiece(value: unknown, acc: ReasoningAcc, key: string): void {
  if (typeof value === "string" && value.length > 0) {
    acc.reasoning_stream_events += 1;
    acc.reasoning_chars += [...value].length;
    if (!acc.reasoning_delta_keys.includes(key)) acc.reasoning_delta_keys.push(key);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.length > 0) {
        acc.reasoning_stream_events += 1;
        acc.reasoning_chars += [...item].length;
        if (!acc.reasoning_delta_keys.includes(key)) acc.reasoning_delta_keys.push(key);
        continue;
      }
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const text = rec.text ?? rec.content ?? rec.reasoning;
        if (typeof text === "string" && text.length > 0) {
          acc.reasoning_stream_events += 1;
          acc.reasoning_chars += [...text].length;
          if (!acc.reasoning_delta_keys.includes(key)) acc.reasoning_delta_keys.push(key);
        }
      }
    }
  }
}

function consumeReasoningFromDelta(delta: Record<string, unknown>, acc: ReasoningAcc): void {
  for (const key of [
    "reasoning",
    "reasoning_content",
    "reasoning_text",
    "thinking",
    "thinking_content",
    "reasoning_details",
  ]) {
    if (key in delta) collectReasoningPiece(delta[key], acc, key);
  }
}

function requestBodyKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body).sort();
}

function applyTrueOff(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const next = { ...body, model };
  delete next.enable_thinking;
  delete next.reasoning;
  delete next.include_reasoning;
  next.thinking = { type: "disabled" };
  next.reasoning_effort = "none";
  return next;
}

function loadSnapshot(): SnapshotFile {
  const snapshot = JSON.parse(fs.readFileSync(resolveSnapshotPath(), "utf8")) as SnapshotFile;
  if (snapshot.SNAPSHOT_ID !== SNAPSHOT_ID) {
    throw new Error(`SNAPSHOT_ID mismatch: ${snapshot.SNAPSHOT_ID}`);
  }
  const characterSha = sha256(JSON.stringify(snapshot.character.fields));
  const personaSha = sha256(JSON.stringify(snapshot.persona.fields));
  const speechSha = sha256(JSON.stringify(snapshot.speech_lock.fields));
  const worldSha = sha256(JSON.stringify(snapshot.world_canon.fields));
  if (characterSha !== EXPECTED.CHARACTER_SHA || characterSha !== snapshot.CHARACTER_SHA) {
    throw new Error("CHARACTER_SHA integrity fail");
  }
  if (personaSha !== EXPECTED.PERSONA_SHA || personaSha !== snapshot.PERSONA_SHA) {
    throw new Error("PERSONA_SHA integrity fail");
  }
  if (speechSha !== EXPECTED.SPEECH_LOCK_SHA || speechSha !== snapshot.SPEECH_LOCK_SHA) {
    throw new Error("SPEECH_LOCK_SHA integrity fail");
  }
  if (worldSha !== EXPECTED.WORLD_CANON_SHA || worldSha !== snapshot.WORLD_CANON_SHA) {
    throw new Error("WORLD_CANON_SHA integrity fail");
  }
  if (snapshot.database_source !== "live_production") {
    throw new Error(`database_source not live_production: ${snapshot.database_source}`);
  }
  if (!snapshot.FLOOD_PRODUCTION_RECORD_PROVEN || !snapshot.ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN) {
    throw new Error("production provenance flags are not true");
  }
  return snapshot;
}

function loadPromptChunks(snapshot: SnapshotFile, personaDisplayName: string, userNickname: string) {
  const fields = snapshot.character.fields;
  const storedKorean = deserializeCharacterChunks(fields.setting_chunks ?? "");
  const row: CharacterSettingRow = {
    id: snapshot.character.id,
    name: snapshot.character.name,
    gender: snapshot.character.gender,
    system_prompt: fields.system_prompt ?? "",
    world: snapshot.world_canon.fields.world ?? fields.system_prompt ?? "",
    example_dialog: fields.example_dialog ?? "",
    setting_chunks: fields.setting_chunks ?? "",
    setting_chunks_en: fields.setting_chunks_en ?? "",
    prompt_translation_hash:
      storedKorean.length > 0 ? hashKoreanChunks(storedKorean) : null,
    speech_profile: snapshot.speech_lock.fields.speech_profile ?? "",
    creator_compiled_description_json: fields.creator_compiled_description_json ?? "",
    appearance_raw: fields.appearance_raw ?? "",
    appearance_compiled: fields.appearance_compiled ?? "",
  };
  const loaded = loadCharacterChunksForPromptReadOnly(row, personaDisplayName, userNickname);
  const cfg = snapshot.prompt_relevant_config;
  if (
    loaded.usedEnglish === cfg.used_english_character_prompt &&
    loaded.chunks.length === cfg.chunk_count
  ) {
    return { ...loaded, loader: "loadCharacterChunksForPromptReadOnly" };
  }
  const korean = storedKorean.length > 0 ? storedKorean : loadCharacterChunksReadOnly(row);
  const english = loadEnglishChunks(
    {
      setting_chunks_en: row.setting_chunks_en,
      prompt_translation_hash: hashKoreanChunks(korean),
    },
    korean
  );
  if (!english) {
    throw new Error(
      `chunk load mismatch: usedEnglish=${loaded.usedEnglish} count=${loaded.chunks.length} expected ${cfg.used_english_character_prompt}/${cfg.chunk_count}`
    );
  }
  const merged = mergeEnglishLayerWithKoreanSpeech(english, korean);
  return {
    chunks: replaceUserPlaceholderInChunks(merged, personaDisplayName, userNickname),
    usedEnglish: true,
    loader: "stored_korean_plus_english_layer",
  };
}

function assembleTurn(
  snapshot: SnapshotFile,
  chunks: ReturnType<typeof loadPromptChunks>,
  history: ChatMsg[],
  currentUserMessage: string,
  modelId: string
) {
  const fields = snapshot.character.fields;
  const personaName = snapshot.persona.name.trim() || "렌";
  const personaGender = resolveCharacterGender(snapshot.persona.fields.gender || snapshot.persona.gender);
  const publicPersona = toPublicPersonaDescription(snapshot.persona.fields.description ?? "");
  const userImpersonation = resolveUserImpersonationAllowance({
    personaDescription: publicPersona,
  });
  const runtimeMode = resolveChatRuntimeMode({
    oocUserImpersonationAllowed: userImpersonation,
  });
  const userPersona = formatPublicPersonaForPrompt(personaName, personaGender, publicPersona, {
    coNarrationEnabled: userImpersonation,
  });
  const exampleDialog = resolveExampleDialogForPrompt(
    fields.example_dialog ?? "",
    snapshot.character.name
  );
  const built = buildContext({
    charName: snapshot.character.name,
    contentKind: snapshot.character.content_kind === "simulation" ? "simulation" : "character",
    narrativePov: resolveNarrativePov({
      mode: "third_person",
      contentKind: snapshot.character.content_kind === "simulation" ? "simulation" : "character",
      mainCharacterName: snapshot.character.name,
    }),
    chunks: chunks.chunks,
    systemPrompt: fields.system_prompt ?? "",
    world: snapshot.world_canon.fields.world ?? "",
    exampleDialog,
    speechProfileJson: snapshot.speech_lock.fields.speech_profile ?? "",
    speechPersonality: snapshot.speech_lock.fields.speech_personality ?? "",
    speechTraits: snapshot.speech_lock.fields.speech_traits ?? "",
    characterPersonality: fields.description ?? "",
    userNickname: personaName,
    userPersona,
    shortTermHistory: history,
    currentUserMessage,
    nsfw: true,
    gender: resolveCharacterGender(snapshot.character.gender),
    modelId,
    userImpersonation,
    novelModeEnabled: false,
    runtimeMode,
    personaDisplayName: personaName,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: history.filter((m) => m.role === "assistant").length,
    userPersonaGender: personaGender,
    provider: "cheaperinference",
    genres: parseGenresJson(fields.genres),
    useEnglishCharacterPrompt: chunks.usedEnglish,
    isContinue: false,
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history,
    modelId,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: snapshot.character.name,
    },
  });
  return { built, assembled };
}

async function streamChat(requestBody: Record<string, unknown>): Promise<{
  httpStatus: number;
  text: string;
  finishReason: string | null;
  resolvedModel: string | null;
  usageRaw: unknown;
  latencyMs: number;
  reasoning: ReasoningAcc;
  sentKeys: string[];
}> {
  const reasoning: ReasoningAcc = {
    reasoning_stream_events: 0,
    reasoning_chars: 0,
    reasoning_delta_keys: [],
  };
  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.body) {
    return {
      httpStatus: res.status,
      text: "",
      finishReason: null,
      resolvedModel: null,
      usageRaw: null,
      latencyMs: Date.now() - started,
      reasoning,
      sentKeys: requestBodyKeys(requestBody),
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
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      consumeReasoningFromDelta(delta, reasoning);
      const message = (choice.message ?? {}) as Record<string, unknown>;
      consumeReasoningFromDelta(message, reasoning);
      const piece = typeof delta.content === "string" ? delta.content : "";
      if (piece) text += piece;
    }
  }
  return {
    httpStatus: res.status,
    text,
    finishReason,
    resolvedModel,
    usageRaw,
    latencyMs: Date.now() - started,
    reasoning,
    sentKeys: requestBodyKeys(requestBody),
  };
}

function writeEvaluationContext(snapshot: SnapshotFile): string {
  const parsed = parseStoredSpeechProfile(snapshot.speech_lock.fields.parsed_speech_profile_json) ??
    parseStoredSpeechProfile(snapshot.speech_lock.fields.speech_profile);
  const lines = [
    "# EVALUATION_CONTEXT",
    "",
    "Deterministic structured fields only. Full creator RAW is not included.",
    "",
    "## Provenance",
    "",
    `- SNAPSHOT_ID: \`${SNAPSHOT_ID}\``,
    `- CHARACTER_ID: \`${snapshot.character.id}\``,
    `- CHARACTER_DISPLAY_NAME: ${snapshot.character.name}`,
    `- CHARACTER_SHA: \`${snapshot.CHARACTER_SHA}\``,
    `- PERSONA_ID: \`${snapshot.persona.id}\``,
    `- PERSONA_DISPLAY_NAME: ${snapshot.persona.name}`,
    `- PERSONA_SHA: \`${snapshot.PERSONA_SHA}\``,
    `- SPEECH_LOCK_SHA: \`${snapshot.SPEECH_LOCK_SHA}\``,
    `- WORLD_CANON_SHA: \`${snapshot.WORLD_CANON_SHA}\``,
    `- FLOOD_PRODUCTION_RECORD_PROVEN: \`${snapshot.FLOOD_PRODUCTION_RECORD_PROVEN}\``,
    `- ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: \`${snapshot.ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN}\``,
    "",
    "## Basic identity (structural)",
    "",
    `- character.gender: \`${snapshot.character.gender}\``,
    `- character.content_kind: \`${snapshot.character.content_kind}\``,
    `- persona.gender: \`${snapshot.persona.gender}\``,
    "",
    "## Speech Lock parsed profile",
    "",
    "```json",
    JSON.stringify(parsed ?? {}, null, 2),
    "```",
    "",
    "## Configured speech constraints (from parsed profile)",
    "",
    `- speech_formality: \`${parsed?.speech_formality ?? ""}\``,
    `- vocabulary_style: \`${parsed?.vocabulary_style ?? ""}\``,
    `- social_class: \`${parsed?.social_class ?? ""}\``,
    `- era_style: \`${parsed?.era_style ?? ""}\``,
    `- forbidden_speech_patterns: ${JSON.stringify(parsed?.forbidden_speech_patterns ?? [])}`,
    `- ending_anchors: ${JSON.stringify(parsed?.ending_anchors ?? [])}`,
    "",
    "No free-form literary personality summary was written from creator RAW.",
    "",
  ];
  return lines.join("\n");
}

function fence(text: string): string {
  return `\`\`\`text\n${text}\n\`\`\``;
}

async function main(): Promise<void> {
  const snapshot = loadSnapshot();
  const personaName = snapshot.persona.name.trim() || "렌";
  const chunks = loadPromptChunks(snapshot, personaName, personaName);
  if (chunks.chunks.length !== snapshot.prompt_relevant_config.chunk_count) {
    throw new Error(
      `chunk_count ${chunks.chunks.length} != ${snapshot.prompt_relevant_config.chunk_count}`
    );
  }
  if (chunks.usedEnglish !== snapshot.prompt_relevant_config.used_english_character_prompt) {
    throw new Error(`usedEnglish ${chunks.usedEnglish} != snapshot`);
  }

  const evaluationContext = writeEvaluationContext(snapshot);
  save(DOCS, "EVALUATION_CONTEXT.md", evaluationContext);
  save(ARTIFACTS, "EVALUATION_CONTEXT.md", evaluationContext);

  const greeting = snapshot.character.fields.greeting ?? "";
  let history: ChatMsg[] = greeting.trim()
    ? [{ role: "assistant", content: greeting }]
    : [];

  const geminiTurns: Array<{
    label: string;
    user: string;
    raw: string;
    httpStatus: number;
    finishReason: string | null;
    resolvedModel: string | null;
    latencyMs: number;
    reasoning: ReasoningAcc;
    sentKeys: string[];
  }> = [];

  const sourceUsers = [SYNTHETIC_USERS.turn1, SYNTHETIC_USERS.turn2, SYNTHETIC_USERS.turn3];
  for (let i = 0; i < sourceUsers.length; i += 1) {
    const user = sourceUsers[i]!;
    const { assembled } = assembleTurn(snapshot, chunks, history, user, SOURCE_MODEL);
    const body = assembled.requestBody as Record<string, unknown>;
    console.log(`[F1] Gemini turn ${i + 1} fetch`, {
      model: body.model,
      reasoning_effort: body.reasoning_effort ?? null,
      thinking: body.thinking ?? null,
      keys: requestBodyKeys(body),
    });
    const resp = await streamChat(body);
    if (resp.httpStatus >= 400 || !resp.text.trim()) {
      throw new Error(`Gemini turn ${i + 1} failed: status=${resp.httpStatus} chars=${resp.text.length}`);
    }
    geminiTurns.push({
      label: `GEMINI_${i + 1}`,
      user,
      raw: resp.text,
      httpStatus: resp.httpStatus,
      finishReason: resp.finishReason,
      resolvedModel: resp.resolvedModel,
      latencyMs: resp.latencyMs,
      reasoning: resp.reasoning,
      sentKeys: resp.sentKeys,
    });
    history = [
      ...history,
      { role: "user", content: user },
      { role: "assistant", content: resp.text },
    ];
  }

  const currentUser = SYNTHETIC_USERS.adult;
  const frozenAssembly = assembleTurn(
    snapshot,
    chunks,
    history,
    currentUser,
    SOURCE_MODEL
  );
  const geminiAdultBody = frozenAssembly.assembled.requestBody as Record<string, unknown>;
  const frozenMessages = frozenAssembly.assembled.messages as Array<{
    role: string;
    content: unknown;
  }>;
  const frozenDeepSeekBody = applyTrueOff(geminiAdultBody, TARGET_MODEL);
  const freeze = {
    SNAPSHOT_ID,
    CHARACTER_SHA: snapshot.CHARACTER_SHA,
    PERSONA_SHA: snapshot.PERSONA_SHA,
    SPEECH_LOCK_SHA: snapshot.SPEECH_LOCK_SHA,
    WORLD_CANON_SHA: snapshot.WORLD_CANON_SHA,
    FULL_SYSTEM_SHA: sha256(frozenAssembly.built.systemPrompt ?? ""),
    HISTORY_SHA: hashMessages(history),
    SOURCE_GEMINI37_RAW_SHA: sha256(geminiTurns[2]!.raw),
    SOURCE_ASSISTANT_SHA: sha256(geminiTurns[2]!.raw),
    CURRENT_SYNTHETIC_USER_SHA: sha256(currentUser),
    CURRENT_USER_SHA: sha256(currentUser),
    FULL_ASSEMBLED_MESSAGES_SHA: hashMessages(frozenMessages),
    FULL_PROMPT_SHA: sha256(
      `${frozenAssembly.built.systemPrompt ?? ""}\u0000${hashMessages(frozenMessages)}`
    ),
    SOURCE_MODEL,
    TARGET_MODEL,
    SOURCE_TEMPERATURE: geminiAdultBody.temperature ?? null,
    TARGET_TEMPERATURE: frozenDeepSeekBody.temperature ?? null,
    TARGET_TRANSPORT: {
      provider: "cheaperinference",
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      thinking: frozenDeepSeekBody.thinking,
      reasoning_effort: frozenDeepSeekBody.reasoning_effort,
      sent_keys: requestBodyKeys(frozenDeepSeekBody),
      absent_keys: ["enable_thinking", "reasoning", "include_reasoning"].filter(
        (key) => !(key in frozenDeepSeekBody)
      ),
    },
    SOURCE_MIRROR: false,
    COMPLETION: false,
    TURN_OWNERSHIP: false,
    ORIGIN_POINTER: false,
    MODEL_SPECIFIC_STYLE_ADAPTER: false,
    QUALITY_SCORING_BY_CURSOR: false,
    chunk_loader: chunks.loader,
    used_english: chunks.usedEnglish,
    chunk_count: chunks.chunks.length,
  };

  save(DOCS, "FREEZE.json", freeze);
  save(ARTIFACTS, "FREEZE.json", freeze);

  const deepseekRuns: Array<{
    label: string;
    raw: string;
    late25: string;
    httpStatus: number;
    finishReason: string | null;
    resolvedModel: string | null;
    latencyMs: number;
    reasoning: ReasoningAcc;
    usageReasoningTokens: unknown;
    sentKeys: string[];
    bodySha: string;
  }> = [];

  const frozenBodySha = sha256(JSON.stringify(frozenDeepSeekBody));
  for (let i = 1; i <= 2; i += 1) {
    const body = JSON.parse(JSON.stringify(frozenDeepSeekBody)) as Record<string, unknown>;
    if (sha256(JSON.stringify(body)) !== frozenBodySha) {
      throw new Error("DeepSeek fixture mutated before send");
    }
    console.log(`[F1] DeepSeek Vanilla TRUE-OFF run ${i}`, {
      model: body.model,
      thinking: body.thinking,
      reasoning_effort: body.reasoning_effort,
      keys: requestBodyKeys(body),
    });
    const resp = await streamChat(body);
    if (resp.httpStatus >= 400 || !resp.text.trim()) {
      throw new Error(`DeepSeek run ${i} failed: status=${resp.httpStatus} chars=${resp.text.length}`);
    }
    deepseekRuns.push({
      label: `DEEPSEEK_VANILLA_${i}`,
      raw: resp.text,
      late25: lateQuarter(resp.text),
      httpStatus: resp.httpStatus,
      finishReason: resp.finishReason,
      resolvedModel: resp.resolvedModel,
      latencyMs: resp.latencyMs,
      reasoning: resp.reasoning,
      usageReasoningTokens:
        resp.usageRaw && typeof resp.usageRaw === "object"
          ? (resp.usageRaw as { reasoning_tokens?: unknown }).reasoning_tokens ?? null
          : null,
      sentKeys: resp.sentKeys,
      bodySha: sha256(JSON.stringify(body)),
    });
  }

  const reasoningEvents = deepseekRuns.map((run) => run.reasoning.reasoning_stream_events);
  const reasoningChars = deepseekRuns.map((run) => run.reasoning.reasoning_chars);
  const trueOffParity =
    reasoningEvents.every((n) => n === 0) && reasoningChars.every((n) => n === 0);

  const metrics = {
    SNAPSHOT_ID,
    CHARACTER: snapshot.character.name,
    PERSONA: snapshot.persona.name,
    PRODUCTION_RECORD_PROVEN: true,
    SOURCE_MODEL: "Gemini 3.7 Flash",
    TARGET_MODEL,
    USER_TURN_ORIGIN: "CURSOR_SYNTHETIC",
    HUMAN_WRITTEN: false,
    SOURCE_GEMINI_CALLS: 3,
    DEEPSEEK_CALLS: 2,
    TOTAL_NEW_CALLS: 5,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    TRUE_OFF_CONFIG: "thinking.disabled + reasoning_effort.none",
    REASONING_EVENTS: reasoningEvents,
    REASONING_CHARS: reasoningChars,
    TRUE_OFF_PARITY: trueOffParity,
    SOURCE_ASSISTANT_SHA: freeze.SOURCE_ASSISTANT_SHA,
    CURRENT_USER_SHA: freeze.CURRENT_USER_SHA,
    SYSTEM_SHA: freeze.FULL_SYSTEM_SHA,
    HISTORY_SHA: freeze.HISTORY_SHA,
    FULL_PROMPT_SHA: freeze.FULL_PROMPT_SHA,
    FULL_ASSEMBLED_MESSAGES_SHA: freeze.FULL_ASSEMBLED_MESSAGES_SHA,
    QUALITY_SCORING_BY_CURSOR: false,
    SOURCE_MIRROR: false,
    COMPLETION: false,
    TURN_OWNERSHIP: false,
    ORIGIN_POINTER: false,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    usage_reasoning_tokens_not_used_as_proof: deepseekRuns.map((run) => run.usageReasoningTokens),
  };

  const manifest = {
    track: "DEEPSEEK_FLOOD_LOCAL_PREFLIGHT_F1",
    DEEPSEEK_FLOOD_LOCAL_PREFLIGHT_F1: true,
    ...metrics,
    CHARACTER_ID: snapshot.character.id,
    PERSONA_ID: snapshot.persona.id,
    CHARACTER_SHA: snapshot.CHARACTER_SHA,
    PERSONA_SHA: snapshot.PERSONA_SHA,
    SPEECH_LOCK_SHA: snapshot.SPEECH_LOCK_SHA,
    WORLD_CANON_SHA: snapshot.WORLD_CANON_SHA,
    FREEZE: freeze,
    gemini: geminiTurns.map((turn) => ({
      label: turn.label,
      user_sha: sha256(turn.user),
      raw_sha: sha256(turn.raw),
      chars: [...turn.raw].length,
      httpStatus: turn.httpStatus,
      finishReason: turn.finishReason,
      resolvedModel: turn.resolvedModel,
      latencyMs: turn.latencyMs,
    })),
    deepseek: deepseekRuns.map((run) => ({
      label: run.label,
      raw_sha: sha256(run.raw),
      chars: [...run.raw].length,
      late25_chars: [...run.late25].length,
      httpStatus: run.httpStatus,
      finishReason: run.finishReason,
      resolvedModel: run.resolvedModel,
      latencyMs: run.latencyMs,
      reasoning: run.reasoning,
      bodySha: run.bodySha,
    })),
  };

  save(DOCS, "SOURCE_GEMINI37_TURN1_RAW.txt", geminiTurns[0]!.raw);
  save(DOCS, "SOURCE_GEMINI37_TURN2_RAW.txt", geminiTurns[1]!.raw);
  save(DOCS, "SOURCE_GEMINI37_RAW.txt", geminiTurns[2]!.raw);
  save(DOCS, "CURRENT_USER.txt", currentUser);
  save(DOCS, "SYNTHETIC_USER_TURNS.md", [
    "# Synthetic user turns",
    "",
    "USER_TURN_ORIGIN=CURSOR_SYNTHETIC",
    "HUMAN_WRITTEN=false",
    "",
    "## 1",
    "",
    SYNTHETIC_USERS.turn1,
    "",
    "## 2",
    "",
    SYNTHETIC_USERS.turn2,
    "",
    "## 3",
    "",
    SYNTHETIC_USERS.turn3,
    "",
    "## 4 adult-boundary",
    "",
    SYNTHETIC_USERS.adult,
    "",
  ].join("\n"));
  save(DOCS, "DEEPSEEK_VANILLA_RUN1_RAW.txt", deepseekRuns[0]!.raw);
  save(DOCS, "DEEPSEEK_VANILLA_RUN1_LATE25.txt", deepseekRuns[0]!.late25);
  save(DOCS, "DEEPSEEK_VANILLA_RUN2_RAW.txt", deepseekRuns[1]!.raw);
  save(DOCS, "DEEPSEEK_VANILLA_RUN2_LATE25.txt", deepseekRuns[1]!.late25);
  save(DOCS, "METRICS.json", metrics);
  save(DOCS, "MANIFEST.json", manifest);
  save(DOCS, "TRANSPORT.json", {
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    source_model: SOURCE_MODEL,
    target_model: TARGET_MODEL,
    true_off: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      do_not_send: ["enable_thinking", "reasoning", "include_reasoning"],
    },
    frozen_body_keys: requestBodyKeys(frozenDeepSeekBody),
    gemini_body_keys: geminiTurns[0]!.sentKeys,
  });

  const review = [
    "# DeepSeek Flood Local Preflight F1 — Review Packet",
    "",
    "QUALITY_SCORING_BY_CURSOR=false. Cursor does not label literary quality.",
    "",
    "## A. Provenance summary",
    "",
    `- SNAPSHOT_ID: \`${SNAPSHOT_ID}\``,
    `- CHARACTER: ${snapshot.character.name}`,
    `- CHARACTER_ID: \`17\``,
    `- CHARACTER_SHA: \`${snapshot.CHARACTER_SHA}\``,
    `- PERSONA: ${snapshot.persona.name}`,
    `- PERSONA_ID: \`1\``,
    `- PERSONA_SHA: \`${snapshot.PERSONA_SHA}\``,
    `- SPEECH_LOCK_SHA: \`${snapshot.SPEECH_LOCK_SHA}\``,
    `- WORLD_CANON_SHA: \`${snapshot.WORLD_CANON_SHA}\``,
    `- FLOOD_PRODUCTION_RECORD_PROVEN: true`,
    `- ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: true`,
    `- database_source: live_production`,
    `- SOURCE_MODEL: Gemini 3.7 Flash (\`${SOURCE_MODEL}\`)`,
    `- TARGET_MODEL: \`${TARGET_MODEL}\``,
    `- PROVIDER: cheaperinference`,
    `- Assembly: private snapshot → \`loadCharacterChunksForPromptReadOnly\` / example-dialog / Speech Lock / \`formatPublicPersonaForPrompt\` → \`buildContext\` → \`assemblePrimaryRpRequest\``,
    `- DeepSeek Vanilla: same frozen Gemini-assembled messages; model swap + TRUE-OFF only`,
    `- SOURCE_MIRROR / COMPLETION / TURN_OWNERSHIP / ORIGIN_POINTER / model-specific style adapter: false`,
    `- Full character / Persona / Speech Lock / world RAW remain in private snapshot storage and are not in git`,
    "",
    "## B. Synthetic / human status",
    "",
    `- USER_TURN_ORIGIN: CURSOR_SYNTHETIC`,
    `- HUMAN_WRITTEN: false`,
    `- PRODUCTION_EQUIVALENT_HUMAN_FIXTURE: false`,
    "",
    "Voice-establishment turns:",
    "",
    `1. ${SYNTHETIC_USERS.turn1}`,
    `2. ${SYNTHETIC_USERS.turn2}`,
    `3. ${SYNTHETIC_USERS.turn3}`,
    "",
    "## C. EVALUATION_CONTEXT",
    "",
    evaluationContext,
    "",
    "## D. Final Gemini 3.7 source RAW",
    "",
    fence(geminiTurns[2]!.raw),
    "",
    "## E. Current synthetic user input",
    "",
    fence(currentUser),
    "",
    "## F. DeepSeek Vanilla run 1 RAW",
    "",
    fence(deepseekRuns[0]!.raw),
    "",
    "## G. Run 1 late ~25%",
    "",
    fence(deepseekRuns[0]!.late25),
    "",
    "## H. DeepSeek Vanilla run 2 RAW",
    "",
    fence(deepseekRuns[1]!.raw),
    "",
    "## I. Run 2 late ~25%",
    "",
    fence(deepseekRuns[1]!.late25),
    "",
    "## J. Telemetry",
    "",
    "```json",
    JSON.stringify(
      {
        SOURCE_GEMINI_CALLS: 3,
        DEEPSEEK_CALLS: 2,
        TOTAL_NEW_CALLS: 5,
        retry: 0,
        continuation: 0,
        recovery: 0,
        fallback: 0,
        TRUE_OFF_CONFIG: "thinking.disabled + reasoning_effort.none",
        REASONING_EVENTS: reasoningEvents,
        REASONING_CHARS: reasoningChars,
        TRUE_OFF_PARITY: trueOffParity,
        SOURCE_ASSISTANT_SHA: freeze.SOURCE_ASSISTANT_SHA,
        CURRENT_USER_SHA: freeze.CURRENT_USER_SHA,
        SYSTEM_SHA: freeze.FULL_SYSTEM_SHA,
        HISTORY_SHA: freeze.HISTORY_SHA,
        FULL_PROMPT_SHA: freeze.FULL_PROMPT_SHA,
        FULL_ASSEMBLED_MESSAGES_SHA: freeze.FULL_ASSEMBLED_MESSAGES_SHA,
        gemini: geminiTurns.map((turn) => ({
          label: turn.label,
          chars: [...turn.raw].length,
          httpStatus: turn.httpStatus,
          finishReason: turn.finishReason,
          resolvedModel: turn.resolvedModel,
          latencyMs: turn.latencyMs,
        })),
        deepseek: deepseekRuns.map((run) => ({
          label: run.label,
          chars: [...run.raw].length,
          httpStatus: run.httpStatus,
          finishReason: run.finishReason,
          resolvedModel: run.resolvedModel,
          latencyMs: run.latencyMs,
          reasoning_stream_events: run.reasoning.reasoning_stream_events,
          reasoning_chars: run.reasoning.reasoning_chars,
          reasoning_delta_keys: run.reasoning.reasoning_delta_keys,
          usage_reasoning_tokens_not_used_as_proof: run.usageReasoningTokens,
          bodySha: run.bodySha,
        })),
        QUALITY_SCORING_BY_CURSOR: false,
        SOURCE_MIRROR: false,
        COMPLETION: false,
        TURN_OWNERSHIP: false,
        ORIGIN_POINTER: false,
        PRODUCTION_CHANGED: false,
        MAIN_MERGED: false,
        RAILWAY_DEPLOYED: false,
      },
      null,
      2
    ),
    "```",
    "",
  ].join("\n");

  save(DOCS, "REVIEW_PACKET.md", review);
  save(ARTIFACTS, "REVIEW_PACKET.md", review);
  save(DOCS, "CHARACTER.txt", [
    "CHARACTER.txt",
    "TRACK: DEEPSEEK_FLOOD_LOCAL_PREFLIGHT_F1",
    "REQUESTED_NAME: 플러드",
    "CHARACTER_ID: 17",
    `CHARACTER_SHA: ${snapshot.CHARACTER_SHA}`,
    "CHARACTER_PRODUCTION_RECORD_PROVEN: true",
    "RAW: PRIVATE_SNAPSHOT_ONLY",
    "",
  ].join("\n"));
  save(DOCS, "PERSONA.txt", [
    "PERSONA.txt",
    "PERSONA: 렌",
    "PERSONA_ID: 1",
    `PERSONA_SHA: ${snapshot.PERSONA_SHA}`,
    "ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: true",
    "RAW: PRIVATE_SNAPSHOT_ONLY",
    "",
  ].join("\n"));
  save(DOCS, "SPEECH_LOCK.txt", [
    "SPEECH_LOCK.txt",
    `SPEECH_LOCK_SHA: ${snapshot.SPEECH_LOCK_SHA}`,
    "Parsed profile is in EVALUATION_CONTEXT.md.",
    "RAW: PRIVATE_SNAPSHOT_ONLY",
    "",
  ].join("\n"));
  save(DOCS, "WORLD_CANON.txt", [
    "WORLD_CANON.txt",
    `WORLD_CANON_SHA: ${snapshot.WORLD_CANON_SHA}`,
    "RAW: PRIVATE_SNAPSHOT_ONLY",
    "",
  ].join("\n"));
  save(DOCS, "HISTORY.txt", [
    "HISTORY.txt",
    `HISTORY_SHA: ${freeze.HISTORY_SHA}`,
    "Greeting + three Gemini source exchanges. Greeting RAW is not copied here.",
    "",
  ].join("\n"));
  save(DOCS, "SYSTEM.txt", [
    "SYSTEM.txt",
    `FULL_SYSTEM_SHA: ${freeze.FULL_SYSTEM_SHA}`,
    "Assembled system prompt is not committed.",
    "",
  ].join("\n"));

  console.log("[F1] complete", metrics);
}

main().catch((error) => {
  console.error("[F1] failed", error);
  process.exit(1);
});
