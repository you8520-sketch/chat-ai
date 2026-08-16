/**
 * Same-snapshot Gemini 3.1 Pro vs Opus 5 payload diagnostic.
 * Production assembly only — does not persist, charge, or rewrite prompts.
 */
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import {
  flattenOpenRouterMessageContent,
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import type { ContextBuildInput } from "@/types";
import type { TrackedPromptSection } from "@/services/promptAudit";
import { buildContext } from "@/services/contextBuilder";

export const DIAGNOSTIC_GEMINI_31_MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
export const DIAGNOSTIC_OPUS_5_MODEL = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;

export type AssembledPromptChars = {
  system: number;
  systemRules: number;
  characterSettings: number;
  dynamic: number;
  history: number;
  currentUser: number;
  total: number;
};

export type PayloadPhysicalSize = {
  model: string;
  provider: "cheaperinference";
  messageCount: number;
  systemChars: number;
  systemUtf8Bytes: number;
  historyUserChars: number;
  historyUserCount: number;
  historyAssistantChars: number;
  historyAssistantCount: number;
  currentUserChars: number;
  totalChars: number;
  totalUtf8Bytes: number;
  estimateTokens: number;
  cacheControlBlocks: number;
  hasAssistantPrefill: boolean;
};

export type SectionDiffRow = {
  id: string;
  geminiChars: number;
  opusChars: number;
  same: boolean;
};

export type SameSnapshotModelReport = {
  model: string;
  contextTrack: string;
  assembled: AssembledPromptChars;
  payload: PayloadPhysicalSize;
  sectionChars: Record<string, number>;
  historyMessageCount: number;
  rawUserChars: number;
  rawAssistantChars: number;
  thinking?: unknown;
  outputConfig?: unknown;
  reasoningEffort?: unknown;
};

export type SameSnapshotReport = {
  gemini: SameSnapshotModelReport;
  opus: SameSnapshotModelReport;
  sectionDiff: {
    same: string[];
    opusOnly: Array<{ id: string; chars: number; estimatedTokens: number }>;
    geminiOnly: Array<{ id: string; chars: number; estimatedTokens: number }>;
    differentContent: Array<{
      id: string;
      geminiChars: number;
      opusChars: number;
    }>;
  };
  physicalDelta: {
    systemChars: number;
    systemRulesChars: number;
    characterSettingsChars: number;
    dynamicChars: number;
    historyChars: number;
    currentUserChars: number;
    totalChars: number;
  };
  receiptSimulation: {
    note: "estimated_section_allocation";
    gemini: Array<{ label: string; est: number; tokens: number; pct: number }>;
    opus: Array<{ label: string; est: number; tokens: number; pct: number }>;
  };
};

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function flattenPayloadMessages(messages: unknown): OpenRouterChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages as OpenRouterChatMessage[];
}

function countCacheControl(messages: OpenRouterChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    n += (m.content as OpenRouterContentBlock[]).filter(
      (b) => b.cache_control?.type === "ephemeral"
    ).length;
  }
  return n;
}

export function allocateEstimatedSectionTokens(
  sections: Array<{ label: string; est: number }>,
  draftInput: number
): Array<{ label: string; est: number; tokens: number; pct: number }> {
  const totalEst = Math.max(1, sections.reduce((s, x) => s + x.est, 0));
  return sections
    .map((s) => ({
      label: s.label,
      est: s.est,
      tokens: Math.round((s.est / totalEst) * draftInput),
      pct: Math.round((s.est / totalEst) * 100),
    }))
    .filter((s) => s.tokens > 0);
}

function measurePayload(
  model: string,
  body: Record<string, unknown>
): PayloadPhysicalSize {
  const messages = flattenPayloadMessages(body.messages);
  let systemChars = 0;
  let historyUserChars = 0;
  let historyUserCount = 0;
  let historyAssistantChars = 0;
  let historyAssistantCount = 0;
  let currentUserChars = 0;
  const texts: string[] = [];

  messages.forEach((m, i) => {
    const text = flattenOpenRouterMessageContent(m.content);
    texts.push(text);
    if (m.role === "system") {
      systemChars += text.length;
      return;
    }
    if (m.role === "user") {
      if (i === messages.length - 1) currentUserChars += text.length;
      else {
        historyUserChars += text.length;
        historyUserCount += 1;
      }
      return;
    }
    if (m.role === "assistant") {
      historyAssistantChars += text.length;
      historyAssistantCount += 1;
    }
  });

  const totalText = texts.join("");
  const last = messages[messages.length - 1];
  const hasAssistantPrefill =
    last?.role === "assistant" &&
    flattenOpenRouterMessageContent(last.content).length < 32;

  return {
    model,
    provider: "cheaperinference",
    messageCount: messages.length,
    systemChars,
    systemUtf8Bytes: utf8Bytes(texts[0] ?? ""),
    historyUserChars,
    historyUserCount,
    historyAssistantChars,
    historyAssistantCount,
    currentUserChars,
    totalChars: totalText.length,
    totalUtf8Bytes: utf8Bytes(totalText),
    estimateTokens: estimateTokens(totalText),
    cacheControlBlocks: countCacheControl(messages),
    hasAssistantPrefill,
  };
}

function sectionMap(sections: TrackedPromptSection[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections ?? []) {
    out[s.id] = (out[s.id] ?? 0) + s.text.length;
  }
  return out;
}

function buildModelReport(
  modelId: string,
  snapshot: Omit<ContextBuildInput, "modelId" | "provider">
): SameSnapshotModelReport {
  const built = buildContext({
    ...snapshot,
    modelId,
    provider: "cheaperinference",
  });
  const split = built.openRouterSystemSplit;
  const history = built.history ?? [];
  const assembled: AssembledPromptChars = {
    system: (built.systemPrompt ?? "").length,
    systemRules: split?.systemRulesBlock.length ?? 0,
    characterSettings: split?.characterSettingsBlock.length ?? 0,
    dynamic: split?.dynamicBlock.length ?? 0,
    history: history.reduce((n, m) => n + (m.content?.length ?? 0), 0),
    currentUser: history.at(-1)?.content.length ?? 0,
    total: 0,
  };
  assembled.total =
    assembled.system +
    history.slice(0, -1).reduce((n, m) => n + (m.content?.length ?? 0), 0) +
    assembled.currentUser;

  const assembledReq = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history,
    modelId,
    targetResponseChars: snapshot.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: split,
      charName: snapshot.charName,
    },
  });

  const rawUserChars = history
    .filter((m) => m.role === "user")
    .reduce((n, m) => n + m.content.length, 0);
  const rawAssistantChars = history
    .filter((m) => m.role === "assistant")
    .reduce((n, m) => n + m.content.length, 0);

  return {
    model: modelId,
    contextTrack: modelId.includes("claude") ? "claude-diet-via-id" : "claude-diet-via-ci-openrouter-remap",
    assembled,
    payload: measurePayload(modelId, assembledReq.requestBody),
    sectionChars: sectionMap(built.meta.trackedSections),
    historyMessageCount: history.length,
    rawUserChars,
    rawAssistantChars,
    thinking: assembledReq.requestBody.thinking,
    outputConfig: assembledReq.requestBody.output_config,
    reasoningEffort: assembledReq.requestBody.reasoning_effort,
  };
}

export function diagnoseSameSnapshot(
  snapshot: Omit<ContextBuildInput, "modelId" | "provider">
): SameSnapshotReport {
  const gemini = buildModelReport(DIAGNOSTIC_GEMINI_31_MODEL, snapshot);
  const opus = buildModelReport(DIAGNOSTIC_OPUS_5_MODEL, snapshot);

  const geminiIds = new Set(Object.keys(gemini.sectionChars));
  const opusIds = new Set(Object.keys(opus.sectionChars));
  const same: string[] = [];
  const opusOnly: SameSnapshotReport["sectionDiff"]["opusOnly"] = [];
  const geminiOnly: SameSnapshotReport["sectionDiff"]["geminiOnly"] = [];
  const differentContent: SameSnapshotReport["sectionDiff"]["differentContent"] = [];

  for (const id of opusIds) {
    if (!geminiIds.has(id)) {
      const chars = opus.sectionChars[id] ?? 0;
      opusOnly.push({ id, chars, estimatedTokens: estimateTokens("x".repeat(chars)) });
      continue;
    }
    const g = gemini.sectionChars[id] ?? 0;
    const o = opus.sectionChars[id] ?? 0;
    if (g === o) same.push(id);
    else differentContent.push({ id, geminiChars: g, opusChars: o });
  }
  for (const id of geminiIds) {
    if (opusIds.has(id)) continue;
    const chars = gemini.sectionChars[id] ?? 0;
    geminiOnly.push({ id, chars, estimatedTokens: estimateTokens("x".repeat(chars)) });
  }

  const receiptSections = (report: SameSnapshotModelReport) => [
    { label: "최근 raw 턴", est: estimateTokens("x".repeat(Math.max(0, report.assembled.history - report.assembled.currentUser))) },
    { label: "캐릭터 프롬프트", est: estimateTokens("x".repeat(report.assembled.characterSettings)) },
    { label: "시스템 프롬프트 (고정 규칙)", est: estimateTokens("x".repeat(report.assembled.systemRules)) },
    { label: "장기 기억 (현재기억)", est: estimateTokens("x".repeat(report.assembled.dynamic)) },
  ];

  return {
    gemini,
    opus,
    sectionDiff: { same, opusOnly, geminiOnly, differentContent },
    physicalDelta: {
      systemChars: opus.assembled.system - gemini.assembled.system,
      systemRulesChars: opus.assembled.systemRules - gemini.assembled.systemRules,
      characterSettingsChars:
        opus.assembled.characterSettings - gemini.assembled.characterSettings,
      dynamicChars: opus.assembled.dynamic - gemini.assembled.dynamic,
      historyChars: opus.assembled.history - gemini.assembled.history,
      currentUserChars: opus.assembled.currentUser - gemini.assembled.currentUser,
      totalChars: opus.assembled.total - gemini.assembled.total,
    },
    receiptSimulation: {
      note: "estimated_section_allocation",
      gemini: allocateEstimatedSectionTokens(receiptSections(gemini), 28_000),
      opus: allocateEstimatedSectionTokens(receiptSections(opus), 53_000),
    },
  };
}

export function koreanRpBlock(seed: string, targetChars: number): string {
  const unit = `${seed} 공기가 낮고 조명이 흔들렸다. 라이크는 한 걸음 다가와 시선을 맞춘 뒤 말을 이었다. 손끝이 테이블 가장자리에 닿았고, 그 사이의 침묵이 한 박자 더 길었다. `;
  let out = "";
  while (out.length < targetChars) out += unit;
  return out.slice(0, targetChars);
}

/** Production-like 6-turn snapshot (Like-scale RAW, no DB). */
export function buildLikeScaleSnapshot(): Omit<ContextBuildInput, "modelId" | "provider"> {
  const assistantTurn = koreanRpBlock("라이크는 카페 창가에서 잔을 내려놓았다.", 3_975);
  const userTurn = "잠깐만. 거기 보지 마. 나 봐. 그래서 지금은 어떻게 할 거야?";
  const priorHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < 6; i++) {
    priorHistory.push({ role: "user", content: `${userTurn} (${i + 1})` });
    priorHistory.push({ role: "assistant", content: assistantTurn });
  }
  const identity = koreanRpBlock(
    "[Identity]\n라이크. 카페 알바. 차분하고 관찰이 많다.",
    4_200
  );
  const world = koreanRpBlock("[World]\n늦은 밤 카페. 단골과 알바의 거리.", 3_200);
  const personality = koreanRpBlock(
    "[Personality]\n말이 짧고 시선이 먼저 움직인다.",
    2_400
  );
  return {
    charName: "라이크",
    chunks: [
      {
        id: "like-identity",
        characterId: "18",
        content: identity,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: estimateTokens(identity),
        keywords: ["라이크"],
      },
      {
        id: "like-world",
        characterId: "18",
        content: world,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: estimateTokens(world),
        keywords: ["카페"],
      },
      {
        id: "like-personality",
        characterId: "18",
        content: personality,
        category: "personality",
        importance: "CRITICAL",
        tokenCount: estimateTokens(personality),
        keywords: ["말투"],
      },
    ],
    userNickname: "유저",
    personaDisplayName: "태현",
    userPersona: "태현. 자주 오는 손님. 말이 먼저 나온다.",
    userNote: "관계는 천천히. 과한 밀당 금지.",
    longTermMemory: "어제 창가 자리에서 짧게 이야기했다. 라이크는 이름을 기억한다.",
    memoryMeta: "친밀도: 낮음. 호칭: 손님.",
    shortTermHistory: priorHistory,
    currentUserMessage: `${userTurn} (now)`,
    nsfw: false,
    gender: "female",
    userPersonaGender: "male",
    completedTurns: 6,
    completedTurnsForMemoryCoverage: 6,
    summarizedTurnCount: 0,
    historyMinTurnFloor: 6,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    userId: 1,
  };
}
