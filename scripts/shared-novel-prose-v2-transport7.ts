/**
 * Shared Novel Prose V2 — transport-1 experiment (7 calls).
 *
 * Luna A/B (2) + Gemini 3.6 Flash A/B (2) + DeepSeek A/B/C (3)
 * Production path: resolveSelectedAI → selectedAIProvider → transport routing.
 * No Muse. No retry/continuation/recovery/regenerate. Canary left OFF after run.
 */
import Module from "module";
import { createHash } from "crypto";
import { writeFileSync, readFileSync, mkdirSync, appendFileSync } from "fs";
import { performance } from "perf_hooks";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import {
  resolveProseStyleRouteName,
  resolveProseStyleSection,
} from "../src/lib/proseStyleResolver";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  resolveSelectedAI,
  selectedAIProvider,
  type SelectedAI,
} from "../src/lib/chatModels";
import { formatUserPersonaForPrompt } from "../src/lib/persona";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { streamOpenRouterAdult } from "../src/lib/openRouterAdult";
import { SHARED_NOVEL_PROSE_V2_ENV } from "../src/lib/sharedNovelProseV2Policy";
import {
  SNPV2_DEEPSEEK_LENGTH_ARM_ENV,
  type DeepSeekLengthArm,
} from "../src/lib/sharedNovelProseModelAdapters";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "../src/lib/cheaperInferenceConfig";
import {
  buildOpenRouterRequestBody,
  resolveOpenRouterMaxTokens,
  normalizeOpenRouterGenerationParams,
} from "../src/lib/openRouterClient";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "../src/lib/openRouterConfig";
import type { ChatMsg } from "../src/lib/ai";

const OUT_DIR = process.env.SCREENING_OUT_DIR || "data";
const FIXTURE_PATH =
  process.env.SNPV2_FIXTURE_PATH || "data/_tmp-snpv2-fixture.json";
const USER_ID = 1;
const F1_INPUT = "조용히 말한다. 「괜찮아. 오늘은 그쯤 해도 돼.」";

type CallSpec = {
  tag: string;
  selectedAIInput: string;
  proseArm: "legacy" | "v2";
  deepSeekLengthArm: DeepSeekLengthArm | null;
  label: string;
};

const ALL_CALLS: CallSpec[] = [
  {
    tag: "Luna-A",
    selectedAIInput: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    proseArm: "legacy",
    deepSeekLengthArm: null,
    label: "Luna",
  },
  {
    tag: "Luna-B",
    selectedAIInput: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    proseArm: "v2",
    deepSeekLengthArm: null,
    label: "Luna",
  },
  {
    tag: "Gemini-A",
    selectedAIInput: OPENROUTER_GEMINI_36_FLASH_MODEL,
    proseArm: "legacy",
    deepSeekLengthArm: null,
    label: "Gemini36Flash",
  },
  {
    tag: "Gemini-B",
    selectedAIInput: OPENROUTER_GEMINI_36_FLASH_MODEL,
    proseArm: "v2",
    deepSeekLengthArm: null,
    label: "Gemini36Flash",
  },
  {
    tag: "DeepSeek-A",
    selectedAIInput: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    proseArm: "v2",
    deepSeekLengthArm: "A",
    label: "DeepSeek",
  },
  {
    tag: "DeepSeek-B",
    selectedAIInput: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    proseArm: "v2",
    deepSeekLengthArm: "B",
    label: "DeepSeek",
  },
  {
    tag: "DeepSeek-C",
    selectedAIInput: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    proseArm: "v2",
    deepSeekLengthArm: "C",
    label: "DeepSeek",
  },
];

const ONLY = new Set(
  (process.env.SNPV2_TRANSPORT7_ONLY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const CALLS =
  ONLY.size > 0 ? ALL_CALLS.filter((c) => ONLY.has(c.tag)) : ALL_CALLS;
const MERGE_EXISTING = process.env.SNPV2_TRANSPORT7_MERGE === "1";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function setProseV2(on: boolean) {
  if (on) {
    process.env[SHARED_NOVEL_PROSE_V2_ENV.ENABLED] = "1";
    process.env[SHARED_NOVEL_PROSE_V2_ENV.USER_IDS] = String(USER_ID);
  } else {
    delete process.env[SHARED_NOVEL_PROSE_V2_ENV.ENABLED];
    delete process.env[SHARED_NOVEL_PROSE_V2_ENV.USER_IDS];
  }
}

function setDeepSeekArm(arm: DeepSeekLengthArm | null) {
  if (arm == null) delete process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
  else process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = arm;
}

function clearExperimentFlags() {
  setProseV2(false);
  setDeepSeekArm(null);
}

function normalizeForEcho(s: string): string {
  return s
    .replace(/[「」『』“”"'″′]/g, "")
    .replace(/[.,!?…·〜~\-—–]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function detectInputEcho(text: string, userInput: string): {
  inputEchoCandidate: boolean;
  echoedSpans: string[];
} {
  const normText = normalizeForEcho(text);
  const sentences = userInput
    .split(/[.。!?！？\n]/)
    .map((s) => s.trim())
    .filter((s) => normalizeForEcho(s).length >= 8);
  const echoedSpans: string[] = [];
  for (const s of sentences) {
    const n = normalizeForEcho(s);
    if (n.length >= 8 && normText.includes(n)) echoedSpans.push(s);
  }
  const compact = normalizeForEcho(userInput);
  if (compact.length >= 12 && normText.includes(compact)) {
    echoedSpans.push(userInput);
  }
  return { inputEchoCandidate: echoedSpans.length > 0, echoedSpans: [...new Set(echoedSpans)] };
}

function classifyDialogueSpeakers(text: string): {
  totalDialogueBlocks: number;
  byClass: Record<string, number>;
} {
  const blocks = text.match(/[「『"].+?[」』"]/gs) || [];
  const curly = text.match(/“[^”]+”/g) || [];
  const all = [...blocks, ...curly];
  const byClass: Record<string, number> = {
    main_character: 0,
    established_secondary_character: 0,
    new_npc: 0,
    system_broadcast: 0,
    unknown: 0,
  };
  for (const b of all) {
    const idx = text.indexOf(b);
    const before = text.slice(Math.max(0, idx - 80), idx);
    if (/방송|안내|시스템|경보/.test(before)) byClass.system_broadcast += 1;
    else if (/낯선|처음 보는|이름\s*없는|신입/.test(before)) byClass.new_npc += 1;
    else if (/라이크/.test(before)) byClass.main_character += 1;
    else if (/[가-힣]{2,8}(?:은|는|이|가)?\s*(?:짧게|낮게)?\s*(?:말했|물었|대답|중얼)/.test(before)) {
      byClass.established_secondary_character += 1;
    } else byClass.unknown += 1;
  }
  return { totalDialogueBlocks: all.length, byClass };
}

function detectNameKnowledgeContradiction(
  text: string,
  personaName: string
): boolean {
  if (!personaName || personaName.length < 1) return false;
  const called =
    text.includes(`「${personaName}`) ||
    text.includes(`『${personaName}`) ||
    new RegExp(`${personaName}\\s*(?:아|야|씨|님)`).test(text);
  const unknown =
    /이름을\s*(?:아직\s*)?(?:모르|듣지\s*못|몰라)|이름이\s*(?:뭐|뭔지)|성함이/.test(
      text
    );
  return called && unknown;
}

function detectFormatViolations(text: string): string[] {
  const hits: string[] = [];
  if (/\*[^*\n]{1,40}\*/.test(text)) hits.push("asterisk_aside");
  if (/\*\*[^*\n]+\*\*/.test(text)) hits.push("markdown_bold");
  if (/\bOOC\b|[\(（]\s*OOC/i.test(text)) hits.push("ooc");
  if (/^\s*\{[\s\S]*\}\s*$/m.test(text) && /"role"\s*:/.test(text)) hits.push("json");
  if (/\[(?:HP|MP|상태|STATUS|스탯)/i.test(text) || /```status/i.test(text)) {
    hits.push("status_widget_syntax");
  }
  if (/이 응답은|모델로서|AI로서|프롬프트/.test(text)) hits.push("meta_commentary");
  return hits;
}

function countUserBoundaryFollowups(text: string): {
  questionCount: number;
  newSuggestionCount: number;
  newNpcCount: number;
  newEventCount: number;
} {
  return {
    questionCount: (text.match(/[?？]/g) || []).length,
    newSuggestionCount: (text.match(/먹을래|별명|이름\s*뭐|같이\s*(?:갈|먹)|어때\?/g) || [])
      .length,
    newNpcCount: (text.match(/처음 보는|낯선\s*(?:남자|여자|인물)|이름없는/g) || [])
      .length,
    newEventCount: (
      text.match(/갑자기\s*(?:경보|폭발|습격|임무)|새로운\s*(?:위기|임무|비밀)/g) || []
    ).length,
  };
}

function measureMetrics(text: string, userInput: string, personaName: string) {
  const visibleChars = text.replace(/\s+/g, "").length;
  const echo = detectInputEcho(text, userInput);
  const speakers = classifyDialogueSpeakers(text);
  const emotionRepeat =
    (text.match(/괜찮아|그쯤|오늘은/g) || []).length >= 3
      ? (text.match(/괜찮아|그쯤|오늘은/g) || []).length
      : 0;
  return {
    visibleChars,
    contentCharsBeforeSanitize: text.length,
    visibleCharsAfterSanitize: visibleChars,
    ...echo,
    dialogueSpeakerClasses: speakers.byClass,
    totalDialogueBlocks: speakers.totalDialogueBlocks,
    nameKnowledgeContradiction: detectNameKnowledgeContradiction(text, personaName),
    userBoundary: countUserBoundaryFollowups(text),
    formatViolations: detectFormatViolations(text),
    emotionPhraseRepeatApprox: emotionRepeat,
    lengthBand:
      visibleChars < 1500
        ? "FAIL_SHORT"
        : visibleChars < 2500
          ? "CONDITIONAL"
          : visibleChars <= 3500
            ? "NORMAL"
            : visibleChars <= 4500
              ? "DENSE_REVIEW"
              : "VERBOSE_REGRESSION",
  };
}

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    characterRow: Record<string, unknown>;
    persona: {
      id: number;
      name: string;
      description: string;
      gender: string;
    };
    userNickname: string;
    greeting: string;
    targetResponseChars: number;
    userNote: string;
    memory: string;
    sourceChatId: number;
  };
}

function resolveTransport(resolved: SelectedAI): {
  transportProvider: "openrouter" | "cheaperinference";
  endpoint: string;
  endpointHost: string;
} {
  const provider = selectedAIProvider(resolved);
  if (provider === "cheaperinference") {
    return {
      transportProvider: "cheaperinference",
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      endpointHost: endpointHost(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL),
    };
  }
  return {
    transportProvider: "openrouter",
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    endpointHost: endpointHost(OPENROUTER_CHAT_COMPLETIONS_URL),
  };
}

function buildForCall(
  fixture: ReturnType<typeof loadFixture>,
  spec: CallSpec,
  resolved: SelectedAI
) {
  setProseV2(spec.proseArm === "v2");
  setDeepSeekArm(spec.deepSeekLengthArm);

  const transport = resolveTransport(resolved);
  const route = resolveProseStyleRouteName(USER_ID, resolved);
  const style = resolveProseStyleSection(USER_ID, resolved);

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    fixture.characterRow as never,
    fixture.persona.name,
    fixture.userNickname
  );
  const userPersona = formatUserPersonaForPrompt(
    fixture.persona.name,
    fixture.persona.description,
    fixture.userNickname
  );
  const history: ChatMsg[] = [
    { role: "assistant", content: fixture.greeting },
    { role: "user", content: F1_INPUT },
  ];
  const built = buildContext({
    charName: String(fixture.characterRow.name),
    chunks,
    userNickname: fixture.userNickname,
    userPersona,
    userNote: fixture.userNote,
    longTermMemory: fixture.memory,
    archiveMemory: null,
    shortTermHistory: [{ role: "assistant", content: fixture.greeting }],
    currentUserMessage: F1_INPUT,
    nsfw: !!fixture.characterRow.nsfw,
    gender:
      (fixture.characterRow.gender as "male" | "female" | "other") ?? "other",
    userId: USER_ID,
    chatId: fixture.sourceChatId,
    targetResponseChars: fixture.targetResponseChars,
    modelId: resolved,
    provider:
      transport.transportProvider === "cheaperinference"
        ? "openrouter"
        : transport.transportProvider,
    personaDisplayName: fixture.persona.name,
    userPersonaGender:
      (fixture.persona.gender as "male" | "female" | "other") ?? null,
    useEnglishCharacterPrompt: usedEnglish,
    contentKind:
      fixture.characterRow.content_kind === "simulation"
        ? "simulation"
        : "character",
  });

  const system = built.systemPrompt ?? "";
  const gen = normalizeOpenRouterGenerationParams(
    resolveOpenRouterMaxTokens(fixture.targetResponseChars, undefined, resolved),
    resolved,
    undefined,
    fixture.targetResponseChars
  );
  const requestBody = (() => {
    const base = buildOpenRouterRequestBody(
      resolved,
      [
        { role: "system", content: system },
        ...history,
      ],
      true,
      fixture.targetResponseChars
    );
    return transport.transportProvider === "cheaperinference"
      ? adaptCheaperInferenceChatBody(base as Record<string, unknown>)
      : base;
  })();

  return {
    system,
    history,
    route,
    styleOverride: style == null ? "LEGACY" : "OVERRIDE",
    immersiveCount: (system.match(/\[IMMERSIVE PROSE\]/g) || []).length,
    coreCount: (system.match(/\[NOVEL PROSE CORE — SHARED\]/g) || []).length,
    adapterPresent: system.includes("[DEEPSEEK LENGTH ADAPTER"),
    transport,
    generation: gen,
    requestBody,
    maxTokens: resolveOpenRouterMaxTokens(
      fixture.targetResponseChars,
      undefined,
      resolved
    ),
    characterFixtureHash: sha256(JSON.stringify(fixture.characterRow)),
    personaFixtureHash: sha256(JSON.stringify(fixture.persona)),
    historySha256: sha256(JSON.stringify(history)),
    currentUserInputSha256: sha256(F1_INPUT),
    systemPromptSha256: sha256(system),
    requestBodySha256: sha256(JSON.stringify(requestBody)),
  };
}

async function callOnce(
  resolved: SelectedAI,
  transportProvider: "openrouter" | "cheaperinference",
  system: string,
  history: ChatMsg[],
  targetResponseChars: number
) {
  const t0 = performance.now();
  const stream = streamOpenRouterAdult(
    system,
    history,
    resolved,
    targetResponseChars,
    {
      transportProvider,
      allowOpenRouterUnderLengthRecovery: false,
      allowEmptyStreamFallback: false,
    },
    {
      requestKind: "snpv2-transport7-primary",
      chargeTurnBudget: false,
    }
  );
  let text = "";
  let result = await stream.next();
  while (!result.done) {
    text += result.value;
    result = await stream.next();
  }
  const usage = result.value;
  return {
    text,
    usage,
    requestLatencyMs: Math.round(performance.now() - t0),
  };
}

function deepSeekTransportValidity(rec: {
  resolvedSelectedAI: string;
  transportProvider: string;
  endpointHost: string;
  requestModelId: string | null | undefined;
  responseModelId: string | null | undefined;
  finishReason: string | null | undefined;
}): "OK" | "TRANSPORT_INVALID" {
  if (rec.resolvedSelectedAI !== CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)
    return "TRANSPORT_INVALID";
  if (rec.transportProvider !== "cheaperinference") return "TRANSPORT_INVALID";
  if (rec.endpointHost !== "api.cheaperinference.com") return "TRANSPORT_INVALID";
  if (!rec.requestModelId) return "TRANSPORT_INVALID";
  if (!rec.responseModelId) return "TRANSPORT_INVALID";
  if (!rec.finishReason) return "TRANSPORT_INVALID";
  return "OK";
}

function sectionDiff(a: string, b: string): string {
  const aLines = new Set(a.split("\n"));
  const bLines = new Set(b.split("\n"));
  const onlyA = [...aLines].filter((l) => l.trim() && !bLines.has(l)).slice(0, 80);
  const onlyB = [...bLines].filter((l) => l.trim() && !aLines.has(l)).slice(0, 80);
  return [
    "=== SECTION DIFF (line-level, truncated) ===",
    `--- only in A (${onlyA.length} lines shown) ---`,
    ...onlyA,
    `+++ only in B (${onlyB.length} lines shown) +++`,
    ...onlyB,
  ].join("\n");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = loadFixture();
  const rawPath = `${OUT_DIR}/shared-novel-prose-v2-luna-gemini-deepseek-raw.txt`;
  const metaPath = `${OUT_DIR}/shared-novel-prose-v2-luna-gemini-deepseek-metadata.json`;
  const auditPath = `${OUT_DIR}/shared-novel-prose-v2-transport-audit.txt`;
  const dsReportPath = `${OUT_DIR}/shared-novel-prose-v2-deepseek-length-adapter-report.txt`;
  const diffPath = `${OUT_DIR}/shared-novel-prose-v2-section-diff.txt`;

  let records: Record<string, unknown>[] = [];
  const systems: Record<string, string> = {};

  if (MERGE_EXISTING) {
    try {
      const prev = JSON.parse(readFileSync(metaPath, "utf8")) as {
        records?: Record<string, unknown>[];
      };
      records = Array.isArray(prev.records) ? [...prev.records] : [];
    } catch {
      records = [];
    }
    appendFileSync(
      auditPath,
      `\n=== DEEPSEEK RERUN ${new Date().toISOString()} (no empty-stream fallback) ===\n`,
      "utf8"
    );
  } else {
    writeFileSync(rawPath, "", "utf8");
    writeFileSync(auditPath, "", "utf8");
  }

  console.log(
    JSON.stringify({
      phase: "transport-1",
      calls: CALLS.map((c) => c.tag),
      fixtureChat: fixture.sourceChatId,
      character: fixture.characterRow.name,
      persona: fixture.persona.name,
      input: F1_INPUT,
    })
  );

  for (const spec of CALLS) {
    clearExperimentFlags();
    const resolved = resolveSelectedAI(spec.selectedAIInput);
    const built = buildForCall(fixture, spec, resolved);
    systems[spec.tag] = built.system;

    let error: string | null = null;
    let text = "";
    let usage: Awaited<ReturnType<typeof callOnce>>["usage"] | null = null;
    let latency = 0;

    try {
      // Forbid OpenRouter DeepSeek legacy slug
      if (resolved === "deepseek/deepseek-v4-pro") {
        throw new Error("LEGACY_DEEPSEEK_SLUG_FORBIDDEN");
      }
      const out = await callOnce(
        resolved,
        built.transport.transportProvider,
        built.system,
        built.history,
        fixture.targetResponseChars
      );
      text = out.text;
      usage = out.usage;
      latency = out.requestLatencyMs;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const metrics = text
      ? measureMetrics(text, F1_INPUT, fixture.persona.name)
      : null;

    const requestModelId = resolved;
    const responseModelId = usage?.responseModelId ?? null;
    const finishReason = usage?.finishReason ?? null;
    const rawUsage = usage?.debugRawUsage ?? null;
    const reasoningPayload =
      built.requestBody &&
      typeof built.requestBody === "object" &&
      "reasoning" in (built.requestBody as object)
        ? (built.requestBody as { reasoning?: unknown }).reasoning ?? null
        : null;

    const baseRec = {
      tag: spec.tag,
      label: spec.label,
      proseArm: spec.proseArm,
      deepSeekLengthArm: spec.deepSeekLengthArm,
      selectedAIInput: spec.selectedAIInput,
      resolvedSelectedAI: resolved,
      transportProvider: built.transport.transportProvider,
      endpointHost: built.transport.endpointHost,
      endpoint: built.transport.endpoint,
      requestModelId,
      responseModelId,
      finishReason,
      maxTokens: built.maxTokens ?? null,
      maxCompletionTokens: null,
      reasoningPayload,
      temperature: built.generation.temperature ?? null,
      topP: built.generation.top_p ?? null,
      systemPromptSha256: built.systemPromptSha256,
      historySha256: built.historySha256,
      currentUserInputSha256: built.currentUserInputSha256,
      requestBodySha256: built.requestBodySha256,
      characterFixtureHash: built.characterFixtureHash,
      personaFixtureHash: built.personaFixtureHash,
      apiInputTokens: usage?.inputTokens ?? null,
      apiOutputTokens: usage?.outputTokens ?? null,
      reasoningTokens: usage?.reasoningOutputTokens ?? null,
      rawUsage,
      providerRequestId: usage?.providerRequestId ?? null,
      streamTerminalEvent: finishReason,
      requestLatencyMs: latency,
      contentCharsBeforeSanitize: metrics?.contentCharsBeforeSanitize ?? null,
      visibleCharsAfterSanitize: metrics?.visibleCharsAfterSanitize ?? null,
      route: built.route,
      styleOverride: built.styleOverride,
      immersiveCount: built.immersiveCount,
      coreCount: built.coreCount,
      adapterPresent: built.adapterPresent,
      metrics,
      error,
      apiCallCount: error ? 0 : 1,
      continuationCount: 0,
      recoveryContinuationCount: 0,
      regenerateCount: 0,
      supplement: false,
    };

    const transportStatus =
      spec.label === "DeepSeek"
        ? deepSeekTransportValidity(baseRec)
        : "N/A";

    const record = { ...baseRec, transportStatus };
    const existingIdx = records.findIndex((r) => r.tag === spec.tag);
    if (existingIdx >= 0) records[existingIdx] = record;
    else records.push(record);

    appendFileSync(
      auditPath,
      [
        `===== ${spec.tag} =====`,
        `selectedAIInput=${spec.selectedAIInput}`,
        `resolvedSelectedAI=${resolved}`,
        `transportProvider=${built.transport.transportProvider}`,
        `endpointHost=${built.transport.endpointHost}`,
        `requestModelId=${requestModelId}`,
        `responseModelId=${responseModelId ?? "(missing)"}`,
        `finishReason=${finishReason ?? "(missing)"}`,
        `transportStatus=${transportStatus}`,
        `visibleChars=${metrics?.visibleChars ?? 0}`,
        `error=${error ?? ""}`,
        "",
      ].join("\n"),
      "utf8"
    );

    appendFileSync(
      rawPath,
      [
        `===== ${spec.tag} (${spec.label} prose=${spec.proseArm}` +
          (spec.deepSeekLengthArm
            ? ` dsLength=${spec.deepSeekLengthArm}`
            : "") +
          `) =====`,
        `endpoint=${built.transport.endpointHost} model=${resolved} responseModel=${responseModelId ?? "?"}`,
        `finishReason=${finishReason ?? "?"} chars=${metrics?.visibleChars ?? 0}`,
        error ? `ERROR: ${error}` : text || "(empty)",
        "",
        "",
      ].join("\n"),
      "utf8"
    );

    console.log(
      JSON.stringify({
        done: spec.tag,
        transportStatus,
        chars: metrics?.visibleChars ?? 0,
        finishReason,
        error,
      })
    );
  }

  clearExperimentFlags();

  // Parity checks
  const parityNotes: string[] = [];
  function checkPair(aTag: string, bTag: string) {
    const a = records.find((r) => r.tag === aTag) as Record<string, unknown> | undefined;
    const b = records.find((r) => r.tag === bTag) as Record<string, unknown> | undefined;
    if (!a || !b) return;
    const sameKeys = [
      "historySha256",
      "currentUserInputSha256",
      "characterFixtureHash",
      "personaFixtureHash",
      "resolvedSelectedAI",
      "transportProvider",
      "endpointHost",
      "temperature",
      "topP",
      "maxTokens",
    ] as const;
    const mismatches: string[] = [];
    for (const k of sameKeys) {
      if (a[k] !== b[k]) mismatches.push(`${k}: ${a[k]} vs ${b[k]}`);
    }
    const aiA = Number(a.apiInputTokens) || 0;
    const aiB = Number(b.apiInputTokens) || 0;
    let pairStatus = mismatches.length ? "PAIR_MISMATCH" : "PAIR_OK";
    if (aiA > 0 && aiB > 0) {
      const delta = Math.abs(aiA - aiB) / Math.max(aiA, aiB);
      if (delta > 0.05) pairStatus = "PAIR_INVALID";
    }
    parityNotes.push(
      `${aTag}/${bTag}: ${pairStatus}` +
        (mismatches.length ? ` | ${mismatches.join("; ")}` : "") +
        ` | inputTokens ${aiA} vs ${aiB}`
    );
    a.pairStatus = pairStatus;
    b.pairStatus = pairStatus;
  }
  checkPair("Luna-A", "Luna-B");
  checkPair("Gemini-A", "Gemini-B");
  checkPair("DeepSeek-A", "DeepSeek-B");
  checkPair("DeepSeek-A", "DeepSeek-C");

  // Section diffs
  const diffs: string[] = [];
  diffs.push(sectionDiff(systems["Luna-A"] || "", systems["Luna-B"] || ""));
  diffs.push("\n\n===== Gemini A vs B =====\n");
  diffs.push(sectionDiff(systems["Gemini-A"] || "", systems["Gemini-B"] || ""));
  diffs.push("\n\n===== DeepSeek A vs B =====\n");
  diffs.push(sectionDiff(systems["DeepSeek-A"] || "", systems["DeepSeek-B"] || ""));
  diffs.push("\n\n===== DeepSeek A vs C =====\n");
  diffs.push(sectionDiff(systems["DeepSeek-A"] || "", systems["DeepSeek-C"] || ""));
  writeFileSync(diffPath, diffs.join("\n"), "utf8");

  // DeepSeek length adapter report (mechanics only — no literary verdict)
  const ds = ["DeepSeek-A", "DeepSeek-B", "DeepSeek-C"].map(
    (t) => records.find((r) => r.tag === t) as Record<string, unknown>
  );
  const dsReport = [
    "Shared Novel Prose V2 — DeepSeek length adapter report (mechanics)",
    "Literary quality is NOT judged here.",
    "",
    ...ds.map((r) => {
      const m = r?.metrics as { visibleChars?: number; lengthBand?: string } | null;
      return [
        `${r?.tag}: transport=${r?.transportStatus}`,
        `  chars=${m?.visibleChars ?? 0} band=${m?.lengthBand ?? "n/a"}`,
        `  finish=${r?.finishReason} responseModel=${r?.responseModelId}`,
        `  adapterPresent=${r?.adapterPresent} error=${r?.error ?? ""}`,
      ].join("\n");
    }),
    "",
    "Arm comparison (length / scene-progress proxies only):",
    (() => {
      const chars = ds.map(
        (r) =>
          ((r?.metrics as { visibleChars?: number } | null)?.visibleChars as number) ||
          0
      );
      return `A=${chars[0]} B=${chars[1]} C=${chars[2]} | B>A length? ${chars[1]! > chars[0]!} | C>B length? ${chars[2]! > chars[1]!}`;
    })(),
    "",
    "Adapter adoption: Arm B is a candidate only if length/scene progress increase",
    "without NPC/event/question spam — human review of raw file required.",
    "Arm C is comparison-only; not a production candidate by default.",
  ].join("\n");
  writeFileSync(dsReportPath, dsReport + "\n", "utf8");

  appendFileSync(auditPath, "\n=== PAIRITY ===\n" + parityNotes.join("\n") + "\n", "utf8");

  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        phase: "transport-1",
        generatedAt: new Date().toISOString(),
        fixture: {
          sourceChatId: fixture.sourceChatId,
          character: fixture.characterRow.name,
          persona: fixture.persona.name,
          input: F1_INPUT,
        },
        parityNotes,
        records,
        flagsAfterRun: {
          SHARED_NOVEL_PROSE_V2_ENABLED: process.env.SHARED_NOVEL_PROSE_V2_ENABLED ?? null,
          SNPV2_DEEPSEEK_LENGTH_ARM:
            process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] ?? null,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify({
      wrote: [rawPath, metaPath, auditPath, dsReportPath, diffPath],
      parityNotes,
      deepSeek: ds.map((r) => ({
        tag: r?.tag,
        transportStatus: r?.transportStatus,
        chars: (r?.metrics as { visibleChars?: number } | null)?.visibleChars,
      })),
    })
  );
}

main().catch((e) => {
  clearExperimentFlags();
  console.error(e);
  process.exit(1);
});
