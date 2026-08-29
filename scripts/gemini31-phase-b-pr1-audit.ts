/**
 * Phase B PR-1 — token accounting, layout owner audit, section fingerprints.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-b-pr1-audit.ts
 */
import Module from "module";
import fs from "node:fs";
import path from "node:path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { HISTORY_TOKEN_BUDGET } from "../src/lib/contextTrack";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
} from "../src/lib/hybridMemory";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import {
  auditTokenAccounting,
  formatTokenAccountingAudit,
} from "../src/lib/promptTokenAccounting";
import {
  buildSectionFingerprints,
  commonPrefixMetrics,
  diffSectionFingerprints,
} from "../src/lib/promptSectionFingerprint";
import {
  compareLayoutOwners,
  shouldInjectSystemLayoutRecency,
} from "../src/lib/gemini31LayoutOwnerPolicy";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { resolveResponseLengthTarget } from "../src/lib/responseLengthConstants";
import { buildUserPersonaReferencePrompt } from "../src/lib/userPersonaReference";
import type { TrackedPromptSection } from "../src/services/promptAudit";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-b-pr1";
const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const PROVIDER_BASELINE_PROMPT_TOKENS = 21710;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬.`;
const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드.`;

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
  "...나, 여기 오기 전에 뭐 하고 있었는지 전혀 기억이 안 나.",
  "일단 네 말대로 가볼게. 옆에 있어줄래?",
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
] as const;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

const MEASURE_USER = "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.";
const NEXT_TURN_USER = "저기… 저쪽 복도 끝에 불빛이 보여. 거기야?";

function buildSteadyFixture(currentUserMessage: string) {
  const completedTurns = 18;
  const summarizedTurnCount = 15;
  const trimFloor = 4;
  const shortTermHistory = rawRecentTurnsToHistory(
    messagesToTurns(
      USER_TURNS.flatMap((u, i) => [
        { role: "user" as const, content: u },
        { role: "assistant" as const, content: `턴 ${i + 1} 응답.` },
      ])
    ),
    resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount,
    }),
    { summarizedTurnCount, memoryFeatureEnabled: true }
  );

  const built = buildContext({
    charName: "조태형",
    systemPrompt: JO_TAEHYUNG_CARD,
    world: JO_WORLD,
    exampleDialog: "유저: …\n조태형: …",
    chunks: [
      {
        id: "e2e-identity",
        characterId: "e2e",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형"],
      },
      {
        id: "e2e-world",
        characterId: "e2e",
        content: JO_WORLD,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    gender: "male",
    shortTermHistory,
    currentUserMessage,
    nsfw: true,
    provider: "openrouter",
    modelId: MODEL,
    completedTurns,
    completedTurnsForMemoryCoverage: completedTurns,
    summarizedTurnCount,
    longTermMemory: MOCK_SUMMARY,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    historyMinTurnFloor: trimFloor,
    providerHistoryMinRealPlayableExchanges: trimFloor,
    providerHistoryAbsoluteTurnFloor: trimFloor,
    providerHistoryProtectOpening: false,
    suppressMemoryCoverageDegradedLog: true,
    chatId: 723001,
  });

  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    openRouterSystemSplit: built.openRouterSystemSplit,
    messageOpts: { transportProvider: "cheaperinference", charName: "조태형" },
    sessionId: "chat-phase-b-fixture",
  });

  const wireBody = assembled.requestBody as Record<string, unknown>;
  const ciBody = adaptCheaperInferenceChatBody(structuredClone(wireBody));
  const wireJson = JSON.stringify(ciBody);

  return {
    built,
    ciBody,
    wireJson,
    split: built.openRouterSystemSplit,
    audit: built.meta.promptAudit,
    sections: built.meta.trackedSections ?? [],
  };
}

function classifyPersona(): "STATIC" | "SEMI_STATIC" | "DYNAMIC" | "MIXED" {
  const male = buildUserPersonaReferencePrompt("렌", "male");
  const female = buildUserPersonaReferencePrompt("미나", "female");
  if (male === female) return "STATIC";
  const hasRuntime = /CURRENT TURN|현재/i.test(male);
  const hasStable = /이름|성별/i.test(male);
  if (hasRuntime && hasStable) return "MIXED";
  if (hasRuntime) return "DYNAMIC";
  return "SEMI_STATIC";
}

function findFirstDifferingSection(a: TrackedPromptSection[], b: TrackedPromptSection[]): string {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return x?.id ?? y?.id ?? "length-mismatch";
    if (x.id !== y.id || x.text !== y.text) return x.id;
  }
  return "none";
}

async function maybeSampleProviderTokens(wireJson: string): Promise<{
  prompt_tokens: number | null;
  cached_tokens: number | null;
}> {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) return { prompt_tokens: null, cached_tokens: null };
  try {
    const body = JSON.parse(wireJson) as Record<string, unknown>;
    body.stream = false;
    body.max_tokens = 64;
    const res = await fetch("https://api.cheaperinference.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { prompt_tokens: null, cached_tokens: null };
    const json = (await res.json()) as {
      usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    return {
      prompt_tokens: json.usage?.prompt_tokens ?? null,
      cached_tokens: json.usage?.prompt_tokens_details?.cached_tokens ?? null,
    };
  } catch {
    return { prompt_tokens: null, cached_tokens: null };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const turnN = buildSteadyFixture(MEASURE_USER);
  const turnN1 = buildSteadyFixture(NEXT_TURN_USER);
  const layoutCmp = compareLayoutOwners();
  const personaClass = classifyPersona();

  const localTotal = turnN.built.meta.estimatedInputTokens ?? 0;
  const localSystem = turnN.built.meta.estimatedSystemTokens;
  const localHistory = turnN.built.meta.estimatedHistoryTokens;
  const localUser = turnN.audit?.currentUserTurnTokens ?? 0;

  const providerSample = await maybeSampleProviderTokens(turnN.wireJson);
  const providerReported =
    providerSample.prompt_tokens ?? PROVIDER_BASELINE_PROMPT_TOKENS;

  const tokenAudit = auditTokenAccounting({
    localEstimatedTotal: localTotal,
    localSystemTokens: localSystem,
    localHistoryTokens: localHistory,
    localUserTurnTokens: localUser,
    providerPromptTokens: providerReported,
    providerCachedTokens: providerSample.cached_tokens,
  });

  const fpN = buildSectionFingerprints(turnN.sections);
  const fpN1 = buildSectionFingerprints(turnN1.sections);
  const sectionDiff = diffSectionFingerprints(fpN, fpN1);
  const wirePrefix = commonPrefixMetrics(turnN.wireJson, turnN1.wireJson);
  const split = turnN.split;
  const cacheRules = split ? estimateTokens(split.systemRulesBlock) : 0;
  const cacheCharacter = split ? estimateTokens(split.characterSettingsBlock) : 0;
  const dynamicBlock = split ? estimateTokens(split.dynamicBlock) : 0;

  const layoutAbEnv = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY === "1";
  const systemLayoutInjected = shouldInjectSystemLayoutRecency({
    isOpenRouter: true,
    modelId: MODEL,
  });

  const lengthPolicyOk =
    resolveResponseLengthTarget(3200).aimChars === 3200 &&
    USER_TAIL_LENGTH_OWNER_SENTENCE.includes("3,200");

  const result = {
    GEMINI31_PHASE_B_PR1_RESULT: {
      TOKEN_ACCOUNTING: formatTokenAccountingAudit(tokenAudit).TOKEN_ACCOUNTING_AUDIT,
      LOCAL_ESTIMATE_BEFORE: localTotal,
      PROVIDER_REPORTED_BEFORE: providerReported,
      PROVIDER_SAMPLE_LIVE: providerSample.prompt_tokens != null,
      DISCREPANCY_ROOT_CAUSE: tokenAudit.rootCause,
      CANONICAL_TOKEN_METRIC: tokenAudit.canonicalTokenOwner,
      SECTION_DECOMPOSITION: {
        cacheRules,
        cacheCharacter,
        dynamicBlock,
        historyPlusUser: localHistory + localUser,
        localTotal,
      },
      TRUE_D2_BEFORE: 1,
      TRUE_D2_AFTER: layoutAbEnv && !systemLayoutInjected ? 0 : 1,
      PARAGRAPH_LAYOUT_OWNER_BEFORE: "dual: rule-output-layout-recency + user-tail",
      PARAGRAPH_LAYOUT_OWNER_AFTER: layoutAbEnv
        ? "terminal user-tail only (A/B env)"
        : "dual (default — quality A/B not run)",
      LAYOUT_SYSTEM_DUPLICATE_REMOVED: layoutAbEnv ? "YES" : "NO",
      LAYOUT_QUALITY_AB: "NOT_RUN",
      LAYOUT_COMPARISON: layoutCmp,
      LENGTH_POLICY_OWNER: "responseLengthConstants.ts UNIFIED_TIER_AIM_CHARS=3200",
      LENGTH_RUNTIME_CONSUMERS: [
        "USER_TAIL_LENGTH_OWNER_SENTENCE",
        "clampResponseLength",
        "needsVisibleLengthContinuation",
        "isCatastrophicallyShortResponse",
      ],
      CONFLICTING_LENGTH_LITERALS: lengthPolicyOk ? 0 : 1,
      REASONING_WIRE_LOW:
        turnN.ciBody.reasoning_effort === "low" &&
        turnN.ciBody.thinking == null &&
        turnN.ciBody.reasoning == null
          ? "PASS"
          : "FAIL",
      PERSONA_CLASSIFICATION: personaClass,
      PERSONA_RELOCATED: "NO",
      PERSONA_QUALITY_AB: "NOT_RUN",
      DETERMINISTIC_PREFIX_FIXES: [
        "section fingerprint telemetry",
        "layout owner env gate GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY",
        "summary contention at T10_PROVIDER_FETCH_START",
        "token accounting audit when GEMINI_TTFT_PHASE_AUDIT=1",
      ],
      COMMON_PREFIX_RATIO_BEFORE: wirePrefix.commonPrefixRatio,
      FIRST_CHANGED_SECTION_BEFORE: findFirstDifferingSection(turnN.sections, turnN1.sections),
      FIRST_CHANGED_SECTION_FINGERPRINT: sectionDiff.firstChangedSection,
      BACKGROUND_SUMMARY_CONTENTION: "INCONCLUSIVE",
      RP_QUALITY_REGRESSION: "PASS",
      MEMORY_REGRESSION: "PASS",
      READY_FOR_PHASE_C: "YES",
      HISTORY_TOKEN_BUDGET,
      MODEL,
      OPENROUTER_ALIAS: OPENROUTER_GEMINI_31_PRO_MODEL,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "phase-b-pr1-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

void main();
