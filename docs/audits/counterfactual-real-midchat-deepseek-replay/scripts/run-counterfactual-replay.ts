#!/usr/bin/env npx tsx
/**
 * Counterfactual real mid-chat DeepSeek style transport replay (#620 frozen evidence).
 * Evidence only — no production code changes. One DeepSeek V4 Pro 0813 call if transport gate passes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BENCHMARK620 = join(
  ROOT,
  "docs/audits/real-production-mid-chat-style-handoff-benchmark"
);
const OUT = join(ROOT, "docs/audits/counterfactual-real-midchat-deepseek-replay");
const CAPSULE_PATH = process.env.CAPSULE_PATH ?? join(ROOT, "handoff-benchmark-capsule.json");
const DEEPSEEK_MODEL = "deepseek-v4-pro-0813";
const PRIMARY_MEDIAN_VISIBLE_CHARS = 3323;
const T3_GEMINI_GOLD_VISIBLE_CHARS = 2651;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(text: string): string {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function save(rel: string, content: string | object) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function readBenchmarkRaw(name: string): string {
  return readFileSync(join(BENCHMARK620, "raw", name), "utf8");
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function paragraphs(text: string) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string) {
  return /["“”「」『』]/.test(p) || /^(?:[“"]|[가-힣A-Za-z].{0,12}[:：])/.test(p);
}

function median(nums: number[]) {
  const a = [...nums].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function objectiveMetrics(text: string) {
  const paras = paragraphs(text);
  const dialogueParas = paras.filter(isDialogueParagraph);
  const narrationParas = paras.filter((p) => !isDialogueParagraph(p));
  const chars = String(text || "").length;
  const dialogueBlocks = dialogueParas.length;
  return {
    VISIBLE_CHARS: chars,
    PARAGRAPH_COUNT: paras.length,
    DIALOGUE_BLOCKS: dialogueBlocks,
    DIALOGUE_BLOCKS_PER_1000_CHARS:
      chars === 0 ? 0 : Number(((dialogueBlocks / chars) * 1000).toFixed(3)),
    DIALOGUE_PARAGRAPH_RATIO:
      paras.length === 0 ? 0 : Number((dialogueBlocks / paras.length).toFixed(3)),
    MAX_CONSECUTIVE_DIALOGUE: maxConsecutiveDialogue(paras),
    MEDIAN_PARAGRAPH_CHARS: median(paras.map((p) => p.length)),
    MEDIAN_NARRATION_PARAGRAPH_CHARS: median(narrationParas.map((p) => p.length)),
    MEDIAN_DIALOGUE_PARAGRAPH_CHARS: median(dialogueParas.map((p) => p.length)),
  };
}

function maxConsecutiveDialogue(paras: string[]) {
  let max = 0;
  let cur = 0;
  for (const p of paras) {
    if (isDialogueParagraph(p)) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function alarmCandidates(text: string, finishReason?: string | null) {
  const t = String(text || "");
  return {
    META_LEAK: /(?:SYSTEM|SceneMode|routeTrigger|INTERNAL|OOC:)/i.test(t),
    EMPTY_OUTPUT: !t.trim(),
    TRUNCATION: /content[_ -]?filter|length|max_tokens|truncated/i.test(
      String(finishReason || "")
    ),
    NEW_USER_DIALOGUE_CANDIDATE: /(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(t),
    NEW_USER_ACTION_CANDIDATE: /(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(t),
    CANON_CONTRADICTION_CANDIDATE: /(?:미성년|고등학생|17살|18살 미만)/.test(t),
    REPETITION_CANDIDATE: (() => {
      const paras = paragraphs(t);
      const uniq = new Set(paras.map((p) => p.slice(0, 80)));
      return paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5);
    })(),
    TURN_ENDING_USER_CHECKPOINT_CANDIDATE: /(?:눈을\s*마주|이대로\s*조금만|잠깐만)/.test(
      t.slice(-400)
    ),
    REQUESTED_PROGRESSION_COMPLETED:
      /(?:삽입|성교|오르가슴|절정|사정|끝까지)/.test(t) && t.length > 200,
  };
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "object" && b && "text" in b ? String(b.text) : "")).join("");
  }
  return "";
}

function findExemplarInMessages(
  messages: Array<{ role?: string; content?: unknown }>,
  sourceVisible: string,
  label: string
) {
  const src = String(sourceVisible || "");
  const srcNorm = normalizeWs(src);
  let best: { index: number; role: string; content: string } | null = null;
  for (let i = 0; i < messages.length; i++) {
    const content = flattenMessageContent(messages[i]?.content);
    if (!content) continue;
    if (
      content.includes(src.slice(0, 80)) ||
      normalizeWs(content).includes(srcNorm.slice(0, 80))
    ) {
      best = { index: i, role: messages[i]?.role || "unknown", content };
      break;
    }
    if (
      srcNorm.length > 100 &&
      normalizeWs(content).includes(srcNorm.slice(0, Math.min(200, srcNorm.length)))
    ) {
      best = { index: i, role: messages[i]?.role || "unknown", content };
      break;
    }
  }
  if (!best) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.role !== "assistant") continue;
      const content = flattenMessageContent(messages[i]?.content);
      if (content.length > 100 && src.startsWith(content.slice(0, 50))) {
        best = { index: i, role: "assistant", content };
        break;
      }
    }
  }
  if (!best) {
    return {
      label,
      present: false,
      ROLE: null,
      WIRE_POSITION: null,
      SOURCE_CHARS: src.length,
      TRANSPORTED_CHARS: 0,
      BYTE_IDENTICAL: false,
      WHITESPACE_NORMALIZED_EQUIVALENT: false,
      TRUNCATED: false,
      TRANSFORMED: false,
    };
  }
  const transported = best.content;
  const byteIdentical = transported === src;
  const wsEq = normalizeWs(transported) === srcNorm;
  const truncated = transported.length < src.length && src.startsWith(transported);
  return {
    label,
    present: true,
    ROLE: best.role,
    WIRE_POSITION: best.index,
    SOURCE_CHARS: src.length,
    TRANSPORTED_CHARS: transported.length,
    BYTE_IDENTICAL: byteIdentical,
    WHITESPACE_NORMALIZED_EQUIVALENT: wsEq,
    TRUNCATED: truncated,
    TRANSFORMED: !byteIdentical && !wsEq,
  };
}

function buildRoleOrderMap(messages: Array<{ role?: string; content?: unknown }>) {
  return messages.map((m, index) => {
    const content = flattenMessageContent(m.content);
    const preview = content.slice(0, 40).replace(/\s+/g, " ");
    let semantic_source = "unknown";
    if (m.role === "system") semantic_source = "system";
    else if (m.role === "assistant" && index <= 2) semantic_source = "opening_or_early_assistant";
    else if (m.role === "user" && content.includes("[채팅 시작]")) semantic_source = "opening_user_marker";
    else if (m.role === "user") semantic_source = "user_turn";
    else if (m.role === "assistant") semantic_source = "primary_assistant_persisted_visible";
    return { index, role: m.role ?? "unknown", semantic_source, preview };
  });
}

function activeOwnersFromTrackedSections(
  sections: Array<{ id?: string; label?: string; category?: string; text?: string }>
) {
  const OWNER_SOURCE: Record<string, string> = {
    "rule-terminal-length-override": "src/lib/responseLength.ts — USER_TAIL_LENGTH_OWNER / terminal length",
    "rule-user-tail-length": "src/lib/responseLength.ts — appendCompactTerminalLengthToUserTurn",
    "rule-webnovel-layout": "src/lib/webnovelOutputFormat.ts — compact terminal layout recency",
    "rule-adult-prose": "src/lib/advancedProseNsfwGuidelines.ts",
    "rule-no-godmodding": "src/lib/noGodmodding.ts — user agency",
    "rule-scene-continuity": "src/lib/adultSceneRouting.ts — SceneContinuityPacket + DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
    "handoff-continuation": "src/lib/adultSceneRouting.ts — DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
  };
  return sections
    .filter((s) => String(s.text || "").trim())
    .map((s, position) => ({
      OWNER: s.label || s.id || `section_${position}`,
      SOURCE_FILE_FUNCTION: OWNER_SOURCE[s.id ?? ""] ?? "src/services/contextBuilder.ts — tracked section",
      ROLE: "system",
      POSITION: position,
      CATEGORY: categorizeOwner(String(s.label || s.id || "")),
    }));
}

function categorizeOwner(label: string) {
  if (/length|3200|USER_TAIL/i.test(label)) return "LENGTH";
  if (/dialogue|speech|말투|terminal dialogue/i.test(label)) return "DIALOGUE";
  if (/agency|user control|godmod/i.test(label)) return "AGENCY";
  if (/scene|continuity|SCP|handoff/i.test(label)) return "SCENE_STATE";
  if (/layout|지문/i.test(label)) return "LAYOUT";
  if (/adult|nsfw|intimacy/i.test(label)) return "ADULT_PROSE";
  if (/style|prose|novel/i.test(label)) return "STYLE";
  return "OTHER";
}

function goldPresentInMessages(messages: Array<{ content?: unknown }>, gold: string) {
  const snippet = gold.slice(0, 120);
  return messages.some((m) => flattenMessageContent(m.content).includes(snippet));
}

function creatorOpeningPresent(messages: Array<{ role?: string; content?: unknown }>, opening: string) {
  const snippet = opening.slice(0, 80);
  return messages.some(
    (m) => m.role === "assistant" && flattenMessageContent(m.content).includes(snippet)
  );
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
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
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof (choice0?.message as Record<string, unknown> | undefined)?.content === "string"
        ? String((choice0!.message as Record<string, unknown>).content)
        : "";
  if (content) state.text += content;
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

function processSseChunk(chunk: string, state: StreamState, buf: { value: string }): void {
  buf.value += chunk;
  const parts = buf.value.split("\n");
  buf.value = parts.pop() ?? "";
  for (const line of parts) processSseLine(line, state);
}

function flushRemainingSseBuffer(
  dec: TextDecoder,
  buf: { value: string },
  state: StreamState
): void {
  const tail = dec.decode();
  if (tail) buf.value += tail;
  if (buf.value.trim()) {
    processSseLine(buf.value, state);
    buf.value = "";
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{
  text: string;
  finish_reason: string | null;
  usage: Record<string, unknown> | null;
  http_status: number;
  error?: string;
}> {
  const state: StreamState = { text: "", finish: null, usage: null, sawDone: false };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      return {
        text: "",
        finish_reason: null,
        usage: null,
        http_status: res.status,
        error: (await res.text()).slice(0, 2000),
      };
    }
    const rawBody = await res.text();
    for (const line of rawBody.split(/\r?\n/)) {
      processSseLine(line, state);
    }
    return {
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      http_status: res.status,
    };
  } catch (e) {
    return {
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      http_status: 0,
      error: String(e),
    };
  }
}

function loadCapsuleFixture() {
  if (!existsSync(CAPSULE_PATH)) throw new Error(`missing capsule ${CAPSULE_PATH}`);
  const capsule = JSON.parse(readFileSync(CAPSULE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    benchmark_user_context?: { nickname?: string; is_adult?: number };
  };
  return {
    character: capsule.character,
    persona: capsule.persona,
    user: {
      nickname: capsule.benchmark_user_context?.nickname ?? "공식계정",
      is_adult: capsule.benchmark_user_context?.is_adult ?? 1,
      id: 4,
    },
  };
}

async function assembleCounterfactualWire() {
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../../../../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import("../../../../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../../../../src/lib/chatGreetingContext");
  const { buildContext } = await import("../../../../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../../../../src/lib/openRouterAdult");
  const {
    appendAdultHandoffPrompt,
    appendAdultHandoffToSystemSplit,
    buildSceneContinuityPacket,
    classifySceneMode,
    extractHandoffContinuityFromAssistantText,
    normalizeAdultDialogueProfile,
    resolveAdultRoutingConfig,
    selectAdultHandoffRawVariants,
    DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  } = await import("../../../../src/lib/adultSceneRouting");
  const { resolveNarrativePov } = await import("../../../../src/lib/narrativePov");
  const { isCheaperInferenceModel } = await import("../../../../src/lib/chatModels");
  const { resolveCanonInjectionPolicy } = await import("../../../../src/lib/canonInjectionPolicy");
  const { resolveCharacterGender } = await import("../../../../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../../../../src/lib/characterGenres");
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../../../../src/lib/responseLength");

  const fixture = loadCapsuleFixture();
  const ch = fixture.character;
  const persona = fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const charName = String(ch.name ?? "라이크");

  const openingVisible = readBenchmarkRaw("OPENING_ASSISTANT_VISIBLE.txt");
  const t1User = readBenchmarkRaw("T1-USER_RAW.txt");
  const t1Visible = readBenchmarkRaw("T1-ASSISTANT_PERSISTED_VISIBLE.txt");
  const t2User = readBenchmarkRaw("T2-USER_RAW.txt");
  const t2Visible = readBenchmarkRaw("T2-ASSISTANT_PERSISTED_VISIBLE.txt");
  const t3User = readBenchmarkRaw("T3-USER_RAW.txt");
  const t3Gold = readBenchmarkRaw("T3-ASSISTANT_PERSISTED_VISIBLE.txt");

  const canonicalRecentHistoryFull: ChatMsg[] = [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: openingVisible },
    { role: "user", content: t1User },
    { role: "assistant", content: t1Visible },
    { role: "user", content: t2User },
    { role: "assistant", content: t2Visible },
  ];

  const adultRoutingConfig = resolveAdultRoutingConfig();
  const fallbackVariants = selectAdultHandoffRawVariants(canonicalRecentHistoryFull, {
    baseExchanges: adultRoutingConfig.baseRawExchanges,
    targetExchanges: adultRoutingConfig.handoffTargetRawExchanges,
    extraRawTokens: adultRoutingConfig.handoffExtraRawTokens,
  });
  const fallbackRaw = fallbackVariants.handoff;
  const fallbackHistory = fallbackRaw.history;

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: charName,
  });

  const adultDialogueProfile = normalizeAdultDialogueProfile(ch.adult_dialogue_profile);
  const sceneClassification = classifySceneMode({
    currentInput: t3User,
    previousSceneMode: "romantic",
    recentRawText: [t2User, t2Visible].join("\n"),
    adultDialogueProfile,
    activeConsentMode: "standard",
    previousConsentMode: "standard",
  });

  const extractedHandoffContinuity = extractHandoffContinuityFromAssistantText({
    text: t2Visible,
    characterName: charName,
    personaName,
    currentUserText: t3User,
  });

  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: sceneClassification.sceneReset ? "normal" : "romantic",
    sexualContextActive: sceneClassification.sexualContextActive,
    activeConsentMode: "standard",
    charactersPresent: [charName, personaName],
    currentPov: narrativePov.mode,
    sceneReset: sceneClassification.sceneReset,
    ...(sceneClassification.sceneReset ? {} : extractedHandoffContinuity),
  });

  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id ?? 10),
      name: charName,
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(fixture.user.nickname ?? personaName)
  );

  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  const canonInjectionPolicy = resolveCanonInjectionPolicy(DEEPSEEK_MODEL, {
    userId: Number(fixture.user.id),
    chatId: 4,
  });

  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));

  const built = buildContext({
    charName,
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    archiveMemory: "",
    shortTermHistory: fallbackHistory,
    currentUserMessage: t3User,
    nsfw: true,
    activeConsentMode: "standard",
    gender: resolveCharacterGender(String(ch.gender ?? "")),
    memoryMeta: "",
    modelId: DEEPSEEK_MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 3,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id),
    chatId: 4,
    narrativePov,
    preserveAdultHandoffRawHistory: true,
    adultHandoffRequiredTurnFloor: fallbackRaw.rawTurnsIncluded,
    canonInjectionPolicy,
    genres,
    userPersonaGender: (persona.gender as "male" | "female" | "other") ?? "other",
  });

  let systemPrompt = built.systemPrompt;
  let systemSplit = built.openRouterSystemSplit;
  systemPrompt = appendAdultHandoffPrompt(systemPrompt, continuityPacket);
  systemSplit = appendAdultHandoffToSystemSplit(systemSplit, continuityPacket);

  const transportProvider = isCheaperInferenceModel(DEEPSEEK_MODEL)
    ? ("cheaperinference" as const)
    : ("openrouter" as const);

  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: DEEPSEEK_MODEL,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider,
      charName,
      personaName,
    },
  });

  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };

  const wireMessages = (requestBody.messages as Array<{ role: string; content: unknown }>) ?? [];

  const userTail = flattenMessageContent(wireMessages.at(-1)?.content ?? "");
  const ownerExtras: Array<{
    OWNER: string;
    SOURCE_FILE_FUNCTION: string;
    ROLE: string;
    POSITION: number;
    CATEGORY: string;
  }> = [];

  if (systemPrompt.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION)) {
    ownerExtras.push({
      OWNER: "DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
      SOURCE_FILE_FUNCTION: "src/lib/adultSceneRouting.ts — appendAdultHandoffPrompt",
      ROLE: "system",
      POSITION: -1,
      CATEGORY: "SCENE_STATE",
    });
  }
  if (userTail.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40))) {
    ownerExtras.push({
      OWNER: "USER_TAIL_3200_OWNER",
      SOURCE_FILE_FUNCTION: "src/lib/responseLength.ts — appendCompactTerminalLengthToUserTurn",
      ROLE: "user",
      POSITION: wireMessages.length - 1,
      CATEGORY: "LENGTH",
    });
  }

  const trackedOwners = activeOwnersFromTrackedSections(built.meta.trackedSections ?? []);

  return {
    wire,
    requestBody,
    wireMessages,
    systemPrompt,
    built,
    continuityPacket,
    sceneClassification,
    fallbackVariants,
    frozen: {
      openingVisible,
      t1User,
      t1Visible,
      t2User,
      t2Visible,
      t3User,
      t3Gold,
    },
    transportProvider,
    activeOwners: [...trackedOwners, ...ownerExtras],
    charName,
    personaName,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  save("README.md", `# Counterfactual real mid-chat DeepSeek replay\n\nSource frozen evidence: PR #620 / \`real-production-mid-chat-style-handoff-benchmark\`.\nCounterfactual: qualifying pre-visible primary refusal assumed; **no** refusal text in history; **no** T3 Gemini in DeepSeek input.\n`);

  const assembled = await assembleCounterfactualWire();
  const {
    requestBody,
    wireMessages,
    frozen,
    wire,
    activeOwners,
    continuityPacket,
    fallbackVariants,
  } = assembled;

  save("requests/COUNTERFACTUAL_DEEPSEEK-input.json", requestBody);
  save("meta/counterfactual-continuity-packet.json", continuityPacket);
  save("meta/handoff-raw-variants.json", fallbackVariants);

  const t1Exemplar = findExemplarInMessages(wireMessages, frozen.t1Visible, "T1");
  const t2Exemplar = findExemplarInMessages(wireMessages, frozen.t2Visible, "T2");
  const goldInContext = goldPresentInMessages(wireMessages, frozen.t3Gold);
  const creatorOpening = creatorOpeningPresent(wireMessages, frozen.openingVisible);

  const recentPrimary = wireMessages.filter((m) => m.role === "assistant");
  const recentPrimaryChars = recentPrimary.reduce(
    (n, m) => n + flattenMessageContent(m.content).length,
    0
  );

  const transportGatePass =
    t1Exemplar.present && t2Exemplar.present && !goldInContext;

  const transportTrace = {
    TRANSPORT_GATE_PASS: transportGatePass,
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1Exemplar.present,
    T1: t1Exemplar,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2Exemplar.present,
    T2: t2Exemplar,
    RECENT_PRIMARY_ASSISTANT_MESSAGES_IN_FALLBACK: recentPrimary.length,
    RECENT_PRIMARY_ASSISTANT_CHARS_IN_FALLBACK: recentPrimaryChars,
    CREATOR_OPENING_PRESENT: creatorOpening,
    T3_GEMINI_GOLD_PRESENT_IN_FALLBACK_CONTEXT: goldInContext,
    GEMINI_REFUSAL_PRESENT_IN_FALLBACK_CONTEXT: false,
    role_order_map: buildRoleOrderMap(wireMessages),
  };
  save("meta/transport-gate.json", transportTrace);
  save("meta/active-owner-map.json", { active: activeOwners });

  save(
    "raw/COUNTERFACTUAL_DEEPSEEK_REQUEST.sha256",
    sha256(JSON.stringify(requestBody))
  );

  let deepseekVisible = "";
  let providerRaw = "";
  let finishReason: string | null = null;
  let deepseekCalls = 0;

  if (!transportGatePass) {
    save("meta/STOP.json", {
      reason: "TRANSPORT_GATE_FAIL",
      transportTrace,
    });
    console.log(JSON.stringify({ TRANSPORT_GATE_PASS: false }, null, 2));
    process.exit(2);
  }

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../../../../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../../../../src/lib/chatDisplayLength"
  );
  const { sanitizeStreamArtifacts } = await import(
    "../../../../src/lib/responseLength"
  );
  const { stripRpMetaLeakage } = await import("../../../../src/lib/narrativeRules");
  const { stripInternalTagLeakage } = await import("../../../../src/lib/narrativeRules");

  console.log("Transport gate PASS — single DeepSeek V4 Pro 0813 call");
  deepseekCalls = 1;
  const resp = await streamProvider(
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders(),
    requestBody
  );

  if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
    save("meta/STOP.json", { reason: "DEEPSEEK_CALL_FAIL", resp });
    throw new Error(`DeepSeek call failed: ${resp.error ?? resp.http_status}`);
  }

  providerRaw = resp.text;
  finishReason = resp.finish_reason;
  let merged = sanitizeStreamArtifacts(providerRaw);
  merged = stripRpMetaLeakage(merged);
  merged = stripInternalTagLeakage(merged);
  deepseekVisible = merged.trim();
  const persistedEquivalentChars = visibleAssistantDisplayCharCount(deepseekVisible);

  save("raw/COUNTERFACTUAL_DEEPSEEK_PROVIDER_RAW.txt", providerRaw);
  save("raw/COUNTERFACTUAL_DEEPSEEK_PERSISTED_EQUIVALENT.txt", deepseekVisible);
  save(
    "meta/COUNTERFACTUAL_DEEPSEEK-provider.json",
    {
      model: DEEPSEEK_MODEL,
      finishReason,
      provider_raw_chars: providerRaw.length,
      persisted_equivalent_chars: persistedEquivalentChars,
      request_sha: sha256(JSON.stringify(requestBody)),
      provider_raw_sha: sha256(providerRaw),
      persisted_visible_sha: sha256(deepseekVisible),
      usage: resp.usage,
      http_status: resp.http_status,
    }
  );

  const dsMetrics = objectiveMetrics(deepseekVisible);
  const goldMetrics = objectiveMetrics(frozen.t3Gold);
  const alarms = alarmCandidates(deepseekVisible, finishReason);

  const compact = {
    TRANSPORT_GATE_PASS: true,
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1Exemplar.present,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2Exemplar.present,
    RECENT_PRIMARY_ASSISTANT_MESSAGES_IN_FALLBACK: recentPrimary.length,
    RECENT_PRIMARY_ASSISTANT_CHARS_IN_FALLBACK: recentPrimaryChars,
    CREATOR_OPENING_PRESENT: creatorOpening,
    T3_GEMINI_GOLD_PRESENT_IN_FALLBACK_CONTEXT: goldInContext,
    GEMINI_REFUSAL_PRESENT_IN_FALLBACK_CONTEXT: false,
    DEEPSEEK_PROVIDER_CALLS: deepseekCalls,
    TOTAL_PROVIDER_CALLS_THIS_EXPERIMENT: deepseekCalls,
    PRIMARY_MEDIAN_VISIBLE_CHARS: PRIMARY_MEDIAN_VISIBLE_CHARS,
    T3_GEMINI_GOLD_VISIBLE_CHARS: T3_GEMINI_GOLD_VISIBLE_CHARS,
    T3_DEEPSEEK_VISIBLE_CHARS: dsMetrics.VISIBLE_CHARS,
    DEEPSEEK_VS_PRIMARY_LENGTH_RATIO: Number(
      (dsMetrics.VISIBLE_CHARS / PRIMARY_MEDIAN_VISIBLE_CHARS).toFixed(4)
    ),
    DEEPSEEK_VS_GEMINI_GOLD_LENGTH_RATIO: Number(
      (dsMetrics.VISIBLE_CHARS / T3_GEMINI_GOLD_VISIBLE_CHARS).toFixed(4)
    ),
    metrics: {
      T1_PRIMARY: objectiveMetrics(frozen.t1Visible),
      T2_PRIMARY: objectiveMetrics(frozen.t2Visible),
      T3_GEMINI_GOLD: goldMetrics,
      T3_DEEPSEEK_COUNTERFACTUAL: dsMetrics,
    },
    alarms: {
      T3_DEEPSEEK_COUNTERFACTUAL: alarms,
    },
    counterfactual_note:
      "Qualifying pre-visible primary refusal assumed; no refusal prose in history; T3 Gemini gold excluded from wire",
    source_benchmark_pr: 620,
    production_code_changed: false,
  };

  save("COMPACT_REPORT.json", compact);
  save("INDEX.json", {
    audit: "counterfactual-real-midchat-deepseek-replay",
    source: BENCHMARK620,
    transport_gate: transportTrace,
    compact: "COMPACT_REPORT.json",
  });

  console.log(JSON.stringify(compact, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
