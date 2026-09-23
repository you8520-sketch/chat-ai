/**
 * GLM-5.2 stability adapter A/B (experiment-only).
 *
 * A = previous COMMON_PROSE_OUTPUT (production common owners, unchanged).
 * B = A + two GLM-5.2-only stability sentences after the last common
 *     prose/output SYSTEM owner.
 *
 * Does NOT change production prompts, picker, pricing, routing, or adapters.
 *
 *   node --conditions=react-server --import tsx scripts/glm-52-stability-adapter-ab.ts --phase=assemble
 *   node --conditions=react-server --import tsx scripts/glm-52-stability-adapter-ab.ts --phase=s4
 *   node --conditions=react-server --import tsx scripts/glm-52-stability-adapter-ab.ts --phase=all
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
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GLM_52_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { flattenOpenRouterMessageContent } from "../src/lib/openRouterClient";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { CURRENT_USER_INPUT_HEADER } from "../src/lib/currentUserInputLabel";
import type { TrackedPromptSection } from "../src/services/promptAudit";

const MODEL = CHEAPER_INFERENCE_GLM_52_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/glm-52-stability-adapter-ab");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "glm-52-stability-adapter-ab");

const STABILITY_SENTENCE_1 =
  "하나의 행동·감각·소품이 가진 의미는 가장 선명한 해석 한 번으로 충분히 살리고, 같은 의미를 다시 풀어쓰거나 이미 묘사한 장면을 되풀이하지 말고 새로운 반응·행동·대사·환경 변화로 장면을 전진시킨다.";
const STABILITY_SENTENCE_2 =
  "현재 대화와 설정에서 확인되지 않은 물건의 출처·상태, 인물의 과거 습관·소속·의도 같은 세부는 사실로 만들어 확정하지 않고, 관찰 가능한 단서와 현재 장면 안에서 확인된 정보만 사용한다.";
const STABILITY_BLOCK = `${STABILITY_SENTENCE_1}\n${STABILITY_SENTENCE_2}`;

const ANCHOR_SECTION_IDS = [
  "rule-output-layout-recency",
  "prose-style-xml-bundle",
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

type Arm = "A" | "B";
type SeedId = (typeof SEEDS)[number]["id"];

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
    console.warn("[glm-52-stability] artifact write failed", name, err);
  }
  return { repo, artifacts };
}

function flattenMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => {
      const row = m as { content?: unknown };
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
  return (idx >= 0 ? lastUser.slice(idx + CURRENT_USER_INPUT_HEADER.length) : lastUser)
    .trim();
}

function sectionText(
  sections: TrackedPromptSection[] | undefined,
  pred: (s: TrackedPromptSection) => boolean
): string {
  return (sections ?? [])
    .filter(pred)
    .map((s) => s.text)
    .join("\n\n")
    .trim();
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

function insertAfterAnchor(
  haystack: string,
  anchor: string,
  insert: string
): { text: string; inserted: boolean } {
  if (!anchor.trim() || !haystack.includes(anchor)) {
    return { text: haystack, inserted: false };
  }
  const idx = haystack.lastIndexOf(anchor);
  const end = idx + anchor.length;
  const before = haystack.slice(0, end);
  const after = haystack.slice(end);
  if (before.includes(insert) || after.startsWith(`\n\n${insert}`)) {
    return { text: haystack, inserted: true };
  }
  return { text: `${before}\n\n${insert}${after}`, inserted: true };
}

function applyStabilityAdapter(
  system: string,
  split: ReturnType<typeof buildTurnContext>["openRouterSystemSplit"],
  sections: TrackedPromptSection[]
) {
  const anchor =
    sections.find((s) => s.id === ANCHOR_SECTION_IDS[0] && s.text.trim()) ??
    sections.find((s) => s.id === ANCHOR_SECTION_IDS[1] && s.text.trim());
  if (!anchor) {
    throw new Error("common prose/output SYSTEM owner not found for stability insert");
  }
  const sys = insertAfterAnchor(system, anchor.text, STABILITY_BLOCK);
  if (!sys.inserted) {
    throw new Error("failed to insert stability block after common prose/output owner");
  }
  const nextSplit = split ? { ...split } : undefined;
  if (nextSplit) {
    const tryKeys = [
      "dynamicBlock",
      "characterSettingsBlock",
      "systemRulesBlock",
    ] as const;
    let placed = false;
    for (const key of tryKeys) {
      const result = insertAfterAnchor(nextSplit[key], anchor.text, STABILITY_BLOCK);
      if (result.inserted && result.text !== nextSplit[key]) {
        nextSplit[key] = result.text;
        placed = true;
        break;
      }
    }
    if (!placed && !flattenSplit(nextSplit).includes(STABILITY_BLOCK)) {
      nextSplit.dynamicBlock = `${nextSplit.dynamicBlock.trim()}\n\n${STABILITY_BLOCK}`;
    }
  }
  return {
    system: sys.text,
    split: nextSplit,
    anchorId: anchor.id,
  };
}

function flattenSplit(
  split: NonNullable<ReturnType<typeof buildTurnContext>["openRouterSystemSplit"]>
): string {
  return [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].join(
    "\n\n"
  );
}

function assembleArm(arm: Arm, currentUserMessage: string) {
  const built = buildTurnContext(currentUserMessage);
  const sections = built.meta.trackedSections ?? [];
  let system = built.systemPrompt ?? "";
  let systemSplit = built.openRouterSystemSplit;
  let anchorId: string | null = null;
  if (arm === "B") {
    const applied = applyStabilityAdapter(system, systemSplit, sections);
    system = applied.system;
    systemSplit = applied.split;
    anchorId = applied.anchorId;
  }
  const assembled = assemblePrimaryRpRequest({
    system,
    history: built.history,
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
  const systemWithoutAdapter = systemText.split(STABILITY_BLOCK).join("").trim();
  return {
    arm,
    built,
    requestBody,
    systemText,
    systemWithoutAdapter,
    lastUser,
    historyText,
    currentUserSeed: extractCurrentUserSeed(lastUser),
    stabilityPresent: systemText.includes(STABILITY_SENTENCE_1) &&
      systemText.includes(STABILITY_SENTENCE_2),
    stabilityCount: systemText.split(STABILITY_BLOCK).length - 1,
    anchorId,
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
      commonProse: sectionText(
        sections,
        (s) =>
          s.id === "prose-style-xml-bundle" ||
          s.id === "rule-output-layout-recency" ||
          s.id === "narrative-style" ||
          s.id === "rule-advanced-prose-nsfw"
      ),
      currentUserSeed: extractCurrentUserSeed(lastUser),
      historyPrefix: historyText,
      lengthOwner: lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)
        ? USER_TAIL_LENGTH_OWNER_SENTENCE
        : "",
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
    },
    chars: {
      system: [...systemText].length,
      history: [...historyText].length,
      lastUser: [...lastUser].length,
      total: [...flattenMessages(messages)].length,
      estimatedInputTokens: estimateTokens(flattenMessages(messages)),
    },
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

function writeAssembleAudit(seedIds: readonly SeedId[] = SEEDS.map((s) => s.id)) {
  const rows = seedIds.map((id) => {
    const seed = SEEDS.find((s) => s.id === id)!;
    const a = assembleArm("A", seed.user);
    const b = assembleArm("B", seed.user);
    const aNorm = a.systemText.replace(/\n{3,}/g, "\n\n").trim();
    const bMinus = b.systemText
      .split(STABILITY_BLOCK)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const systemMinusAdapterEqual = aNorm === bMinus;
    const extraInB = b.systemText.includes(STABILITY_BLOCK) ? STABILITY_BLOCK : null;
    const audit = {
      seed: seed.id,
      user: seed.user,
      diffs: {
        character: diffText(a.slices.character, b.slices.character),
        history: diffText(a.slices.historyPrefix, b.slices.historyPrefix),
        persona: diffText(a.slices.persona, b.slices.persona),
        memory: diffText(a.slices.memory, b.slices.memory),
        currentUser: diffText(a.slices.currentUserSeed, b.slices.currentUserSeed),
        agency: diffText(a.slices.agency, b.slices.agency),
        commonProse: diffText(a.slices.commonProse, b.slices.commonProse),
        lengthOwner: {
          equal: a.slices.lengthOwner === b.slices.lengthOwner &&
            a.lastUser === b.lastUser,
          aHasUserTail: a.lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
          bHasUserTail: b.lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
        },
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
        systemMinusAdapter: {
          equal: systemMinusAdapterEqual,
        },
      },
      aChars: a.chars,
      bChars: b.chars,
      aHasStability: a.stabilityPresent,
      bHasStability: b.stabilityPresent,
      bStabilityCount: b.stabilityCount,
      bAnchorId: b.anchorId,
      extraInB,
      extraIsExactTwoSentences: extraInB === STABILITY_BLOCK,
    };
    saveBoth(`assembled/${seed.id}-A-system.txt`, a.systemText);
    saveBoth(`assembled/${seed.id}-B-system.txt`, b.systemText);
    saveBoth(`assembled/${seed.id}-A-last-user.txt`, a.lastUser);
    saveBoth(`assembled/${seed.id}-B-last-user.txt`, b.lastUser);
    saveBoth(`assembled/${seed.id}-diff.json`, audit);
    return audit;
  });
  const summary = {
    headSha: headSha(),
    model: MODEL,
    stabilityBlock: STABILITY_BLOCK,
    rows,
    allCharacterZero: rows.every((r) => r.diffs.character.equal),
    allHistoryZero: rows.every((r) => r.diffs.history.equal),
    allPersonaZero: rows.every((r) => r.diffs.persona.equal),
    allMemoryZero: rows.every((r) => r.diffs.memory.equal),
    allCurrentUserZero: rows.every((r) => r.diffs.currentUser.equal),
    allAgencyZero: rows.every((r) => r.diffs.agency.equal),
    allCommonProseZero: rows.every((r) => r.diffs.commonProse.equal),
    allLengthOwnerZero: rows.every((r) => r.diffs.lengthOwner.equal),
    allSamplingZero: rows.every((r) => r.diffs.sampling.equal),
    allReasoningZero: rows.every((r) => r.diffs.reasoning.equal),
    onlyTwoSentenceDiff: rows.every(
      (r) =>
        r.extraIsExactTwoSentences &&
        r.bHasStability &&
        !r.aHasStability &&
        r.bStabilityCount === 1
    ),
  };
  saveBoth("02-assembled-diff-audit.json", summary);
  return summary;
}

async function runCells(seedIds: readonly SeedId[]) {
  const rows: Array<Record<string, unknown>> = [];
  const raw: Record<string, string> = {};
  for (const id of seedIds) {
    const seed = SEEDS.find((s) => s.id === id)!;
    for (const arm of ["A", "B"] as const) {
      const assembled = assembleArm(arm, seed.user);
      const resp = await callChat(assembled.requestBody);
      const usage = parseOpenRouterUsage(resp.usageRaw);
      const visible = visibleKoreanMetrics(resp.text);
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
        usageCostUsd: usage.upstreamCostUsd ?? null,
        sampling: assembled.sampling,
        reasoning: assembled.reasoning,
        assembledChars: assembled.chars,
        stabilityPresent: assembled.stabilityPresent,
      };
      rows.push(row);
      raw[cell] = resp.text;
      saveBoth(`raw/${cell}.txt`, resp.text || "");
      saveBoth(`calls/${cell}.json`, row);
      console.log(
        JSON.stringify({
          cell,
          invalid: row.invalidTransport,
          chars: visible.charsInclSpaces,
          outTok: usage.completionTokens,
          finish: resp.finishReason,
          latencyMs: resp.latencyMs,
          cost: row.usageCostUsd,
        })
      );
    }
  }
  return { rows, raw };
}

function parsePhase(): "assemble" | "s4" | "rest" | "all" {
  const arg = process.argv.find((a) => a.startsWith("--phase="));
  const value = arg?.slice("--phase=".length) ?? "s4";
  if (value === "assemble" || value === "s4" || value === "rest" || value === "all") {
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
    a: "COMMON_PROSE_OUTPUT (production owners, unchanged)",
    b: "COMMON_PROSE_OUTPUT + GLM-5.2 two-sentence stability adapter",
    constraints: [
      "no production/common prompt edit",
      "no picker/pricing/routing edit",
      "no merge/deploy",
      "temperature 0.7",
      "reasoning_effort none",
      "max_tokens omitted",
      "USER_TAIL unchanged",
    ],
    stabilityBlock: STABILITY_BLOCK,
  });

  const audit = writeAssembleAudit(phase === "s4" ? (["S4"] as const) : undefined);
  console.log(
    JSON.stringify(
      {
        phase: "assemble",
        onlyTwoSentenceDiff: audit.onlyTwoSentenceDiff,
        character: audit.allCharacterZero,
        history: audit.allHistoryZero,
        persona: audit.allPersonaZero,
        memory: audit.allMemoryZero,
        currentUser: audit.allCurrentUserZero,
        agency: audit.allAgencyZero,
        commonProse: audit.allCommonProseZero,
        lengthOwner: audit.allLengthOwnerZero,
        sampling: audit.allSamplingZero,
        reasoning: audit.allReasoningZero,
      },
      null,
      2
    )
  );
  if (phase === "assemble") return;

  const seedIds =
    phase === "s4"
      ? (["S4"] as const)
      : phase === "rest"
        ? (["S1", "S2", "S3"] as const)
        : SEEDS.map((s) => s.id);
  const { rows, raw } = await runCells(seedIds);
  saveBoth(phase === "s4" ? "03-s4-metrics.json" : "03-call-metrics.json", {
    headSha: headSha(),
    model: MODEL,
    retry: 0,
    continuation: 0,
    recovery: 0,
    rows,
  });
  for (const [cell, text] of Object.entries(raw)) {
    saveBoth(`raw/${cell}.txt`, text);
  }
}

void main();
