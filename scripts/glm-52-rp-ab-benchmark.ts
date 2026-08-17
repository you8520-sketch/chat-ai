/**
 * GLM-5.2 Korean long-form RP A/B benchmark (experiment-only).
 *
 * Does NOT change production routing, pricing, picker, common prompts, or adapters.
 * Uses existing CHEAPER_INFERENCE_GLM_52_MODEL + production Cheaper Inference transport.
 *
 *   node --conditions=react-server --import tsx scripts/glm-52-rp-ab-benchmark.ts
 *   node --conditions=react-server --import tsx scripts/glm-52-rp-ab-benchmark.ts --phase=probe
 *   node --conditions=react-server --import tsx scripts/glm-52-rp-ab-benchmark.ts --phase=assemble
 *   node --conditions=react-server --import tsx scripts/glm-52-rp-ab-benchmark.ts --phase=rp
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_BASE_URL,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GLM_52_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { buildCompactTerminalLayoutRecencyLine } from "../src/lib/webnovelOutputFormat";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { flattenOpenRouterMessageContent } from "../src/lib/openRouterClient";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { CURRENT_USER_INPUT_HEADER } from "../src/lib/currentUserInputLabel";
import type { ChatMsg } from "../src/lib/ai";
import type { TrackedPromptSection } from "../src/services/promptAudit";

const MODEL = CHEAPER_INFERENCE_GLM_52_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/glm-52-rp-ab");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "glm-52-rp-ab");

const UI_CATALOG_SNAPSHOT = {
  source: "Cheaper Inference UI at benchmark time (not written to production pricing)",
  inputUsdPerMillion: 0.29,
  cachedInputUsdPerMillion: 0.053768,
  outputUsdPerMillion: 0.91,
};

const STYLE_OUTPUT_SECTION_IDS = [
  "narrative-style",
  "prose-style-xml-bundle",
  "rule-advanced-prose-nsfw",
  "rule-output-layout-recency",
  "rule-length-control",
] as const;

const SEEDS = [
  { id: "S1", user: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?" },
  { id: "S2", user: "같이 갈래? *두리번*" },
  { id: "S3", user: "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든." },
  { id: "S4", user: "*물병을 꺼내 내민다* …목마르면 마셔. 나 괜찮으니까." },
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_TAEHYUNG_WORLD =
  "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.";

const BLIND_KEY: Record<(typeof SEEDS)[number]["id"], { X: "A" | "B"; Y: "A" | "B" }> = {
  S1: { X: "A", Y: "B" },
  S2: { X: "B", Y: "A" },
  S3: { X: "A", Y: "B" },
  S4: { X: "B", Y: "A" },
};

type Arm = "A" | "B";

function headSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function save(dir: string, name: string, content: string | object) {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const text =
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(full, text, "utf8");
      return full;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  return full;
}

function saveBoth(name: string, content: string | object) {
  const repo = save(OUT_DIR, name, content);
  let artifacts: string | null = null;
  try {
    artifacts = save(ARTIFACT_DIR, name, content);
  } catch (err) {
    console.warn("[glm-52-rp-ab] artifact write failed", name, err);
  }
  return { repo, artifacts };
}

function normalizeBlank(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function flattenMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => {
      const row = m as { role?: string; content?: unknown };
      return flattenOpenRouterMessageContent(
        (row.content ?? "") as string | { type: "text"; text: string }[]
      );
    })
    .join("\n\n");
}

function lastUserContent(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const last = messages[messages.length - 1] as { content?: unknown };
  return flattenOpenRouterMessageContent(
    (last.content ?? "") as string | { type: "text"; text: string }[]
  );
}

function historyPrefix(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length < 2) return "";
  return flattenMessages(messages.slice(1, -1));
}

function extractCurrentUserSeed(lastUser: string): string {
  const idx = lastUser.indexOf(CURRENT_USER_INPUT_HEADER);
  const body = idx >= 0 ? lastUser.slice(idx + CURRENT_USER_INPUT_HEADER.length) : lastUser;
  return stripOutputOwnersFromUserTurn(body);
}

function stripOutputOwnersFromUserTurn(content: string): string {
  const layoutLine = buildCompactTerminalLayoutRecencyLine();
  let body = content.split(USER_TAIL_LENGTH_OWNER_SENTENCE).join("");
  body = body.split(layoutLine).join("");
  body = body
    .split(/\n+/)
    .filter(
      (line) =>
        !line.includes("지문과 \"…\" 대사 사이 빈 줄") &&
        !line.includes("3,200자 이상을 기본 목표로") &&
        !line.includes("현재 상호작용을 요약하거나 성급히 닫지")
    )
    .join("\n");
  return normalizeBlank(body);
}

function sectionText(
  sections: TrackedPromptSection[] | undefined,
  pred: (s: TrackedPromptSection) => boolean
): string {
  return normalizeBlank(
    (sections ?? [])
      .filter(pred)
      .map((s) => s.text)
      .join("\n\n")
  );
}

function countParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  return /["“”『』「」]/.test(p) || /^(?:[가-힣A-Za-z].{0,12})?[「『“"]/.test(p);
}

function visibleKoreanMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const paragraphs = countParagraphs(visible);
  const dialogueParagraphs = paragraphs.filter(isDialogueParagraph);
  return {
    charsInclSpaces: [...visible].length,
    charsExclSpaces: [...visible.replace(/\s/g, "")].length,
    paragraphCount: paragraphs.length,
    dialogueParagraphCount: dialogueParagraphs.length,
    dialogueRatio:
      paragraphs.length > 0
        ? Math.round((dialogueParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
  };
}

function catalogCostUsd(opts: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  rates: { input: number; cachedInput: number; output: number };
}): number {
  const billedInput = Math.max(0, opts.inputTokens - opts.cacheReadTokens);
  return (
    (billedInput / 1_000_000) * opts.rates.input +
    (opts.cacheReadTokens / 1_000_000) * opts.rates.cachedInput +
    (opts.outputTokens / 1_000_000) * opts.rates.output
  );
}

function buildTurnContext(currentUserMessage: string) {
  return buildContext({
    charName: "조태형",
    contentKind: "character",
    chunks: [
      {
        id: "c18-identity",
        characterId: "18",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형", "센티넬"],
      },
      {
        id: "c18-world",
        characterId: "18",
        content: JO_TAEHYUNG_WORLD,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스", "로비"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    shortTermHistory: [
      { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
    ],
    currentUserMessage,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: 0,
    narrativePov: { mode: "third_person", povCharacterName: "조태형" },
  });
}

function stripStyleFromBuilt(built: ReturnType<typeof buildTurnContext>) {
  const styleIds = new Set<string>(STYLE_OUTPUT_SECTION_IDS);
  const styleSections = (built.meta.trackedSections ?? []).filter((s) =>
    styleIds.has(s.id)
  );
  let system = built.systemPrompt ?? "";
  const split = built.openRouterSystemSplit
    ? { ...built.openRouterSystemSplit }
    : undefined;
  for (const section of styleSections) {
    const text = section.text.trim();
    if (!text) continue;
    system = system.split(section.text).join("");
    if (split) {
      split.systemRulesBlock = split.systemRulesBlock.split(section.text).join("");
      split.characterSettingsBlock = split.characterSettingsBlock
        .split(section.text)
        .join("");
      split.dynamicBlock = split.dynamicBlock.split(section.text).join("");
    }
  }
  system = normalizeBlank(system);
  if (split) {
    split.systemRulesBlock = normalizeBlank(split.systemRulesBlock);
    split.characterSettingsBlock = normalizeBlank(split.characterSettingsBlock);
    split.dynamicBlock = normalizeBlank(split.dynamicBlock);
  }
  const history = built.history.map((m, i) => {
    if (i !== built.history.length - 1 || m.role !== "user") return m;
    return { ...m, content: stripOutputOwnersFromUserTurn(m.content) };
  });
  return {
    system,
    history,
    split,
    removedSectionIds: styleSections.map((s) => s.id),
    removedSectionChars: styleSections.reduce((n, s) => n + s.text.length, 0),
  };
}

function assembleArm(arm: Arm, currentUserMessage: string) {
  const built = buildTurnContext(currentUserMessage);
  const stripped = arm === "A" ? stripStyleFromBuilt(built) : null;
  const system = stripped?.system ?? built.systemPrompt ?? "";
  const history = stripped?.history ?? built.history;
  const systemSplit = stripped?.split ?? built.openRouterSystemSplit;
  const assembled = assemblePrimaryRpRequest({
    system,
    history,
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit,
      charName: "조태형",
    },
  });
  const requestBody = assembled.requestBody as Record<string, unknown>;
  const messages = requestBody.messages;
  const systemText = flattenOpenRouterMessageContent(
    ((Array.isArray(messages) ? messages[0] : null) as { content?: unknown } | null)
      ?.content as string | { type: "text"; text: string }[] ?? ""
  );
  const lastUser = lastUserContent(messages);
  const historyText = historyPrefix(messages);
  const sections = built.meta.trackedSections ?? [];
  return {
    arm,
    built,
    assembled,
    requestBody,
    systemText,
    lastUser,
    historyText,
    currentUserSeed: extractCurrentUserSeed(lastUser),
    slices: {
      character: sectionText(
        sections,
        (s) =>
          s.category === "characterSetting" ||
          s.category === "worldLore" ||
          s.category === "dialogueExamples" ||
          s.id.includes("character") ||
          s.id.includes("canon") ||
          s.id.includes("identity")
      ),
      persona: sectionText(
        sections,
        (s) => s.category === "persona" || s.id.includes("persona")
      ),
      memory: sectionText(
        sections,
        (s) => s.category === "memory" || s.id.includes("memory")
      ),
      agency: sectionText(
        sections,
        (s) =>
          s.id.includes("godmod") ||
          s.id.includes("agency") ||
          s.id.includes("canon") ||
          s.id.includes("knowledge") ||
          s.id.includes("no-godmodding")
      ),
      currentUserSeed: extractCurrentUserSeed(lastUser),
      historyPrefix: historyText,
    },
    sampling: {
      temperature: requestBody.temperature ?? null,
      max_tokens: requestBody.max_tokens ?? null,
      top_p: requestBody.top_p ?? null,
      stream: requestBody.stream ?? null,
    },
    reasoning: {
      reasoning_effort: requestBody.reasoning_effort ?? null,
      reasoning: requestBody.reasoning ?? null,
      thinking: requestBody.thinking ?? null,
      include_reasoning: requestBody.include_reasoning ?? null,
    },
    chars: {
      system: [...systemText].length,
      history: [...historyText].length,
      lastUser: [...lastUser].length,
      total: [...flattenMessages(messages)].length,
      estimatedInputTokens: estimateTokens(flattenMessages(messages)),
    },
    trackedSectionIds: sections.map((s) => s.id),
    removedSectionIds: stripped?.removedSectionIds ?? [],
  };
}

function diffText(a: string, b: string) {
  return {
    aChars: [...a].length,
    bChars: [...b].length,
    equal: a === b,
    deltaChars: [...b].length - [...a].length,
  };
}

async function fetchCatalogSnapshot() {
  const res = await fetch(`${CHEAPER_INFERENCE_BASE_URL}/models`, {
    headers: buildCheaperInferenceHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const models = Array.isArray(json.data) ? json.data : [];
  const glm = models.find((m) => String(m.id ?? "").toLowerCase() === MODEL);
  return {
    httpStatus: res.status,
    fetchedAt: new Date().toISOString(),
    glmModel: glm ?? null,
    modelIds: models.map((m) => m.id),
  };
}

async function callChat(requestBody: Record<string, unknown>) {
  const started = Date.now();
  let ttftMs: number | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const httpStatus = res.status;
  if (!requestBody.stream) {
    const json = (await res.json()) as Record<string, unknown>;
    const choice = Array.isArray(json.choices)
      ? (json.choices[0] as Record<string, unknown>)
      : {};
    const message = (choice.message ?? {}) as Record<string, unknown>;
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      resolvedModel: typeof json.model === "string" ? json.model : null,
      text: typeof message.content === "string" ? message.content : "",
      usageRaw: json.usage ?? null,
      json,
      invalidTransport: httpStatus >= 400 || !res.ok,
    };
  }
  if (!res.ok || !res.body) {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = { error: await res.text().catch(() => "unreadable") };
    }
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null,
      resolvedModel: null,
      text: "",
      usageRaw: null,
      json,
      invalidTransport: true,
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
    httpStatus,
    latencyMs: Date.now() - started,
    ttftMs,
    finishReason,
    resolvedModel,
    text,
    usageRaw,
    json: null,
    invalidTransport: httpStatus >= 400 || !text,
  };
}

async function probeTransport() {
  const productionAdapted = adaptCheaperInferenceChatBody({
    model: MODEL,
    messages: [{ role: "user", content: "Reply with the single word ok." }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
    reasoning: { effort: "none", exclude: true },
    include_reasoning: false,
  });
  const candidates: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: "production_adapter_reasoning_effort_none", body: productionAdapted },
    {
      label: "omitted_reasoning",
      body: (() => {
        const next = { ...productionAdapted };
        delete next.reasoning_effort;
        delete next.reasoning;
        delete next.thinking;
        delete next.include_reasoning;
        return next;
      })(),
    },
  ];

  const attempts: Array<Record<string, unknown>> = [];
  let accepted: (typeof attempts)[number] | null = null;
  for (const candidate of candidates) {
    const resp = await callChat(candidate.body);
    const usage = parseOpenRouterUsage(resp.usageRaw);
    const row = {
      label: candidate.label,
      sentKeys: Object.keys(candidate.body).sort(),
      sentReasoning: {
        reasoning_effort: candidate.body.reasoning_effort ?? null,
        reasoning: candidate.body.reasoning ?? null,
        thinking: candidate.body.thinking ?? null,
      },
      httpStatus: resp.httpStatus,
      finishReason: resp.finishReason,
      resolvedModel: resp.resolvedModel,
      latencyMs: resp.latencyMs,
      ttftMs: resp.ttftMs,
      textPreview: resp.text.slice(0, 200),
      usageRaw: resp.usageRaw,
      usageParsed: usage,
      usageRawKeys:
        resp.usageRaw && typeof resp.usageRaw === "object"
          ? Object.keys(resp.usageRaw as object)
          : [],
      promptTokensDetails:
        resp.usageRaw &&
        typeof resp.usageRaw === "object" &&
        (resp.usageRaw as { prompt_tokens_details?: unknown }).prompt_tokens_details
          ? (resp.usageRaw as { prompt_tokens_details: unknown }).prompt_tokens_details
          : null,
      completionTokensDetails:
        resp.usageRaw &&
        typeof resp.usageRaw === "object" &&
        (resp.usageRaw as { completion_tokens_details?: unknown }).completion_tokens_details
          ? (resp.usageRaw as { completion_tokens_details: unknown })
              .completion_tokens_details
          : null,
      error: resp.invalidTransport ? resp.json : null,
      accepted: !resp.invalidTransport && resp.httpStatus === 200,
    };
    attempts.push(row);
    if (row.accepted && !accepted) accepted = row;
    if (row.accepted && candidate.label === "production_adapter_reasoning_effort_none") {
      break;
    }
  }

  const catalog = await fetchCatalogSnapshot();
  const report = {
    model: MODEL,
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    productionAdapterNote:
      "adaptCheaperInferenceChatBody(glm-5.2) deletes OpenRouter reasoning/include_reasoning and sets reasoning_effort=none (generic non-Gemini31 path).",
    productionTemperatureOwner: 0.7,
    productionMaxTokens: "omitted",
    acceptedLabel: accepted?.label ?? null,
    reasoningSettingForAB:
      accepted?.label === "omitted_reasoning" ? "omitted" : "none",
    streamingSupported: attempts.some((a) => a.accepted === true),
    attempts,
    catalog,
    uiCatalogSnapshot: UI_CATALOG_SNAPSHOT,
    headSha: headSha(),
  };
  saveBoth("01-transport-probe.json", report);
  return report;
}

function writeAssembleAudit() {
  const rows = SEEDS.map((seed) => {
    const a = assembleArm("A", seed.user);
    const b = assembleArm("B", seed.user);
    const audit = {
      seed: seed.id,
      user: seed.user,
      diffs: {
        character: diffText(a.slices.character, b.slices.character),
        history: diffText(a.slices.historyPrefix, b.slices.historyPrefix),
        persona: diffText(a.slices.persona, b.slices.persona),
        currentUser: diffText(a.slices.currentUserSeed, b.slices.currentUserSeed),
        memory: diffText(a.slices.memory, b.slices.memory),
        agency: diffText(a.slices.agency, b.slices.agency),
        sampling: {
          equal: JSON.stringify(a.sampling) === JSON.stringify(b.sampling),
          a: a.sampling,
          b: b.sampling,
        },
        reasoning: {
          equal: JSON.stringify(a.reasoning) === JSON.stringify(b.reasoning),
          a: a.reasoning,
          b: b.reasoning,
        },
      },
      aChars: a.chars,
      bChars: b.chars,
      aRemovedSectionIds: a.removedSectionIds,
      aSectionIds: a.trackedSectionIds,
      bSectionIds: b.trackedSectionIds,
      lastUserAHasLengthOwner: a.lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
      lastUserBHasLengthOwner: b.lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
      lastUserAHasLayoutOwner: a.lastUser.includes("지문과 \"…\" 대사 사이 빈 줄"),
      lastUserBHasLayoutOwner: b.lastUser.includes("지문과 \"…\" 대사 사이 빈 줄"),
    };
    saveBoth(`assembled/${seed.id}-A-request.json`, {
      arm: "A",
      seed: seed.id,
      requestBody: a.requestBody,
      chars: a.chars,
      sampling: a.sampling,
      reasoning: a.reasoning,
      removedSectionIds: a.removedSectionIds,
    });
    saveBoth(`assembled/${seed.id}-B-request.json`, {
      arm: "B",
      seed: seed.id,
      requestBody: b.requestBody,
      chars: b.chars,
      sampling: b.sampling,
      reasoning: b.reasoning,
    });
    saveBoth(`assembled/${seed.id}-A-system.txt`, a.systemText);
    saveBoth(`assembled/${seed.id}-B-system.txt`, b.systemText);
    saveBoth(`assembled/${seed.id}-A-last-user.txt`, a.lastUser);
    saveBoth(`assembled/${seed.id}-B-last-user.txt`, b.lastUser);
    return audit;
  });

  const summary = {
    headSha: headSha(),
    model: MODEL,
    note: "A = VANILLA_STYLE (style/output owners stripped). B = COMMON_PROSE_OUTPUT (production common owners). Character/history/persona/current-user/memory/agency/sampling/reasoning must be equal.",
    styleOutputSectionIds: STYLE_OUTPUT_SECTION_IDS,
    languageOwnerKept: "production [OUTPUT LANG] in openrouter-korean-prose-top (no new wording)",
    rows,
    allCharacterZero: rows.every((r) => r.diffs.character.equal),
    allHistoryZero: rows.every((r) => r.diffs.history.equal),
    allPersonaZero: rows.every((r) => r.diffs.persona.equal),
    allCurrentUserZero: rows.every((r) => r.diffs.currentUser.equal),
    allMemoryZero: rows.every((r) => r.diffs.memory.equal),
    allAgencyZero: rows.every((r) => r.diffs.agency.equal),
    allSamplingZero: rows.every((r) => r.diffs.sampling.equal),
    allReasoningZero: rows.every((r) => r.diffs.reasoning.equal),
  };
  saveBoth("02-assembled-diff-audit.json", summary);
  return summary;
}

function writeIndex(extra: Record<string, unknown>) {
  const files = walkFiles(OUT_DIR).sort();
  const artifactFiles = fs.existsSync(ARTIFACT_DIR)
    ? walkFiles(ARTIFACT_DIR).sort()
    : [];
  const md = `# GLM-5.2 RP A/B data index

Quality scoring is intentionally omitted. Use the files below.

HEAD SHA: \`${headSha()}\`
model: \`${MODEL}\`
endpoint: \`${CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL}\`

## Repo paths

${files.map((f) => `- \`${path.relative(process.cwd(), f)}\``).join("\n")}

## Artifact paths

${artifactFiles.map((f) => `- \`${f}\``).join("\n")}

## Extra

\`\`\`json
${JSON.stringify(extra, null, 2)}
\`\`\`
`;
  saveBoth("DATA_INDEX.md", md);
  saveBoth("DATA_INDEX.json", {
    headSha: headSha(),
    repoDir: OUT_DIR,
    artifactDir: ARTIFACT_DIR,
    repoFiles: files.map((f) => path.relative(process.cwd(), f)),
    artifactFiles,
    extra,
  });
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

async function runRpCalls(probe: Awaited<ReturnType<typeof probeTransport>>) {
  const rates = {
    input:
      Number(
        (probe.catalog.glmModel as { pricing?: { input_per_million?: unknown } } | null)
          ?.pricing?.input_per_million
      ) || UI_CATALOG_SNAPSHOT.inputUsdPerMillion,
    cachedInput:
      Number(
        (
          probe.catalog.glmModel as {
            pricing?: { cache_read_input_per_million?: unknown };
          } | null
        )?.pricing?.cache_read_input_per_million
      ) || UI_CATALOG_SNAPSHOT.cachedInputUsdPerMillion,
    output:
      Number(
        (probe.catalog.glmModel as { pricing?: { output_per_million?: unknown } } | null)
          ?.pricing?.output_per_million
      ) || UI_CATALOG_SNAPSHOT.outputUsdPerMillion,
  };

  const rows: Array<Record<string, unknown>> = [];
  const rawByCell: Record<string, string> = {};

  for (const seed of SEEDS) {
    for (const arm of ["A", "B"] as const) {
      const assembled = assembleArm(arm, seed.user);
      const resp = await callChat(assembled.requestBody);
      const usage = parseOpenRouterUsage(resp.usageRaw);
      const visible = visibleKoreanMetrics(resp.text);
      const catalogUsd = catalogCostUsd({
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        cacheReadTokens: usage.cacheReadTokens,
        rates,
      });
      const cell = `${seed.id}-${arm}`;
      const row = {
        cell,
        seed: seed.id,
        arm,
        user: seed.user,
        invalidTransport: resp.invalidTransport,
        httpStatus: resp.httpStatus,
        finishReason: resp.finishReason,
        latencyMs: resp.latencyMs,
        ttftMs: resp.ttftMs,
        resolvedModel: resp.resolvedModel,
        ...visible,
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        standardInputTokens: usage.standardInputTokens,
        usageCostUsd: usage.upstreamCostUsd ?? null,
        catalogEstimatedUsd: Math.round(catalogUsd * 1e8) / 1e8,
        costPer1000VisibleChars:
          visible.charsInclSpaces > 0
            ? Math.round(
                ((usage.upstreamCostUsd ?? catalogUsd) / visible.charsInclSpaces) *
                  1000 *
                  1e8
              ) / 1e8
            : null,
        sampling: assembled.sampling,
        reasoning: assembled.reasoning,
        assembledChars: assembled.chars,
        usageRaw: resp.usageRaw,
        error: resp.invalidTransport ? resp.json : null,
      };
      rows.push(row);
      rawByCell[cell] = resp.text;
      saveBoth(`raw/${cell}.txt`, resp.text || "");
      saveBoth(`calls/${cell}.json`, row);
      console.log(
        JSON.stringify({
          cell,
          invalidTransport: row.invalidTransport,
          chars: visible.charsInclSpaces,
          outTok: usage.completionTokens,
          finish: resp.finishReason,
          latencyMs: resp.latencyMs,
          usageCostUsd: row.usageCostUsd,
        })
      );
    }
  }

  saveBoth("03-call-metrics.json", {
    headSha: headSha(),
    model: MODEL,
    retry: 0,
    continuation: 0,
    recovery: 0,
    reasoningSettingForAB: probe.reasoningSettingForAB,
    ratesUsed: rates,
    uiCatalogSnapshot: UI_CATALOG_SNAPSHOT,
    liveCatalog: probe.catalog.glmModel,
    rows,
  });

  const rubric = `# Blind human review pack

Do not open \`blind/BLIND_KEY.json\` until scoring is finished.

Each seed has two unlabeled outputs (X / Y). Compare only those two files.

## Compare

- which side is better as a character-chat product
- prose / literary density
- character voice
- immersion
- scene progression
- natural Korean
- agency / speech-act / repetition / question-loop / dialogue-overuse / early-stop / summary-preview leakage

## Site goals (for the scorer, not pre-scored here)

- narration-first
- no dialogue overuse
- scene must actually progress
- do not preempt user action/intent
- 3000+ chars is helpful if not padded by repetition

## Files

${SEEDS.map(
  (s) =>
    `- ${s.id} user: ${s.user}\n  - \`docs/audits/glm-52-rp-ab/blind/${s.id}-X.txt\`\n  - \`docs/audits/glm-52-rp-ab/blind/${s.id}-Y.txt\``
).join("\n")}
`;
  saveBoth("blind/REVIEW_RUBRIC.md", rubric);
  saveBoth("blind/BLIND_KEY.json", {
    note: "Hidden A/B mapping. Do not consult before scoring.",
    mapping: BLIND_KEY,
  });
  for (const seed of SEEDS) {
    const map = BLIND_KEY[seed.id];
    saveBoth(`blind/${seed.id}-X.txt`, rawByCell[`${seed.id}-${map.X}`] ?? "");
    saveBoth(`blind/${seed.id}-Y.txt`, rawByCell[`${seed.id}-${map.Y}`] ?? "");
    saveBoth(`raw/${seed.id}-A.txt`, rawByCell[`${seed.id}-A`] ?? "");
    saveBoth(`raw/${seed.id}-B.txt`, rawByCell[`${seed.id}-B`] ?? "");
  }

  return { rows, rates };
}

function parsePhase(): "probe" | "assemble" | "rp" | "all" {
  const arg = process.argv.find((a) => a.startsWith("--phase="));
  const value = arg?.slice("--phase=".length) ?? "all";
  if (value === "probe" || value === "assemble" || value === "rp" || value === "all") {
    return value;
  }
  throw new Error(`unknown --phase=${value}`);
}

async function main() {
  const phase = parsePhase();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  saveBoth("00-meta.json", {
    headSha: headSha(),
    model: MODEL,
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    phase,
    startedAt: new Date().toISOString(),
    constraints: [
      "no picker",
      "no pricing change",
      "no production routing change",
      "no common prompt change",
      "no GLM adapter",
      "no merge/deploy",
    ],
  });

  let probe: Awaited<ReturnType<typeof probeTransport>> | null = null;
  if (phase === "probe" || phase === "all" || phase === "rp") {
    probe = await probeTransport();
    console.log(
      JSON.stringify(
        {
          phase: "probe",
          accepted: probe.acceptedLabel,
          reasoningSettingForAB: probe.reasoningSettingForAB,
          streamingSupported: probe.streamingSupported,
        },
        null,
        2
      )
    );
  }
  if (phase === "assemble" || phase === "all") {
    const audit = writeAssembleAudit();
    console.log(
      JSON.stringify(
        {
          phase: "assemble",
          character: audit.allCharacterZero,
          history: audit.allHistoryZero,
          persona: audit.allPersonaZero,
          currentUser: audit.allCurrentUserZero,
          memory: audit.allMemoryZero,
          agency: audit.allAgencyZero,
          sampling: audit.allSamplingZero,
          reasoning: audit.allReasoningZero,
        },
        null,
        2
      )
    );
  }
  if (phase === "rp" || phase === "all") {
    if (!probe) probe = await probeTransport();
    if (!probe.streamingSupported) {
      saveBoth("03-call-metrics.json", {
        skipped: true,
        reason: "INVALID_TRANSPORT — probe failed; RP calls not run",
        probe,
      });
    } else {
      await runRpCalls(probe);
    }
  }
  writeIndex({ phase, completedAt: new Date().toISOString() });
}

void main();
