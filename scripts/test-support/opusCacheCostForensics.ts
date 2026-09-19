/**
 * Offline / test-only Opus cache-cost forensics helpers.
 * NOT a production runtime owner — scripts + test-support only.
 */
import { createHash } from "node:crypto";
import { adaptCheaperInferenceChatBody, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } from "@/lib/chatModels";
import {
  resolveHistoryCacheBreakpointIndex,
  type OpenRouterSystemSplit,
} from "@/lib/openRouterCache";
import { fingerprintOpenRouterCacheablePrefix } from "@/lib/openRouterCacheStability";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import {
  flattenOpenRouterMessageContent,
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import {
  buildLikeScaleSnapshot,
  koreanRpBlock,
} from "@/lib/opusGeminiSameSnapshotDiagnostic";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";

export const FORENSICS_OPUS_MODEL = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;

/** PR #440 production incident — provider-reported usage (redacted id suffix). */
export const HISTORICAL_INCIDENT_PR440 = {
  source: "PR #440 production example",
  providerRequestIdSuffix: "669865",
  promptTokens: 60_522,
  completionTokens: 6_221,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  standardInputTokens: 60_522,
  billedCostUsd: 0.320_695,
  failureMode: "FULLY_UNCACHED_CONFIRMED" as const,
};

export type CachePrefixFingerprint = {
  systemRulesSha256: string;
  characterSettingsSha256: string;
  combinedFingerprint16: string;
  systemRulesChars: number;
  characterSettingsChars: number;
  dynamicChars: number;
};

export type WireTraceReport = {
  chatId: number;
  sessionIdBeforeAdapt: string | undefined;
  sessionIdAfterAdapt: string | undefined;
  sessionIdStripped: boolean;
  adaptationRemovedKeys: string[];
  ciHeadersPresent: string[];
  ciPromptCacheHeaders: {
    "x-ci-prompt-cache": boolean;
    "x-ci-prompt-cache-scope": boolean;
    "x-ci-prompt-cache-session": boolean;
  };
  cacheControlBlockCount: number;
  historyBreakpointIndex: number | null;
  thinking: unknown;
  hasAssistantPrefill: boolean;
};

export type TurnForensicsRow = {
  turnLabel: string;
  cachePrefix: CachePrefixFingerprint;
  wire: WireTraceReport;
  assembledChars: {
    systemRules: number;
    characterSettings: number;
    dynamic: number;
    historyPrefix: number;
    historyTail: number;
    currentUser: number;
    total: number;
  };
};

export type CacheEconomicsScenario = {
  id: string;
  label: string;
  promptTokens: number;
  standardInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  providerUsd: number;
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function fingerprintCachePrefix(split: OpenRouterSystemSplit): CachePrefixFingerprint {
  const rules = split.systemRulesBlock;
  const character = split.characterSettingsBlock;
  return {
    systemRulesSha256: sha256Hex(rules),
    characterSettingsSha256: sha256Hex(character),
    combinedFingerprint16: fingerprintOpenRouterCacheablePrefix(split),
    systemRulesChars: rules.length,
    characterSettingsChars: character.length,
    dynamicChars: split.dynamicBlock.length,
  };
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

function historyPrefixTailChars(messages: OpenRouterChatMessage[]): {
  prefix: number;
  tail: number;
} {
  const bp = resolveHistoryCacheBreakpointIndex(messages);
  let prefix = 0;
  let tail = 0;
  for (let i = 1; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role === "system") continue;
    const len = flattenOpenRouterMessageContent(m.content).length;
    if (bp != null && i <= bp) prefix += len;
    else if (m.role !== "user" || i !== messages.length - 1) tail += len;
  }
  return { prefix, tail };
}

export function traceCiWireForChat(input: {
  snapshot: Omit<ContextBuildInput, "modelId" | "provider">;
  chatId: number;
  regen?: { messageId: number; attemptId: number };
}): WireTraceReport {
  const built = buildContext({
    ...input.snapshot,
    modelId: FORENSICS_OPUS_MODEL,
    provider: "cheaperinference",
  });
  const history = built.history ?? [];
  const sessionId = input.regen
    ? `chat-${input.chatId}-regen-${input.regen.messageId}-${input.regen.attemptId}`
    : `chat-${input.chatId}`;

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history,
    modelId: FORENSICS_OPUS_MODEL,
    targetResponseChars: input.snapshot.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: input.snapshot.charName,
      sessionId,
    },
  });

  const before = assembled.requestBodyBeforeAdapt;
  const after = assembled.requestBody;
  const headers = buildCheaperInferenceHeaders("offline-test-key");
  const headerKeys = Object.keys(headers);
  const messages = assembled.messages as OpenRouterChatMessage[];
  const last = messages[messages.length - 1];
  const hasAssistantPrefill =
    last?.role === "assistant" &&
    flattenOpenRouterMessageContent(last.content).length < 32;

  return {
    chatId: input.chatId,
    sessionIdBeforeAdapt:
      typeof before.session_id === "string" ? before.session_id : undefined,
    sessionIdAfterAdapt:
      typeof after.session_id === "string" ? after.session_id : undefined,
    sessionIdStripped: "session_id" in before && !("session_id" in after),
    adaptationRemovedKeys: assembled.adaptationKeyDiff.removed,
    ciHeadersPresent: headerKeys,
    ciPromptCacheHeaders: {
      "x-ci-prompt-cache": headerKeys.includes("x-ci-prompt-cache"),
      "x-ci-prompt-cache-scope": headerKeys.includes("x-ci-prompt-cache-scope"),
      "x-ci-prompt-cache-session": headerKeys.includes("x-ci-prompt-cache-session"),
    },
    cacheControlBlockCount: countCacheControl(messages),
    historyBreakpointIndex: resolveHistoryCacheBreakpointIndex(messages),
    thinking: after.thinking,
    hasAssistantPrefill,
  };
}

export function buildTurnForensicsRow(
  turnLabel: string,
  snapshot: Omit<ContextBuildInput, "modelId" | "provider">,
  chatId = 42
): TurnForensicsRow {
  const built = buildContext({
    ...snapshot,
    modelId: FORENSICS_OPUS_MODEL,
    provider: "cheaperinference",
  });
  const split = built.openRouterSystemSplit;
  if (!split) {
    throw new Error("OpenRouter system split missing for Opus forensics");
  }
  const history = built.history ?? [];
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history,
    modelId: FORENSICS_OPUS_MODEL,
    targetResponseChars: snapshot.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: split,
      charName: snapshot.charName,
      sessionId: `chat-${chatId}`,
    },
  });
  const messages = assembled.messages as OpenRouterChatMessage[];
  const { prefix, tail } = historyPrefixTailChars(messages);
  const currentUser =
    messages.at(-1)?.role === "user"
      ? flattenOpenRouterMessageContent(messages.at(-1)!.content).length
      : 0;

  return {
    turnLabel,
    cachePrefix: fingerprintCachePrefix(split),
    wire: traceCiWireForChat({ snapshot, chatId }),
    assembledChars: {
      systemRules: split.systemRulesBlock.length,
      characterSettings: split.characterSettingsBlock.length,
      dynamic: split.dynamicBlock.length,
      historyPrefix: prefix,
      historyTail: tail,
      currentUser,
      total:
        split.systemRulesBlock.length +
        split.characterSettingsBlock.length +
        split.dynamicBlock.length +
        prefix +
        tail +
        currentUser,
    },
  };
}

export function simulateSequentialTurns(baseTurns = 6): TurnForensicsRow[] {
  const base = buildLikeScaleSnapshot();
  const assistantTurn = koreanRpBlock("라이크는 카페 창가에서 잔을 내려놓았다.", 3_975);
  const userTurn = "잠깐만. 거기 보지 마. 나 봐. 그래서 지금은 어떻게 할 거야?";
  const rows: TurnForensicsRow[] = [];

  for (let step = 0; step < 3; step++) {
    const priorHistory = [...(base.shortTermHistory ?? [])];
    for (let i = 0; i < step; i++) {
      priorHistory.push({ role: "user", content: `${userTurn} (extra ${i + 1})` });
      priorHistory.push({ role: "assistant", content: assistantTurn });
    }
    const snapshot: Omit<ContextBuildInput, "modelId" | "provider"> = {
      ...base,
      shortTermHistory: priorHistory,
      currentUserMessage: `${userTurn} (step ${step + 1})`,
      completedTurns: baseTurns + step,
      completedTurnsForMemoryCoverage: baseTurns + step,
    };
    rows.push(buildTurnForensicsRow(`T${step + 1}`, snapshot));
  }
  return rows;
}

export function buildOpusCacheEconomicsScenarios(outputTokens = 2_000): CacheEconomicsScenario[] {
  const modelId = FORENSICS_OPUS_MODEL;
  const scenarios: Array<Omit<CacheEconomicsScenario, "providerUsd">> = [
    {
      id: "PR440",
      label: "PR #440 incident: 60522 std + 6221 out (0/0 cache)",
      promptTokens: HISTORICAL_INCIDENT_PR440.promptTokens,
      standardInputTokens: HISTORICAL_INCIDENT_PR440.standardInputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: HISTORICAL_INCIDENT_PR440.completionTokens,
    },
    {
      id: "A",
      label: "60K all standard input",
      promptTokens: 60_000,
      standardInputTokens: 60_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens,
    },
    {
      id: "B",
      label: "60K all cache read",
      promptTokens: 60_000,
      standardInputTokens: 0,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 0,
      outputTokens,
    },
    {
      id: "C",
      label: "60K all cache write",
      promptTokens: 60_000,
      standardInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 60_000,
      outputTokens,
    },
    {
      id: "D",
      label: "mixed: 4K std + 52K read + 4K write",
      promptTokens: 60_000,
      standardInputTokens: 4_000,
      cacheReadTokens: 52_000,
      cacheWriteTokens: 4_000,
      outputTokens,
    },
  ];

  return scenarios.map((s) => {
    const { usdCost } = openRouterUsdCostFromRates({
      promptTokens: s.promptTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      modelId,
    });
    return { ...s, providerUsd: usdCost };
  });
}

export function reconcileHistoricalIncident440CatalogUsd(): {
  catalogUsd: number;
  reportedBilledUsd: number;
  deltaUsd: number;
} {
  const { usdCost } = openRouterUsdCostFromRates({
    promptTokens: HISTORICAL_INCIDENT_PR440.promptTokens,
    outputTokens: HISTORICAL_INCIDENT_PR440.completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelId: FORENSICS_OPUS_MODEL,
  });
  return {
    catalogUsd: usdCost,
    reportedBilledUsd: HISTORICAL_INCIDENT_PR440.billedCostUsd,
    deltaUsd: Math.abs(usdCost - HISTORICAL_INCIDENT_PR440.billedCostUsd),
  };
}

export function parseUsagePartitionSample(): {
  promptTokens: number;
  standardInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  invariantHolds: boolean;
} {
  const parsed = parseOpenRouterUsage({
    prompt_tokens: 60_000,
    completion_tokens: 2_000,
    prompt_tokens_details: {
      cached_tokens: 52_000,
      cache_creation_input_tokens: 4_000,
    },
  });
  const invariantHolds =
    parsed.promptTokens ===
    parsed.standardInputTokens + parsed.cacheReadTokens + parsed.cacheWriteTokens;
  return {
    promptTokens: parsed.promptTokens,
    standardInputTokens: parsed.standardInputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    cacheWriteTokens: parsed.cacheWriteTokens,
    invariantHolds,
  };
}

/** Live warm-turn reference (LIVE-T2/T3) — deterministic input-cost comparison only. */
export type WarmTurnPatchEconomics = {
  turnLabel: string;
  currentInputUsd: number;
  patchInputUsd: number;
  savingsPct: number;
};

export function computeWarmTurnPatchEconomics(): WarmTurnPatchEconomics[] {
  const modelId = FORENSICS_OPUS_MODEL;
  const rows = [
    {
      turnLabel: "LIVE-T2",
      cacheReadTokens: 17_357,
      cacheWriteTokens: 22_669,
      standardInputTokens: 669,
    },
    {
      turnLabel: "LIVE-T3",
      cacheReadTokens: 17_357,
      cacheWriteTokens: 18_254,
      standardInputTokens: 669,
    },
  ] as const;

  return rows.map((row) => {
    const currentInputUsd = openRouterUsdCostFromRates({
      promptTokens: row.cacheReadTokens + row.cacheWriteTokens + row.standardInputTokens,
      outputTokens: 0,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      modelId,
    }).usdCost;
    const patchInputUsd = openRouterUsdCostFromRates({
      promptTokens: row.cacheReadTokens + row.standardInputTokens + row.cacheWriteTokens,
      outputTokens: 0,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: 0,
      modelId,
    }).usdCost;
    const savingsPct =
      currentInputUsd > 0 ? ((currentInputUsd - patchInputUsd) / currentInputUsd) * 100 : 0;
    return {
      turnLabel: row.turnLabel,
      currentInputUsd,
      patchInputUsd,
      savingsPct,
    };
  });
}
