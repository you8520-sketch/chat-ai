/**
 * #1486 Phase 2B — CURRENT_CODE_DETERMINISTIC 5-turn summary packet.
 * Character 라이크 18 / persona 렌. Canned summaries are not Luna output.
 * No provider POST. Cursor does not assign a summary quality score.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";

import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE,
  canClaimCurrentLiveProvider,
} from "@/lib/memory/memoryEvidenceProvenance";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "@/lib/memory/memory-constants";
import {
  ROLLING_SUMMARY_EPISTEMIC_POLICY,
  ROLLING_SUMMARY_SYSTEM_PROMPT,
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  buildRollingSummarySystemPrompt,
  summarizeTurnBatch,
} from "@/lib/memory/memory-rolling-summary";
import {
  isRollingSummaryGroundedInDialogue,
  validateSummaryNarrative,
} from "@/lib/memory/memory-summary-integrity";
import { formatMemoryBlock } from "@/lib/memory/memory-turn-summary";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const LIVE = RP_QUALITY_PRECALL_TARGET_SELECTOR;

const FIXTURE_IDENTITY =
  "이름/호칭: 라이크\n성별: 남\nPhase 2B fixture identity — not the production character sheet.";
const FIXTURE_PERSONA =
  "이름/호칭: 렌\n성별: 남\nPhase 2B fixture persona — not a live user row.";

/** Fictional 5-turn source. Not production chat logs. */
const PHASE2B_TURNS = [
  {
    turnIndex: 1,
    turn: {
      user: "저녁 일곱 시, 옥상에서 라이크에게 황동 라이터를 건넨다. 지난달에 처음 만난 건 맞잖아.",
      assistant:
        "라이크는 라이터를 받아 주머니에 넣었다. \"우린 어릴 때부터 알았어.\" 렌이 지난달에 처음 만났다고 하자 그는 어깨만 으쓱했다.",
    },
  },
  {
    turnIndex: 2,
    turn: {
      user: "여덟 시, 계단에서 떠나지 않고 남는다. 화를 풀 때까지 여기 있을게.",
      assistant:
        "라이크의 화가 가라앉고 그는 렌에게 미안하다고 했다. 렌이 남기로 한 뒤에야 목소리가 낮아졌다.",
    },
  },
  {
    turnIndex: 3,
    turn: {
      user: "같은 계단에 다시 앉아 라이크가 먼저 안길 때까지 따른다.",
      assistant:
        "라이크가 먼저 렌을 안았고 렌이 따랐다. 라이크는 받은 황동 라이터로 담배를 붙였다. 비슷한 침묵이 한 번 더 이어졌다.",
    },
  },
  {
    turnIndex: 4,
    turn: {
      user: "내일 아침 여섯 시에 역에서 기다리겠다는 말을 듣는다. 그래, 거기서 보자.",
      assistant:
        "라이크는 내일 아침 여섯 시에 역에서 기다리겠다고 약속했다. 렌이 받자 그는 짧게 고개를 끄덕였다.",
    },
  },
  {
    turnIndex: 5,
    turn: {
      user: "다음날 아침 여섯 시 십 분, 역에 조금 늦게 도착한다.",
      assistant:
        "라이크는 이미 역에서 기다리고 있었고 황동 라이터는 여전히 그의 주머니에 있었다. 시계는 여섯 시 십 분을 가리켰다.",
    },
  },
] as const;

const MUST_KEEP_FACTS = [
  { id: "time_order", sourceTurns: [1, 2, 5], tokens: ["일곱 시", "여덟 시", "여섯 시 십"] },
  { id: "actor_gift", sourceTurns: [1], tokens: ["황동 라이터", "건네"] },
  { id: "user_choice", sourceTurns: [2], tokens: ["떠나지 않고", "미안"] },
  { id: "emotion_change", sourceTurns: [2], tokens: ["화가", "미안"] },
  { id: "role_direction", sourceTurns: [3], tokens: ["먼저 안"] },
  { id: "claim_vs_fact", sourceTurns: [1], tokens: ["어릴 때부터", "지난달"] },
  { id: "promise", sourceTurns: [4, 5], tokens: ["여섯 시", "역에서"] },
  { id: "item_owner", sourceTurns: [1, 3, 5], tokens: ["황동 라이터", "주머니"] },
] as const;

/**
 * CURRENT_CODE_DETERMINISTIC canned summaries.
 * Mood/scene compression without the must-keep facts. Not Luna.
 */
const LOSSY_SUMMARY =
  "라이크와 렌이 옥상에서 만나 이야기를 나눈 뒤 계단으로 내려와 서로 가까워지고 화해함. " +
  "분위기가 가라앉은 채 다음에도 만나기로 하고 헤어짐. 둘은 한동안 말없이 앉아 있었음.";

/** CURRENT_CODE_DETERMINISTIC retaining control. Not Luna. */
const RETAINING_SUMMARY =
  "저녁 일곱 시 옥상에서 렌이 라이크에게 황동 라이터를 건네 라이크 주머니로 들어감. " +
  "라이크는 어릴 때부터 알았다고 말했으나 확정된 사실은 지난달 첫 만남임. " +
  "여덟 시 계단에서 렌이 떠나지 않고 남자 라이크의 화가 가라앉고 미안해함. " +
  "같은 계단에서 라이크가 먼저 안고 렌이 따름. 반복 침묵은 한 흐름으로 줄이되 라이터가 라이크 소유인 점은 남김. " +
  "라이크가 내일 아침 여섯 시 역에서 기다리겠다고 약속함. 다음날 아침 여섯 시 십 분 렌이 도착했을 때 라이크는 기다리고 라이터는 여전히 그의 주머니에 있음.";

function missingMustKeepIds(summary: string): string[] {
  return MUST_KEEP_FACTS.filter((fact) =>
    fact.tokens.every((token) => !summary.includes(token))
  ).map((fact) => fact.id);
}

function usdFromTokens(inputTokens: number, outputTokens: number): number {
  const rates = resolveOpenRouterModelRates(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
  return (inputTokens / 1_000_000) * rates.inputUsdPerM + (outputTokens / 1_000_000) * rates.outputUsdPerM;
}

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
});

describe("#1486 Phase 2B 5-turn summary packet (라이크 18 / 렌)", () => {
  it("labels the packet CURRENT_CODE_DETERMINISTIC and binds 라이크 18 / 렌", () => {
    assert.equal(LIVE.characterId, 18);
    assert.equal(LIVE.characterName, "라이크");
    assert.equal(LIVE.personaName, "렌");
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.provenance, "CURRENT_CODE_DETERMINISTIC");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.summaryQuality, "NOT_PROVEN");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.providerPosts, 0);
    assert.equal(canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.provenance), false);
    assert.equal(BACKGROUND_OPENROUTER_MODEL, CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
  });

  it("assembles the live summarizeTurnBatch system/user request from the 5-turn fixture", async () => {
    const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], LIVE.characterName);
    let capturedSystem = "";
    let capturedUser = "";
    let requestKind = "";
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async (system, history, _trace, kind) => {
      calls += 1;
      capturedSystem = system;
      capturedUser = history[0]?.content ?? "";
      requestKind = kind;
      return { text: RETAINING_SUMMARY };
    });

    const summary = await summarizeTurnBatch({
      dialogue,
      charName: LIVE.characterName,
      characterIdentity: FIXTURE_IDENTITY,
      userPersona: FIXTURE_PERSONA,
      startTurn: 1,
      endTurn: 5,
      sourceTurnIndexes: [1, 2, 3, 4, 5],
    });

    const expectedSystem = `${buildRollingSummarySystemPrompt(5)}\n\n${ROLLING_SUMMARY_EPISTEMIC_POLICY}`;
    assert.equal(calls, 1);
    assert.equal(requestKind, "background-memory-extract");
    assert.equal(capturedSystem, expectedSystem);
    assert.equal(capturedSystem.startsWith(ROLLING_SUMMARY_SYSTEM_PROMPT), true);
    assert.match(capturedUser, /\[1~5턴 원본 대화\]/);
    assert.match(capturedUser, /\[요약 대상 RP source 턴\]/);
    assert.match(capturedUser, /\[1턴\] \[2턴\] \[3턴\] \[4턴\] \[5턴\]/);
    assert.match(capturedUser, /마지막 턴 하나로 축소하지 말고/);
    assert.match(capturedUser, new RegExp(`캐릭터: ${LIVE.characterName}`));
    assert.match(capturedUser, /\[캐릭터 식별정보/);
    assert.match(capturedUser, /\[유저 페르소나/);
    assert.match(capturedUser, new RegExp(`최대 ${ROLLING_SUMMARY_MAX_CHARS}자`));
    for (const turn of PHASE2B_TURNS) {
      assert.match(capturedUser, new RegExp(`\\[${turn.turnIndex}턴\\]`));
      assert.match(capturedUser, new RegExp(turn.turn.user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal(summary, RETAINING_SUMMARY.replace(/\s+/g, " ").trim());
  });

  it("lets a fact-dropping canned summary pass the live validators", () => {
    const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], LIVE.characterName);
    const narrative = validateSummaryNarrative(LOSSY_SUMMARY, "main_canon");
    assert.equal(narrative.ok, true);
    assert.ok(LOSSY_SUMMARY.length >= ROLLING_SUMMARY_MIN_CHARS);
    assert.equal(isRollingSummaryGroundedInDialogue(LOSSY_SUMMARY, dialogue, FIXTURE_PERSONA), true);
    const missing = missingMustKeepIds(LOSSY_SUMMARY);
    assert.ok(missing.length >= 5, `expected several dropped facts, got ${missing.join(",")}`);
    assert.ok(missing.includes("time_order"));
    assert.ok(missing.includes("item_owner"));
    assert.ok(missing.includes("claim_vs_fact"));
    assert.ok(missing.includes("role_direction"));
    assert.ok(missing.includes("promise"));
  });

  it("also accepts a retaining canned summary without scoring it as Luna", () => {
    const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], LIVE.characterName);
    const narrative = validateSummaryNarrative(RETAINING_SUMMARY, "main_canon");
    assert.equal(narrative.ok, true);
    assert.equal(
      isRollingSummaryGroundedInDialogue(RETAINING_SUMMARY, dialogue, FIXTURE_PERSONA),
      true
    );
    assert.deepEqual(missingMustKeepIds(RETAINING_SUMMARY), []);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.summaryQuality, "NOT_PROVEN");
  });

  it("returns empty after three ungrounded attempts and does not persist a replacement", async () => {
    const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], LIVE.characterName);
    const echo =
      "5턴 배치의 사건을 발생 순서대로 요약한다. 사건 시기와 인과관계를 누락하지 않는다. 요약 대상 source 턴을 검토한다.";
    let calls = 0;
    const kinds: string[] = [];
    __setSummarizeTurnBatchCallerForTests(async (_system, _history, _trace, kind) => {
      calls += 1;
      kinds.push(kind);
      return { text: echo };
    });

    const summary = await summarizeTurnBatch({
      dialogue,
      charName: LIVE.characterName,
      startTurn: 1,
      endTurn: 5,
    });

    assert.equal(calls, 3);
    assert.deepEqual(kinds, [
      "background-memory-extract",
      "background-memory-extract-retry",
      "background-memory-extract-retry",
    ]);
    assert.equal(summary, "");
    assert.equal(validateSummaryNarrative(echo, "main_canon").ok, false);
  });

  it("copies sealed summary text into contextBuilder [3] Current Memory without rewriting facts", () => {
    const lorebook = formatMemoryBlock(1, 5, LOSSY_SUMMARY);
    const otherChat = formatMemoryBlock(1, 5, "다른 방의 요약은 여기 없어야 함. 라이크와 렌의 옥상 사건과 섞이지 않음.");
    const built = buildContext({
      charName: LIVE.characterName,
      chunks: [],
      userNickname: LIVE.personaName,
      shortTermHistory: [],
      nsfw: false,
      longTermMemory: lorebook,
      currentUserMessage: "어제 라이터 어디 갔지?",
    });
    const isolated = buildContext({
      charName: LIVE.characterName,
      chunks: [],
      userNickname: LIVE.personaName,
      shortTermHistory: [],
      nsfw: false,
      longTermMemory: otherChat,
      currentUserMessage: "다른 방",
    });
    const ids = (built.meta?.trackedSections ?? []).map((section) => section.id);
    assert.ok(ids.includes("current-memory"));
    assert.match(built.systemPrompt, /\[3\] Current Memory/);
    assert.equal(built.systemPrompt.includes(lorebook), true);
    assert.equal(built.systemPrompt.includes("다른 방의 요약은 여기 없어야 함"), false);
    assert.equal(isolated.systemPrompt.includes(lorebook), false);
    assert.equal(isolated.systemPrompt.includes(otherChat), true);
    assert.equal(formatMemoryBlock(1, 5, RETAINING_SUMMARY).includes(RETAINING_SUMMARY), true);
  });

  it("computes paid preflight caps for one 5-turn case without posting", async () => {
    const dialogue = __formatBatchDialogueForTests([...PHASE2B_TURNS], LIVE.characterName);
    let capturedSystem = "";
    let capturedUser = "";
    __setSummarizeTurnBatchCallerForTests(async (system, history) => {
      capturedSystem = system;
      capturedUser = history[0]?.content ?? "";
      return { text: LOSSY_SUMMARY };
    });
    await summarizeTurnBatch({
      dialogue,
      charName: LIVE.characterName,
      characterIdentity: FIXTURE_IDENTITY,
      userPersona: FIXTURE_PERSONA,
      startTurn: 1,
      endTurn: 5,
      sourceTurnIndexes: [1, 2, 3, 4, 5],
    });

    const rates = resolveOpenRouterModelRates(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
    const inputTokens = estimateTokens(capturedSystem) + estimateTokens(capturedUser);
    const acceptedOut = estimateTokens(LOSSY_SUMMARY);
    const clampOut = estimateTokens("x".repeat(ROLLING_SUMMARY_MAX_CHARS));
    const maxAttempts = MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.maxAttemptsPerCase;
    const expectedUsdOneSuccess = usdFromTokens(inputTokens, acceptedOut);
    const upperUsdThreeAttempts = usdFromTokens(inputTokens * maxAttempts, clampOut * maxAttempts);

    assert.equal(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL, "gpt-6-luna");
    assert.equal(rates.inputUsdPerM, 0.07);
    assert.equal(rates.outputUsdPerM, 0.35);
    assert.equal(maxAttempts, 3);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.paidEvaluationApproved, false);
    assert.ok(inputTokens > 0);
    assert.ok(expectedUsdOneSuccess > 0);
    assert.ok(upperUsdThreeAttempts > expectedUsdOneSuccess);
    assert.equal(canClaimCurrentLiveProvider("CURRENT_CODE_DETERMINISTIC"), false);
  });
});
