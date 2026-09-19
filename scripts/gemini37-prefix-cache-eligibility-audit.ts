/**
 * Offline Gemini 3.7 Flash prefix / cache-eligibility audit.
 * Production path: buildContext → assemblePrimaryRpRequest → adaptCheaperInferenceChatBody
 * provider generation calls = 0
 *
 *   node --conditions=react-server --import tsx scripts/gemini37-prefix-cache-eligibility-audit.ts
 */
import Module from "module";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { flattenOpenRouterMessageContent } from "../src/lib/openRouterClient";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { estimateTokens } from "../src/lib/tokenEstimate";
import {
  assembleGeminiStaticDynamicSplit,
  finalizeGeminiStaticCache,
  fingerprintStaticPrompt,
} from "../src/lib/geminiStaticDynamicContext";
import type { ChatMsg } from "../src/lib/ai";
import type { TrackedPromptSection } from "../src/services/promptAudit";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/main-rp-cache-health-2026-09-19"
);
const GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS = 4096;

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

function readCannedAssistant(turn: number): string {
  const p = path.join(
    process.cwd(),
    "docs/audits/gemini-37-flash-pricing",
    `t${turn}-raw.txt`
  );
  return fs.readFileSync(p, "utf8").trim();
}

function longestCommonPrefix(a: string, b: string): { chars: number; text: string } {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i += 1;
  return { chars: i, text: a.slice(0, i) };
}

function firstDifferingMessageIndex(
  a: { role: string; content: unknown }[],
  b: { role: string; content: unknown }[]
): number {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return i;
    const lt =
      typeof left.content === "string"
        ? left.content
        : flattenOpenRouterMessageContent(
            left.content as Parameters<typeof flattenOpenRouterMessageContent>[0]
          );
    const rt =
      typeof right.content === "string"
        ? right.content
        : flattenOpenRouterMessageContent(
            right.content as Parameters<typeof flattenOpenRouterMessageContent>[0]
          );
    if (left.role !== right.role || lt !== rt) return i;
  }
  return -1;
}

function wireMessagesText(messages: { role: string; content: unknown }[]): string {
  return messages
    .map((m) => {
      const body =
        typeof m.content === "string"
          ? m.content
          : flattenOpenRouterMessageContent(
              m.content as Parameters<typeof flattenOpenRouterMessageContent>[0]
            );
      return `[${m.role}]\n${body}`;
    })
    .join("\n---\n");
}

function firstDifferingSection(
  prev: TrackedPromptSection[],
  next: TrackedPromptSection[]
): { index: number; id: string | null; label: string | null } {
  const max = Math.max(prev.length, next.length);
  for (let i = 0; i < max; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b) return { index: i, id: b?.id ?? a?.id ?? null, label: b?.label ?? a?.label ?? null };
    if (a.id !== b.id || a.text.trim() !== b.text.trim()) {
      return { index: i, id: b.id, label: b.label };
    }
  }
  return { index: -1, id: null, label: null };
}

function stableSystemPrefixTokens(sections: TrackedPromptSection[]): number {
  let acc = "";
  for (const s of sections) {
    acc += s.text;
    if (estimateTokens(acc) >= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS) {
      return estimateTokens(acc);
    }
  }
  return estimateTokens(acc);
}

function sectionMultiset(sections: TrackedPromptSection[]) {
  const counts = new Map<string, number>();
  for (const s of sections) {
    const key = `${s.id}::${s.text.trim()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compareSectionParity(
  falseSections: TrackedPromptSection[],
  trueSections: TrackedPromptSection[]
) {
  const a = sectionMultiset(falseSections);
  const b = sectionMultiset(trueSections);
  const missing: string[] = [];
  const duplicated: string[] = [];
  const extra: string[] = [];
  for (const [key, count] of a) {
    const other = b.get(key) ?? 0;
    if (other === 0) missing.push(key.split("::")[0] ?? key);
    else if (other > count) duplicated.push(key.split("::")[0] ?? key);
    else if (other < count) missing.push(key.split("::")[0] ?? key);
  }
  for (const [key, count] of b) {
    if (!a.has(key)) extra.push(key.split("::")[0] ?? key);
    else if ((a.get(key) ?? 0) < count) duplicated.push(key.split("::")[0] ?? key);
  }
  return {
    missingSections: [...new Set(missing)],
    duplicatedSections: [...new Set(duplicated)],
    extraSections: [...new Set(extra)],
    semanticParity:
      missing.length === 0 && duplicated.length === 0 && extra.length === 0,
  };
}

function buildTurn(
  turnIndex: number,
  history: ChatMsg[],
  userLine: string,
  geminiStaticDynamicMode: boolean
) {
  const built = buildContext({
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
        content: "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.",
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
    shortTermHistory: history,
    currentUserMessage: userLine,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: history.filter((m) => m.role === "assistant").length,
    narrativePov: { mode: "third_person", povCharacterName: "조태형" },
    geminiStaticDynamicMode,
    chatId: 9001,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history,
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: "조태형",
    },
  });

  const requestBody = adaptCheaperInferenceChatBody(
    assembled.requestBody as Record<string, unknown>
  );
  const messages = (requestBody.messages ?? []) as { role: string; content: unknown }[];
  const wireText = wireMessagesText(messages);
  const systemText = messages.find((m) => m.role === "system")
    ? flattenOpenRouterMessageContent(
        messages.find((m) => m.role === "system")!.content as Parameters<
          typeof flattenOpenRouterMessageContent
        >[0]
      )
    : "";

  let staticSplit = null as ReturnType<typeof assembleGeminiStaticDynamicSplit> | null;
  if (geminiStaticDynamicMode && built.meta.trackedSections) {
    staticSplit = finalizeGeminiStaticCache(
      assembleGeminiStaticDynamicSplit({
        sections: built.meta.trackedSections,
        dynamicHistory: built.history,
      }),
      { chatId: 9001 }
    );
  }

  return {
    turn: turnIndex,
    userLine,
    trackedSections: built.meta.trackedSections ?? [],
    systemTokens: built.meta.estimatedSystemTokens ?? estimateTokens(systemText),
    promptTokens: built.meta.estimatedInputTokens ?? estimateTokens(wireText),
    wireText,
    systemText,
    messages,
    requestBody,
    geminiSplit: built.geminiSplit,
    staticSplit,
    historyMessageCount: built.history.length,
  };
}

function analyzeMode(geminiStaticDynamicMode: boolean) {
  const turns: ReturnType<typeof buildTurn>[] = [];
  let history: ChatMsg[] = [];
  for (let i = 0; i < USER_TURNS.length; i += 1) {
    const turn = buildTurn(i + 1, history, USER_TURNS[i]!, geminiStaticDynamicMode);
    turns.push(turn);
    if (i < USER_TURNS.length - 1) {
      history = [
        ...history,
        { role: "user", content: USER_TURNS[i]! },
        { role: "assistant", content: readCannedAssistant(i + 1) },
      ];
    }
  }

  const pairs = [
    { label: "T1-T2", a: turns[0]!, b: turns[1]! },
    { label: "T2-T3", a: turns[1]!, b: turns[2]! },
    { label: "T1-T3", a: turns[0]!, b: turns[2]! },
  ];

  const pairMetrics = pairs.map(({ label, a, b }) => {
    const full = longestCommonPrefix(a.wireText, b.wireText);
    const system = longestCommonPrefix(a.systemText, b.systemText);
    const sectionBreak = firstDifferingSection(a.trackedSections, b.trackedSections);
    return {
      pair: label,
      fullCommonPrefixChars: full.chars,
      fullCommonPrefixTokens: estimateTokens(full.text),
      systemCommonPrefixChars: system.chars,
      systemCommonPrefixTokens: estimateTokens(system.text),
      firstDifferingMessageIndex: firstDifferingMessageIndex(a.messages, b.messages),
      firstDifferingMessageRole:
        firstDifferingMessageIndex(a.messages, b.messages) >= 0
          ? b.messages[firstDifferingMessageIndex(a.messages, b.messages)]?.role ?? null
          : null,
      firstDifferingSection: sectionBreak,
      totalPromptTokensA: a.promptTokens,
      totalPromptTokensB: b.promptTokens,
    };
  });

  const t2Pair = pairMetrics.find((p) => p.pair === "T1-T2")!;
  const stablePrefixTokens = t2Pair.systemCommonPrefixTokens;
  const eligibility =
    stablePrefixTokens >= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS
      ? stablePrefixTokens <= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS + 64
        ? "BOUNDARY_UNCERTAIN"
        : "ELIGIBLE"
      : "BELOW_THRESHOLD";

  const staticFingerprints =
    geminiStaticDynamicMode && turns.every((t) => t.staticSplit)
      ? turns.map((t) => t.staticSplit!.staticFingerprint)
      : [];

  return {
    geminiStaticDynamicMode,
    turns: turns.map((t) => ({
      turn: t.turn,
      systemTokens: t.systemTokens,
      promptTokens: t.promptTokens,
      historyMessageCount: t.historyMessageCount,
      sectionIds: t.trackedSections.map((s) => s.id),
      staticFingerprint: t.staticSplit?.staticFingerprint ?? null,
      staticEstimatedTokens: t.staticSplit?.staticEstimatedTokens ?? null,
    })),
    pairMetrics,
    stablePrefixBeforeBreakTokens: stablePrefixTokens,
    firstVolatileBreakOwner:
      t2Pair.firstDifferingSection.id ??
      (t2Pair.firstDifferingMessageIndex >= 0
        ? `history-message-${t2Pair.firstDifferingMessageIndex}:${t2Pair.firstDifferingMessageRole ?? "unknown"}`
        : null),
    firstVolatileBreakLabel: t2Pair.firstDifferingSection.label,
    firstDifferingMessageIndexT1T2: t2Pair.firstDifferingMessageIndex,
    cacheEligibility: eligibility,
    staticFingerprintStableT1T3:
      staticFingerprints.length === 3
        ? staticFingerprints[0] === staticFingerprints[1] &&
          staticFingerprints[1] === staticFingerprints[2]
        : null,
  };
}

function main() {
  const falseMode = analyzeMode(false);
  const trueMode = analyzeMode(true);
  // T2 section parity with same history depth
  const falseT2 = buildTurn(2, [{ role: "user", content: USER_TURNS[0]! }, { role: "assistant", content: readCannedAssistant(1) }], USER_TURNS[1]!, false);
  const trueT2 = buildTurn(2, [{ role: "user", content: USER_TURNS[0]! }, { role: "assistant", content: readCannedAssistant(1) }], USER_TURNS[1]!, true);
  const t2Parity = compareSectionParity(falseT2.trackedSections, trueT2.trackedSections);

  const comparisonTable = {
    stablePrefixTokensT1T2: {
      currentFalse: falseMode.pairMetrics.find((p) => p.pair === "T1-T2")!.systemCommonPrefixTokens,
      offlineTrue: trueMode.pairMetrics.find((p) => p.pair === "T1-T2")!.systemCommonPrefixTokens,
    },
    meets4096: {
      currentFalse:
        falseMode.pairMetrics.find((p) => p.pair === "T1-T2")!.systemCommonPrefixTokens >=
        GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS,
      offlineTrue:
        trueMode.pairMetrics.find((p) => p.pair === "T1-T2")!.systemCommonPrefixTokens >=
        GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS,
    },
    firstVolatileBreak: {
      currentFalse: falseMode.firstVolatileBreakOwner,
      offlineTrue: trueMode.firstVolatileBreakOwner,
    },
    staticFingerprintStableT1T3: {
      currentFalse: "N/A",
      offlineTrue: trueMode.staticFingerprintStableT1T3,
    },
    sectionParityT2: t2Parity,
  };

  let decisionCase = "UNKNOWN";
  const falsePrefix = comparisonTable.stablePrefixTokensT1T2.currentFalse;
  const truePrefix = comparisonTable.stablePrefixTokensT1T2.offlineTrue;
  if (falsePrefix < GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS && truePrefix >= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS && t2Parity.semanticParity) {
    decisionCase = "CASE_A";
  } else if (falsePrefix >= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS) {
    decisionCase = "CASE_B";
  } else if (falsePrefix < GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS && truePrefix < GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS) {
    decisionCase = "CASE_C";
  } else if (truePrefix >= GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS && !t2Parity.semanticParity) {
    decisionCase = "CASE_D";
  }

  const out = {
    generatedAt: new Date().toISOString(),
    audit: "gemini-37-prefix-cache-eligibility-offline",
    fixture: "gemini-37-flash-growing-history T1-T3 (canned assistant from t*-raw.txt)",
    thresholdTokens: GEMINI_IMPLICIT_CACHE_ELIGIBILITY_THRESHOLD_TOKENS,
    currentProductionMode: falseMode,
    offlineStaticDynamicMode: trueMode,
    comparisonTable,
    decisionCase,
    providerGenerationCalls: 0,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "g37-prefix-eligibility-offline.json"),
    `${JSON.stringify(out, null, 2)}\n`,
    "utf8"
  );

  console.log(JSON.stringify({
    decisionCase,
    falsePrefixT1T2: falsePrefix,
    truePrefixT1T2: truePrefix,
    firstBreakFalse: falseMode.firstVolatileBreakOwner,
    firstBreakTrue: trueMode.firstVolatileBreakOwner,
    t2Parity: t2Parity.semanticParity,
  }, null, 2));
}

main();
