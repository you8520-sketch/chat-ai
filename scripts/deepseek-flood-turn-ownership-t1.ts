/**
 * Flood Turn Ownership T1 — audit-only challenger.
 * Reconstructs the frozen Flood F1 fixture and adds EXACTLY the
 * USER SEMANTIC OWNERSHIP block. No production wiring.
 *
 *   node --conditions=react-server --import tsx scripts/deepseek-flood-turn-ownership-t1.ts --reconstruct-only
 *   node --conditions=react-server --import tsx scripts/deepseek-flood-turn-ownership-t1.ts
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
import { resolveUserImpersonationAllowance } from "../src/lib/userImpersonationPolicy";
import { replaceUserPlaceholderInChunks } from "../src/lib/userPlaceholder";
import { deserializeCharacterChunks } from "../src/utils/characterParser";
import { buildContext } from "../src/services/contextBuilder";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const SNAPSHOT_ID = "handoff-17-1-2026-08-18T11-38-17-786Z";
const SOURCE_MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const TARGET_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const DOCS = path.join(process.cwd(), "docs/audits/deepseek-flood-turn-ownership-t1");
const ARTIFACTS = path.join("/opt/cursor/artifacts", "deepseek-flood-turn-ownership-t1");

const EXPECTED = {
  CHARACTER_SHA: "f1f941ab3964d8561484553ee0ebfd2ccd121cea7b367690f3d718942fe393d2",
  PERSONA_SHA: "019047714e494c1b1f874b8bca0fc463522a4ff83d76d6b482f7caddbee7876c",
  SPEECH_LOCK_SHA: "a02b5b82500eba1c5d45fa2d877d31fd4ce23782c5bf8fdfcdcc19ece2188d21",
  WORLD_CANON_SHA: "de6c8097f83027ec0d1b0d80ced2b161b02b1cf551fb5864c0b6b59b3785ae98",
  SOURCE_ASSISTANT_SHA: "1895ef56e88ee16d8d67ec38e838ad8956bb967545e1c57aab8f372dbecb2c6c",
  CURRENT_USER_SHA: "a1a36509f4f5ec7e5230c48d3c0b8c15d357e401b8ac70f17b5389783c321215",
  SYSTEM_SHA: "8ab7541582ca8a831f1de2792468bff9163d9c0fa0d2af0fd2b7d135da4ecc23",
  HISTORY_SHA: "5ccafaaf4f45907ce9259522edbb14f6c339925af21ad98aa355e3a5fc72c4d5",
  FULL_PROMPT_SHA: "c3d4b4545c5a102bfa263020721ce559f8dda8369584bea0a3e157bccdc2c448",
  FULL_ASSEMBLED_MESSAGES_SHA: "3a7e4f90a23f74c05cbfdc450cdcf88ace265bec59521a7ff4dcfeb48293b5ab",
  BASELINE_BODY_SHA: "e598e865ca1d788809c08948fa9a008c497b262b85a33676a598674abb818e5f",
  GEMINI_TURN1_SHA: "1797b8d5c9abb56899d71d3f7002c456446623f5f53022f88b0c30d3831a62ec",
  GEMINI_TURN2_SHA: "a3c6973c22469d4328de2988024c73ab83d4282561464b441714752726a4eebc",
} as const;

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
  };
  persona: {
    id: number;
    user_id: number;
    name: string;
    gender: string;
    fields: Record<string, string>;
  };
  speech_lock: {
    fields: Record<string, string>;
  };
  world_canon: {
    fields: Record<string, string>;
  };
  prompt_relevant_config: {
    used_english_character_prompt: boolean;
    chunk_count: number;
  };
};

type AssembledMessage = { role: string; content: unknown };

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

function hashMessages(messages: AssembledMessage[]): string {
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

function loadOwnershipBlock(): string {
  const raw = fs.readFileSync(path.join(DOCS, "TURN_OWNERSHIP_BLOCK.txt"), "utf8");
  if (raw !== raw.replace(/\r\n/g, "\n")) {
    throw new Error("Turn Ownership block must be LF-only");
  }
  return raw;
}

function loadExactDoc(name: string, expectedSha: string): string {
  const text = fs.readFileSync(path.join(DOCS, name), "utf8");
  const got = sha256(text);
  if (got !== expectedSha) {
    throw new Error(`${name} SHA mismatch: ${got} != ${expectedSha}`);
  }
  return text;
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
  const personaGender = resolveCharacterGender(
    snapshot.persona.fields.gender || snapshot.persona.gender
  );
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

function insertOwnerBlock(messages: AssembledMessage[], ownerBlock: string): AssembledMessage[] {
  const next = JSON.parse(JSON.stringify(messages)) as AssembledMessage[];
  const system = next[0];
  if (!system || system.role !== "system") {
    throw new Error("assembled messages[0] is not system");
  }
  const inserted = `\n\n${ownerBlock}`;
  if (typeof system.content === "string") {
    system.content = `${system.content}${inserted}`;
    return next;
  }
  if (Array.isArray(system.content)) {
    system.content = [
      ...system.content,
      { type: "text", text: inserted },
    ];
    return next;
  }
  throw new Error("unsupported system content shape");
}

function proveOnlyOwnerBlockDifference(
  baseline: AssembledMessage[],
  challenger: AssembledMessage[],
  ownerBlock: string
): {
  ONLY_SEMANTIC_DIFFERENCE_PROVEN: boolean;
  nonSystemMessagesIdentical: boolean;
  systemPrefixUnchanged: boolean;
  insertedSuffix: string;
} {
  if (baseline.length !== challenger.length) {
    throw new Error(`message count drifted: ${baseline.length} vs ${challenger.length}`);
  }
  for (let i = 1; i < baseline.length; i += 1) {
    const left = `${baseline[i]!.role}\u0000${flattenMessageContent(baseline[i]!.content)}`;
    const right = `${challenger[i]!.role}\u0000${flattenMessageContent(challenger[i]!.content)}`;
    if (left !== right) {
      throw new Error(`non-system message ${i} drifted`);
    }
  }
  const baselineSystem = flattenMessageContent(baseline[0]!.content);
  const challengerSystem = flattenMessageContent(challenger[0]!.content);
  const expected = `${baselineSystem}\n\n${ownerBlock}`;
  if (challengerSystem !== expected) {
    throw new Error("challenger system is not baseline system + owner block");
  }
  return {
    ONLY_SEMANTIC_DIFFERENCE_PROVEN: true,
    nonSystemMessagesIdentical: true,
    systemPrefixUnchanged: true,
    insertedSuffix: `\n\n${ownerBlock}`,
  };
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

function fence(text: string): string {
  return `\`\`\`text\n${text}\n\`\`\``;
}

function writeReviewPacket(opts: {
  proof: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  challenger: Array<{ raw: string; late25: string }> | null;
}): void {
  const ownerBlock = loadOwnershipBlock();
  const currentUser = fs.readFileSync(path.join(DOCS, "CURRENT_USER.txt"), "utf8");
  const geminiSource = fs.readFileSync(path.join(DOCS, "SOURCE_GEMINI37_RAW.txt"), "utf8");
  const vanilla1 = fs.readFileSync(path.join(DOCS, "DEEPSEEK_VANILLA_RUN1_RAW.txt"), "utf8");
  const vanilla2 = fs.readFileSync(path.join(DOCS, "DEEPSEEK_VANILLA_RUN2_RAW.txt"), "utf8");
  const challenger1 = opts.challenger?.[0]?.raw ?? "(pending live challenger call)";
  const challenger2 = opts.challenger?.[1]?.raw ?? "(pending live challenger call)";
  const late1 = opts.challenger?.[0]?.late25 ?? "(pending live challenger call)";
  const late2 = opts.challenger?.[1]?.late25 ?? "(pending live challenger call)";
  const lines = [
    "# DeepSeek Flood Turn Ownership T1 — Review Packet",
    "",
    "QUALITY_SCORING_BY_CURSOR=false. Cursor does not label literary quality.",
    "BLIND_REVIEW=false. ChatGPT already reviewed the Flood F1 Vanilla baseline.",
    "",
    "## 1. Fixture provenance",
    "",
    "- BASE_MAIN: `b06037dd5c572bd02abec311f4148f57d9362551`",
    "- FIXTURE: Flood F1 frozen (reused, no new Gemini / no new Vanilla DeepSeek)",
    "- SNAPSHOT_ID: `handoff-17-1-2026-08-18T11-38-17-786Z`",
    "- CHARACTER: 플러드 (`17`)",
    `- CHARACTER_SHA: \`${String(opts.proof.CHARACTER_SHA)}\``,
    "- PERSONA: 렌 (`1`)",
    `- PERSONA_SHA: \`${String(opts.proof.PERSONA_SHA)}\``,
    `- SPEECH_LOCK_SHA: \`${String(opts.proof.SPEECH_LOCK_SHA)}\``,
    `- WORLD_CANON_SHA: \`${String(opts.proof.WORLD_CANON_SHA)}\``,
    "- SOURCE_MODEL: `gemini-3.7-flash`",
    "- TARGET_MODEL: `deepseek-v4-pro-0813`",
    "- PROVIDER: cheaperinference",
    "- ENDPOINT: `https://api.cheaperinference.com/v1/chat/completions`",
    `- SOURCE_ASSISTANT_SHA: \`${String(opts.proof.SOURCE_ASSISTANT_SHA)}\``,
    `- CURRENT_USER_SHA: \`${String(opts.proof.CURRENT_USER_SHA)}\``,
    `- SYSTEM_SHA: \`${String(opts.proof.SYSTEM_SHA)}\``,
    `- HISTORY_SHA: \`${String(opts.proof.HISTORY_SHA)}\``,
    `- FULL_PROMPT_SHA: \`${String(opts.proof.FULL_PROMPT_SHA)}\``,
    `- BASELINE_BODY_SHA: \`${String(opts.proof.BASELINE_BODY_SHA)}\``,
    "- FLOOD_PRODUCTION_RECORD_PROVEN: true",
    "- ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: true",
    "- USER_TURN_ORIGIN: CURSOR_SYNTHETIC",
    "- HUMAN_WRITTEN: false",
    "- Full character / Persona / Speech Lock / world RAW remain in private snapshot storage and are not in git",
    "- Structured evaluation fields: `EVALUATION_CONTEXT.md`",
    "",
    "## 2. Corrected agency interpretation",
    "",
    "The following are NOT automatically agency failures:",
    "",
    "- eye movement",
    "- blinking",
    "- slight head tilt",
    "- small hand/finger tremor",
    "- momentary flinch",
    "- breathing change",
    "- slight posture change",
    "- light facial reaction",
    "- ordinary physical consequences of an explicit user action",
    "",
    "These are MINOR NON-SEMANTIC CO-NARRATION and remain allowed.",
    "Do not force them to zero. Do not treat their mere presence as a defect.",
    "",
    "User owns meaningful semantics. Assistant must not invent:",
    "",
    "- new meaningful user dialogue",
    "- new major voluntary user action",
    "- consent",
    "- refusal",
    "- new intention / goal / desire",
    "- relationship decision",
    "- identity decision",
    "- a significant emotional conclusion as certain",
    "- authorization for a new meaningful interaction stage",
    "",
    "Minor observable reactions may be narrated, but must not be converted into evidence of those semantic states.",
    "",
    "Explicit user input authorizes only its explicit semantic scope.",
    "`더 하고 싶어` may establish continued interest in the current interaction,",
    "but must not automatically mean blanket consent to every later sexual act or escalation.",
    "",
    "## 3. Exact Turn Ownership candidate",
    "",
    "Frozen exactly. Not rewritten. No model-specific variant.",
    "",
    fence(ownerBlock),
    "",
    `- TURN_OWNERSHIP_BLOCK_SHA: \`${String(opts.proof.TURN_OWNERSHIP_BLOCK_SHA)}\``,
    "",
    "## 4. Current user input",
    "",
    fence(currentUser),
    "",
    "This input contains an explicit physical action, a question/request about kissing, and `더 하고 싶어`.",
    "",
    "## 5. Gemini source RAW (final source assistant)",
    "",
    fence(geminiSource),
    "",
    "## 6. Existing Vanilla TRUE-OFF run1 RAW",
    "",
    fence(vanilla1),
    "",
    "## 7. Existing Vanilla TRUE-OFF run2 RAW",
    "",
    fence(vanilla2),
    "",
    "## 8. Challenger run1 RAW",
    "",
    fence(challenger1),
    "",
    "## 9. Challenger run2 RAW",
    "",
    fence(challenger2),
    "",
    "## 10. Late ~25% of each challenger",
    "",
    "### Challenger run1 late 25%",
    "",
    fence(late1),
    "",
    "### Challenger run2 late 25%",
    "",
    fence(late2),
    "",
    "## 11. Transport telemetry",
    "",
    "```json",
    JSON.stringify(
      opts.metrics ?? {
        challengerCalls: 0,
        note: "reconstruct-only; live challenger telemetry pending",
        TRUE_OFF: "thinking.disabled + reasoning_effort.none",
        TARGET_PROVIDER: "cheaperinference",
        TARGET_ENDPOINT: "https://api.cheaperinference.com/v1/chat/completions",
        TARGET_MODEL: "deepseek-v4-pro-0813",
      },
      null,
      2
    ),
    "```",
    "",
    "## 12. Exact prompt-diff proof",
    "",
    "```json",
    JSON.stringify(opts.proof, null, 2),
    "```",
    "",
    "Semantic diff:",
    "",
    "- BASELINE = frozen Flood F1 Vanilla TRUE-OFF request",
    "- CHALLENGER = BASELINE + exactly one inserted USER SEMANTIC OWNERSHIP block",
    "- Insertion site: assembled `messages[0]` system content",
    "- Inserted text: `\\n\\n` + exact `TURN_OWNERSHIP_BLOCK.txt`",
    "- Character / Persona / Speech Lock / world / history / current user / source assistant RAW unchanged",
    "- No Source Mirror / Completion / Origin pointer / fingerprint / style adapter",
    "- No temperature / max-token / length / routing / TRUE-OFF change",
    "",
    "## ChatGPT review dimensions",
    "",
    "Compare existing Vanilla run1/run2 against Challenger run1/run2.",
    "This comparison is not blind.",
    "",
    "- A. Source style fidelity",
    "- B. Character identity",
    "- C. Speech Lock",
    "- D. Scene continuity",
    "- E. Progression",
    "- F. User semantic ownership",
    "- G. Natural minor co-narration",
    "- H. Passivity / stiffness",
    "- I. Duplicate permission checking",
    "- J. Late-response voice stability",
    "",
    "Cursor does not decide PASS / FAIL / better / worse on these dimensions.",
    "",
  ];
  const packet = `${lines.join("\n")}\n`;
  save(DOCS, "REVIEW_PACKET.md", packet);
  save(ARTIFACTS, "REVIEW_PACKET.md", packet);
}

function usageReasoningTokens(usageRaw: unknown): unknown {
  if (!usageRaw || typeof usageRaw !== "object") return null;
  const usage = usageRaw as Record<string, unknown>;
  const details = usage.completion_tokens_details;
  if (details && typeof details === "object") {
    return (details as Record<string, unknown>).reasoning_tokens ?? null;
  }
  return usage.reasoning_tokens ?? null;
}

async function main(): Promise<void> {
  const reconstructOnly = process.argv.includes("--reconstruct-only");
  const snapshot = loadSnapshot();
  const personaName = snapshot.persona.name.trim() || "렌";
  const ownerBlock = loadOwnershipBlock();
  const ownerBlockSha = sha256(ownerBlock);
  const currentUser = loadExactDoc("CURRENT_USER.txt", EXPECTED.CURRENT_USER_SHA);
  if (currentUser !== SYNTHETIC_USERS.adult) {
    throw new Error("CURRENT_USER.txt does not match frozen adult synthetic turn");
  }
  const gemini1 = loadExactDoc("SOURCE_GEMINI37_TURN1_RAW.txt", EXPECTED.GEMINI_TURN1_SHA);
  const gemini2 = loadExactDoc("SOURCE_GEMINI37_TURN2_RAW.txt", EXPECTED.GEMINI_TURN2_SHA);
  const gemini3 = loadExactDoc("SOURCE_GEMINI37_RAW.txt", EXPECTED.SOURCE_ASSISTANT_SHA);

  const chunks = loadPromptChunks(snapshot, personaName, personaName);
  if (chunks.chunks.length !== snapshot.prompt_relevant_config.chunk_count) {
    throw new Error(
      `chunk_count ${chunks.chunks.length} != ${snapshot.prompt_relevant_config.chunk_count}`
    );
  }
  if (chunks.usedEnglish !== snapshot.prompt_relevant_config.used_english_character_prompt) {
    throw new Error(`usedEnglish ${chunks.usedEnglish} != snapshot`);
  }

  const greeting = snapshot.character.fields.greeting ?? "";
  const history: ChatMsg[] = [];
  if (greeting.trim()) history.push({ role: "assistant", content: greeting });
  history.push(
    { role: "user", content: SYNTHETIC_USERS.turn1 },
    { role: "assistant", content: gemini1 },
    { role: "user", content: SYNTHETIC_USERS.turn2 },
    { role: "assistant", content: gemini2 },
    { role: "user", content: SYNTHETIC_USERS.turn3 },
    { role: "assistant", content: gemini3 }
  );

  const historySha = hashMessages(history);
  if (historySha !== EXPECTED.HISTORY_SHA) {
    throw new Error(`HISTORY_SHA mismatch: ${historySha}`);
  }

  const frozenAssembly = assembleTurn(
    snapshot,
    chunks,
    history,
    currentUser,
    SOURCE_MODEL
  );
  const assembledMessages = frozenAssembly.assembled.messages as AssembledMessage[];
  const geminiAdultBody = frozenAssembly.assembled.requestBody as Record<string, unknown>;
  const baselineBody = applyTrueOff(geminiAdultBody, TARGET_MODEL);
  const baselineMessages = (baselineBody.messages ?? assembledMessages) as AssembledMessage[];
  if (hashMessages(assembledMessages) !== hashMessages(baselineMessages)) {
    throw new Error("assembled.messages and requestBody.messages drifted");
  }

  const systemSha = sha256(frozenAssembly.built.systemPrompt ?? "");
  const messagesSha = hashMessages(baselineMessages);
  const fullPromptSha = sha256(
    `${frozenAssembly.built.systemPrompt ?? ""}\u0000${messagesSha}`
  );
  const baselineBodySha = sha256(JSON.stringify(baselineBody));

  if (systemSha !== EXPECTED.SYSTEM_SHA) throw new Error(`SYSTEM_SHA mismatch: ${systemSha}`);
  if (messagesSha !== EXPECTED.FULL_ASSEMBLED_MESSAGES_SHA) {
    throw new Error(`BASELINE_MESSAGES_SHA mismatch: ${messagesSha}`);
  }
  if (fullPromptSha !== EXPECTED.FULL_PROMPT_SHA) {
    throw new Error(`FULL_PROMPT_SHA mismatch: ${fullPromptSha}`);
  }
  if (baselineBodySha !== EXPECTED.BASELINE_BODY_SHA) {
    throw new Error(`BASELINE_BODY_SHA mismatch: ${baselineBodySha}`);
  }
  if (baselineBody.thinking !== undefined) {
    const thinking = baselineBody.thinking as { type?: unknown };
    if (thinking.type !== "disabled") throw new Error("baseline thinking is not disabled");
  } else {
    throw new Error("baseline missing thinking");
  }
  if (baselineBody.reasoning_effort !== "none") {
    throw new Error("baseline reasoning_effort is not none");
  }
  for (const forbidden of ["reasoning", "include_reasoning", "enable_thinking"]) {
    if (forbidden in baselineBody) throw new Error(`baseline still has ${forbidden}`);
  }

  const challengerMessages = insertOwnerBlock(baselineMessages, ownerBlock);
  const diffProof = proveOnlyOwnerBlockDifference(
    baselineMessages,
    challengerMessages,
    ownerBlock
  );
  const challengerBody = JSON.parse(JSON.stringify(baselineBody)) as Record<string, unknown>;
  challengerBody.messages = challengerMessages;
  if (challengerBody.thinking !== undefined) {
    const thinking = challengerBody.thinking as { type?: unknown };
    if (thinking.type !== "disabled") throw new Error("challenger thinking is not disabled");
  }
  if (challengerBody.reasoning_effort !== "none") {
    throw new Error("challenger reasoning_effort is not none");
  }
  for (const forbidden of ["reasoning", "include_reasoning", "enable_thinking"]) {
    if (forbidden in challengerBody) throw new Error(`challenger still has ${forbidden}`);
  }

  const challengerMessagesSha = hashMessages(challengerMessages);
  const challengerBodySha = sha256(JSON.stringify(challengerBody));
  if (challengerMessagesSha === messagesSha) {
    throw new Error("challenger messages SHA unexpectedly matches baseline");
  }

  const proof = {
    SNAPSHOT_ID,
    CHARACTER_SHA: snapshot.CHARACTER_SHA,
    PERSONA_SHA: snapshot.PERSONA_SHA,
    SPEECH_LOCK_SHA: snapshot.SPEECH_LOCK_SHA,
    WORLD_CANON_SHA: snapshot.WORLD_CANON_SHA,
    SOURCE_ASSISTANT_SHA: EXPECTED.SOURCE_ASSISTANT_SHA,
    CURRENT_USER_SHA: EXPECTED.CURRENT_USER_SHA,
    SYSTEM_SHA: systemSha,
    HISTORY_SHA: historySha,
    FULL_PROMPT_SHA: fullPromptSha,
    BASELINE_MESSAGES_SHA: messagesSha,
    CHALLENGER_MESSAGES_SHA: challengerMessagesSha,
    BASELINE_BODY_SHA: baselineBodySha,
    CHALLENGER_BODY_SHA: challengerBodySha,
    TURN_OWNERSHIP_BLOCK_SHA: ownerBlockSha,
    ONLY_SEMANTIC_DIFFERENCE_PROVEN: diffProof.ONLY_SEMANTIC_DIFFERENCE_PROVEN,
    DIFF: "exactly one inserted owner block after unchanged system prefix",
    INSERTION: "messages[0] system += \\n\\n + exact TURN_OWNERSHIP_BLOCK",
    CHARACTER_UNCHANGED: true,
    PERSONA_UNCHANGED: true,
    SPEECH_LOCK_UNCHANGED: true,
    WORLD_CANON_UNCHANGED: true,
    HISTORY_UNCHANGED: true,
    CURRENT_USER_UNCHANGED: true,
    SOURCE_ASSISTANT_RAW_UNCHANGED: true,
    TRUE_OFF: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      absent: ["reasoning", "include_reasoning", "enable_thinking"],
    },
    QUALITY_SCORING_BY_CURSOR: false,
    SOURCE_MIRROR: false,
    COMPLETION: false,
    ORIGIN_POINTER: false,
    PRODUCTION_TURN_OWNERSHIP_ENABLED: false,
    PRODUCTION_TRUE_OFF_CHANGED: false,
  };
  save(DOCS, "PROMPT_DIFF.json", proof);
  save(ARTIFACTS, "PROMPT_DIFF.json", proof);

  console.log("[T1] reconstructed frozen F1 fixture", {
    BASELINE_MESSAGES_SHA: messagesSha,
    CHALLENGER_MESSAGES_SHA: challengerMessagesSha,
    TURN_OWNERSHIP_BLOCK_SHA: ownerBlockSha,
    ONLY_SEMANTIC_DIFFERENCE_PROVEN: proof.ONLY_SEMANTIC_DIFFERENCE_PROVEN,
    reconstructOnly,
  });

  writeReviewPacket({ proof, metrics: null, challenger: null });

  if (reconstructOnly) {
    save(DOCS, "RECONSTRUCT_ONLY.json", {
      reconstructOnly: true,
      challengerCalls: 0,
      ...proof,
    });
    return;
  }

  const challengerRuns: Array<{
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

  for (let i = 1; i <= 2; i += 1) {
    const body = JSON.parse(JSON.stringify(challengerBody)) as Record<string, unknown>;
    if (sha256(JSON.stringify(body)) !== challengerBodySha) {
      throw new Error("challenger fixture mutated before send");
    }
    console.log(`[T1] DeepSeek TRUE-OFF + Turn Ownership run ${i}`, {
      model: body.model,
      thinking: body.thinking,
      reasoning_effort: body.reasoning_effort,
      keys: requestBodyKeys(body),
    });
    const resp = await streamChat(body);
    if (resp.httpStatus >= 400 || !resp.text.trim()) {
      throw new Error(
        `Challenger run ${i} failed: status=${resp.httpStatus} chars=${resp.text.length}`
      );
    }
    const raw = resp.text;
    const late25 = lateQuarter(raw);
    save(DOCS, `CHALLENGER_RUN${i}_RAW.txt`, raw);
    save(DOCS, `CHALLENGER_RUN${i}_LATE25.txt`, late25);
    save(ARTIFACTS, `CHALLENGER_RUN${i}_RAW.txt`, raw);
    save(ARTIFACTS, `CHALLENGER_RUN${i}_LATE25.txt`, late25);
    challengerRuns.push({
      label: `CHALLENGER_${i}`,
      raw,
      late25,
      httpStatus: resp.httpStatus,
      finishReason: resp.finishReason,
      resolvedModel: resp.resolvedModel,
      latencyMs: resp.latencyMs,
      reasoning: resp.reasoning,
      usageReasoningTokens: usageReasoningTokens(resp.usageRaw),
      sentKeys: resp.sentKeys,
      bodySha: sha256(JSON.stringify(body)),
    });
  }

  const metrics = {
    SNAPSHOT_ID,
    CHARACTER: snapshot.character.name,
    PERSONA: snapshot.persona.name,
    BASE_MAIN: "b06037dd5c572bd02abec311f4148f57d9362551",
    FIXTURE: "Flood F1 frozen",
    BASELINE_REUSED: true,
    BASELINE_NEW_CALLS: 0,
    SOURCE_GEMINI_NEW_CALLS: 0,
    CHALLENGER_CALLS: 2,
    TOTAL_NEW_CALLS: 2,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    TARGET_PROVIDER: "cheaperinference",
    TARGET_ENDPOINT: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    TARGET_MODEL,
    TRUE_OFF: "thinking.disabled + reasoning_effort.none",
    REASONING_EVENTS: challengerRuns.map((run) => run.reasoning.reasoning_stream_events),
    REASONING_CHARS: challengerRuns.map((run) => run.reasoning.reasoning_chars),
    TURN_OWNERSHIP_BLOCK_SHA: ownerBlockSha,
    BASELINE_MESSAGES_SHA: messagesSha,
    CHALLENGER_MESSAGES_SHA: challengerMessagesSha,
    ONLY_SEMANTIC_DIFFERENCE_PROVEN: true,
    QUALITY_SCORING_BY_CURSOR: false,
    BLIND_REVIEW: false,
    SOURCE_MIRROR: false,
    COMPLETION: false,
    ORIGIN_POINTER: false,
    PRODUCTION_TURN_OWNERSHIP_ENABLED: false,
    PRODUCTION_TRUE_OFF_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    challenger: challengerRuns.map((run) => ({
      label: run.label,
      raw_sha: sha256(run.raw),
      chars: [...run.raw].length,
      late25_chars: [...run.late25].length,
      httpStatus: run.httpStatus,
      finishReason: run.finishReason,
      resolvedModel: run.resolvedModel,
      latencyMs: run.latencyMs,
      reasoning: run.reasoning,
      usage_reasoning_tokens_not_used_as_proof: run.usageReasoningTokens,
      sentKeys: run.sentKeys,
      bodySha: run.bodySha,
    })),
  };
  writeReviewPacket({
    proof,
    metrics,
    challenger: challengerRuns.map((run) => ({ raw: run.raw, late25: run.late25 })),
  });
  save(DOCS, "METRICS.json", metrics);
  save(DOCS, "TRANSPORT.json", {
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    model: TARGET_MODEL,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
    sent_keys: requestBodyKeys(challengerBody),
    absent_keys: ["enable_thinking", "reasoning", "include_reasoning"],
    reasoning_stream_events: metrics.REASONING_EVENTS,
    reasoning_chars: metrics.REASONING_CHARS,
  });
  save(ARTIFACTS, "METRICS.json", metrics);
  console.log("[T1] challenger complete", {
    http: challengerRuns.map((run) => run.httpStatus),
    reasoning_events: metrics.REASONING_EVENTS,
    reasoning_chars: metrics.REASONING_CHARS,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
