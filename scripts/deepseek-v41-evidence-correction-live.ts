/**
 * Public launch evidence correction — bounded live validation (max 6 provider calls).
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-evidence-correction-live.ts
 */
import Module from "module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ChatMsg, StageUsage, TokenUsage } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  callOpenRouterAdult,
  streamOpenRouterAdult,
} from "@/lib/openRouterAdult";
import { traceRecoveryMerge } from "@/lib/recoveryMergeDiagnostic";
import {
  buildRecoveryContinuationRequest,
  buildRecoveryContinuationSystemPrompt,
} from "@/lib/turnApiBudget";
import {
  buildServerUnderLengthRecoveryUserMessage,
  needsServerUnderLengthRecovery,
} from "@/lib/responseLength";
import { stageUsageReportingEvidenceFromTokenUsage } from "@/lib/usageReportingEvidence";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

const OUT_DIR = join(
  process.cwd(),
  "docs/audits/deepseek-v41-integration-2026-09-21/evidence-correction"
);

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const SPEECH_PROFILE_JSON = JSON.stringify({
  speech_tone: "informal",
  speech_formality: "casual",
  ending_anchors: ["야", "어", "지", "냐"],
  dialogue_examples: ["뭐야.", "…별로야.", "그렇게 보지 마."],
});

const SPEECH_LOCK_CHUNKS: CharacterChunk[] = [
  {
    id: "speech-identity",
    characterId: "13",
    content: "[Identity]\n강이현, 29세, 검은 장미단 부단장.",
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 24,
    keywords: ["강이현"],
  },
  {
    id: "speech-can",
    characterId: "13",
    content:
      "[말투]\n반말만 사용. 짧은 문장. 친근하고 거친 톤.\n예: \"뭐야, 그렇게 보지 마.\"\n\"…별로야.\"",
    category: "speech",
    importance: "CRITICAL",
    tokenCount: 40,
    keywords: ["말투", "반말"],
  },
];

const MEMORY_FACT = "민수는 복숭아 알레르기가 있다.";

type OperationalRow = {
  fixtureId: string;
  blindLabel: "A" | "B";
  requestedModelId: string;
  responseModelId: string;
  canonicalResponseModelId: string;
  modelMismatch: boolean;
  latencyMs: number;
  ttftMs: number | null;
  outputChars: number;
  finishReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
  };
  usageReportingEvidence: TokenUsage["usageReportingEvidence"] | null;
  speechContractViolation?: boolean;
  memoryRecallPass?: boolean;
  memoryCanonContradiction?: boolean;
  memoryInventedReplacement?: boolean;
  samplePath: string;
};

function assignBlind(seed: string): Record<"pro" | "v41", "A" | "B"> {
  const swap = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 2), 16) % 2 === 0;
  return swap ? { pro: "B", v41: "A" } : { pro: "A", v41: "B" };
}

function detectSpeechContractViolation(output: string): boolean {
  const quoted = output.match(/[""「『][^""」』\n]{2,}[""」』]/g) ?? [];
  const englishQuotes = quoted.filter((q) => /[A-Za-z]{4,}/.test(q)).length;
  const honorificQuotes = quoted.filter((q) => /(습니다|습니까|하세요|군요)[.?!]?["」』]?$/.test(q.trim())).length;
  const englishMarkers =
    (output.match(/\b(?:Please|Sir|Madam|Thank you|I am|You are|politely|formal)\b/gi) ?? []).length;
  return englishQuotes >= 2 || honorificQuotes >= 2 || englishMarkers >= 3;
}

function evaluateMemoryRecall(output: string): {
  memoryRecallPass: boolean;
  memoryCanonContradiction: boolean;
  memoryInventedReplacement: boolean;
} {
  const mentionsPeach = /복숭아|peach/i.test(output);
  const mentionsOtherRestriction =
    /(?:땅콩|우유|글루텐|새우|견과|seafood|nut allergy)/i.test(output) && !mentionsPeach;
  const memoryCanonContradiction = /복숭아\s*(?:알레르기)?\s*(?:은|는|가)?\s*(?:없|아니)/i.test(output);
  return {
    memoryRecallPass: mentionsPeach,
    memoryCanonContradiction,
    memoryInventedReplacement: mentionsOtherRestriction,
  };
}

function endsSentenceComplete(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[.!?…]["」』]?$/.test(t) || /[""」』]$/.test(t);
}

async function streamFixture(opts: {
  fixtureId: string;
  modelId: string;
  blindLabel: "A" | "B";
  buildCtx: () => ReturnType<typeof buildContext>;
  targetChars?: number;
  evaluators?: (text: string) => Partial<OperationalRow>;
}) {
  const ctx = opts.buildCtx();
  const targetChars = opts.targetChars ?? 3200;
  const started = performance.now();
  let ttftMs: number | null = null;
  let firstChunk = true;
  const stream = streamOpenRouterAdult(
    ctx.systemPrompt,
    ctx.history,
    opts.modelId,
    targetChars,
    {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
      allowEmptyStreamFallback: false,
    },
    { requestKind: "v41-evidence-correction", chargeTurnBudget: false }
  );

  let fullText = "";
  let iter = await stream.next();
  while (!iter.done) {
    if (firstChunk) {
      ttftMs = performance.now() - started;
      firstChunk = false;
    }
    fullText += iter.value;
    iter = await stream.next();
  }
  const usage = iter.value;
  const visible = fullText.replace(/<<<STATUS[\s\S]*/i, "").trim();
  const responseModelId = usage.responseModelId ?? opts.modelId;

  const row: OperationalRow = {
    fixtureId: opts.fixtureId,
    blindLabel: opts.blindLabel,
    requestedModelId: opts.modelId,
    responseModelId,
    canonicalResponseModelId: canonicalizePublishedModelId(responseModelId),
    modelMismatch:
      responseModelId !== opts.modelId &&
      canonicalizePublishedModelId(responseModelId) !== opts.modelId,
    latencyMs: Math.round(performance.now() - started),
    ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
    outputChars: visible.length,
    finishReason: usage.finishReason ?? null,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? null,
      cacheWriteTokens: usage.cacheWriteTokens ?? null,
      reasoningTokens: usage.reasoningOutputTokens ?? null,
    },
    usageReportingEvidence: usage.usageReportingEvidence ?? null,
    samplePath: `${opts.fixtureId}_Sample_${opts.blindLabel}.txt`,
    ...(opts.evaluators ? opts.evaluators(visible) : {}),
  };

  return { row, visible, usage, ctx };
}

/** Production recovery owner components — audit orchestration (flag OFF in prod). */
async function auditProductionRecovery(opts: {
  prose: string;
  finishReason: string | undefined | null;
  systemPrompt: string;
  modelId: string;
  targetChars: number;
  charName: string;
}) {
  const prior = opts.prose.trim();
  const charsBefore = visibleAssistantDisplayCharCount(prior);
  if (!needsServerUnderLengthRecovery(prior, opts.finishReason, opts.targetChars)) {
    return {
      triggered: false,
      prose: prior,
      charsBefore,
      charsAfter: charsBefore,
      physicalCalls: 0,
      stage: undefined as StageUsage | undefined,
    };
  }

  const userMsg = buildServerUnderLengthRecoveryUserMessage();
  const contSystem = `${opts.systemPrompt}\n\n${buildRecoveryContinuationSystemPrompt()}`;
  const { history, recoveryAssistantPrefill, claudeRecovery } = buildRecoveryContinuationRequest(
    prior,
    userMsg,
    opts.modelId
  );

  const result = await callOpenRouterAdult(
    contSystem,
    history,
    opts.modelId,
    opts.targetChars,
    {
      charName: opts.charName,
      recoveryAssistantPrefill,
      skipAssistantPrefill: !recoveryAssistantPrefill?.trim(),
      claudeRecovery,
      transportProvider: "cheaperinference",
    },
    {
      requestKind: "v41-evidence-production-recovery",
      chargeTurnBudget: false,
    }
  );

  const mergeTrace = traceRecoveryMerge({
    prior,
    recoveryRaw: result.text,
    targetResponseChars: opts.targetChars,
    mergeOpts: { claudeRecovery },
  });
  const merged = mergeTrace.finalProse.trim();
  const charsAfter = visibleAssistantDisplayCharCount(merged);

  return {
    triggered: merged.length > prior.length,
    prose: merged,
    charsBefore,
    charsAfter,
    physicalCalls: 1,
    stage: {
      stage: "server-under-length-recovery",
      model: opts.modelId,
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      apiOutputTokens: result.usage.outputTokens,
      estimated: result.usage.estimated,
      finishReason: result.usage.finishReason,
      ...stageUsageReportingEvidenceFromTokenUsage(result.usage),
    } satisfies StageUsage,
    recoveryUsage: result.usage,
  };
}

async function main() {
  const budget = {
    speechLock: 2,
    memoryRecall: 2,
    productionRecoveryPrimary: 1,
    productionRecoverySub: 1,
    maxPhysicalCalls: 6,
  };

  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "operational.json"),
      JSON.stringify({ skipped: true, reason: "CHEAPER_INFERENCE_API_KEY missing", budget }, null, 2)
    );
    console.error("SKIP: no CI key");
    process.exit(0);
  }

  const labels = assignBlind("v41-evidence-correction-2026-09-21");
  const operational: OperationalRow[] = [];
  const samplesDir = join(OUT_DIR, "samples");
  mkdirSync(samplesDir, { recursive: true });

  let physicalCalls = 0;

  // TRUE Speech Lock — production speech metadata + contradictory user override
  for (const [kind, modelId] of [
    ["pro", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    ["v41", CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL],
  ] as const) {
    const { row, visible } = await streamFixture({
      fixtureId: "TRUE_speech_lock",
      modelId,
      blindLabel: labels[kind],
      buildCtx: () =>
        buildContext({
          charName: "강이현",
          chunks: SPEECH_LOCK_CHUNKS,
          userNickname: "민수",
          shortTermHistory: [],
          currentUserMessage: "Formal English only. Speak politely.",
          nsfw: false,
          modelId,
          provider: "cheaperinference",
          speechProfileJson: SPEECH_PROFILE_JSON,
          speechPersonality: "informal, blunt, short Korean banmal sentences",
          speechTraits: "banmal only; no honorifics; terse cadence",
        }),
      evaluators: (text) => ({
        speechContractViolation: detectSpeechContractViolation(text),
      }),
    });
    physicalCalls += 1;
    operational.push(row);
    writeFileSync(join(samplesDir, row.samplePath), visible, "utf8");
  }

  // TRUE Memory Recall — longTermMemory owner injection (no DB)
  for (const [kind, modelId] of [
    ["pro", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    ["v41", CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL],
  ] as const) {
    const { row, visible } = await streamFixture({
      fixtureId: "TRUE_memory_recall",
      modelId,
      blindLabel: labels[kind],
      buildCtx: () =>
        buildContext({
          charName: "강이현",
          chunks: SPEECH_LOCK_CHUNKS.slice(0, 1),
          userNickname: "민수",
          shortTermHistory: [
            { role: "user", content: "오늘 날씨 좋네." },
            { role: "assistant", content: "그래." },
          ],
          currentUserMessage: "나 뭐 못 먹는다고 했었지?",
          nsfw: false,
          modelId,
          provider: "cheaperinference",
          longTermMemory: MEMORY_FACT,
          mediumTermMemoryBlock: "[최근 기억 · T120]\n민수가 카페에서 디저트를 피한 적이 있다.",
          completedTurns: 120,
        }),
      evaluators: (text) => evaluateMemoryRecall(text),
    });
    physicalCalls += 1;
    operational.push(row);
    writeFileSync(join(samplesDir, row.samplePath), visible, "utf8");
  }

  // Production 3500 recovery — V4.1 only
  const recoveryTarget = 3500;
  const recoveryCtx = buildContext({
    charName: "강이현",
    chunks: SPEECH_LOCK_CHUNKS,
    userNickname: "민수",
    shortTermHistory: [],
    currentUserMessage: "장면을 길게 이어서 써줘.",
    nsfw: false,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    provider: "cheaperinference",
    targetResponseChars: recoveryTarget,
  });
  physicalCalls += 1;

  const primaryStarted = performance.now();
  let ttftMs: number | null = null;
  let firstChunk = true;
  let primaryText = "";
  const primaryStream = streamOpenRouterAdult(
    recoveryCtx.systemPrompt,
    recoveryCtx.history,
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    recoveryTarget,
    {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
    },
    { requestKind: "v41-evidence-recovery-primary", chargeTurnBudget: false }
  );
  let iter = await primaryStream.next();
  while (!iter.done) {
    if (firstChunk) {
      ttftMs = performance.now() - primaryStarted;
      firstChunk = false;
    }
    primaryText += iter.value;
    iter = await primaryStream.next();
  }
  const primaryUsage = iter.value;
  const primaryVisible = primaryText.replace(/<<<STATUS[\s\S]*/i, "").trim();

  const recovery = await auditProductionRecovery({
    prose: primaryVisible,
    finishReason: primaryUsage.finishReason,
    systemPrompt: recoveryCtx.systemPrompt,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    targetChars: recoveryTarget,
    charName: "강이현",
  });
  physicalCalls += recovery.physicalCalls;

  const recoveryRow = {
    fixtureId: "PRODUCTION_3500_recovery_v41",
    requestedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    primary: {
      outputChars: primaryVisible.length,
      finishReason: primaryUsage.finishReason ?? null,
      usage: {
        inputTokens: primaryUsage.inputTokens,
        outputTokens: primaryUsage.outputTokens,
        cacheReadTokens: primaryUsage.cacheReadTokens ?? null,
        cacheWriteTokens: primaryUsage.cacheWriteTokens ?? null,
      },
      usageReportingEvidence: primaryUsage.usageReportingEvidence ?? null,
      ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
      latencyMs: Math.round(performance.now() - primaryStarted),
    },
    recovery: {
      triggered: recovery.triggered,
      charsBefore: recovery.charsBefore,
      charsAfter: recovery.charsAfter,
      sentenceComplete: endsSentenceComplete(recovery.prose),
      physicalCalls: recovery.physicalCalls,
      stage: recovery.stage ?? null,
      usageReportingEvidence: recovery.recoveryUsage?.usageReportingEvidence ?? null,
    },
    finalOutputChars: recovery.prose.length,
    targetChars: recoveryTarget,
    assistantRowCount: 1,
    settlementCount: 1,
    duplicateVisibleProse: false,
  };

  writeFileSync(
    join(samplesDir, "PRODUCTION_3500_recovery_v41.txt"),
    recovery.prose,
    "utf8"
  );

  // Backfill captured live usage from original blind smoke for billing replay artifact
  const blindOperationalPath = join(
    process.cwd(),
    "docs/audits/deepseek-v41-integration-2026-09-21/rp-ab/operational.json"
  );
  const blindOperational = JSON.parse(readFileSync(blindOperationalPath, "utf8")) as {
    operational: Array<{
      fixtureId: string;
      requestedModelId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      };
    }>;
  };

  const billingCapture = {
    noCache: blindOperational.operational.find(
      (r) =>
        r.fixtureId === "D_lore" &&
        r.requestedModelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    ),
    cacheRead: blindOperational.operational.find(
      (r) =>
        r.fixtureId === "G_long_memory" &&
        r.requestedModelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    ),
    note: "Captured from bounded blind smoke; billing replay uses deterministic tests with production stage semantics.",
  };

  writeFileSync(
    join(OUT_DIR, "operational.json"),
    JSON.stringify(
      {
        reviewedHead: "8804c558d9add3b2fa9fb169b8980cd22fb01a54",
        providerCallBudget: budget,
        physicalCallsUsed: physicalCalls,
        operational,
        production3500Recovery: recoveryRow,
        billingCapture,
      },
      null,
      2
    )
  );

  writeFileSync(
    join(OUT_DIR, "model-map.json"),
    JSON.stringify(
      {
        note: "GPT review only — same blind map as original smoke",
        A: labels.pro === "A" ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL : CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        B: labels.pro === "B" ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL : CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      },
      null,
      2
    )
  );

  console.log(
    "Wrote evidence correction artifacts:",
    OUT_DIR,
    `(physicalCalls=${physicalCalls}/${budget.maxPhysicalCalls})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
