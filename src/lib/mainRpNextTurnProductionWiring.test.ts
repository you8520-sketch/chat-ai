import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_61_SOL_MODEL } from "@/lib/chatModels";
import { countPlayableTurns, messagesToTurns } from "@/lib/hybridMemory";
import {
  computeMainRpNextTurnEstimates,
  isPreviousAssistantRetainedInHistory,
  nonHistoryTokensFromPromptAuditSections,
  promptAuditSectionsFromAssembledPromptChars,
  promptAuditSectionsFromPromptAudit,
  resolveNextTurnHistoryDelta,
  resolveRemovedHistoryTexts,
} from "@/lib/mainRpNextTurnEstimate";
import {
  dropLastCompletePlayableTurn,
  prepareNextTurnHistory,
  preparePreviousRequestHistory,
} from "@/services/nextTurnAssemblyPreparation";
import { auditAssembledPrompt } from "@/services/promptAudit";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FX = 1560.6;
const TURN_N_IN = 14_312;
const TURN_N_OUT = 2_780;
const TURN_N_CHARS = 4_213;
const TURN_N1_IN = 17_104;
const TURN_N1_SETTLED = 174;

function playableTurns(count: number, assistantPad = 80) {
  const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
    { role: "assistant", content: "오프닝 등대.", model: "greeting" },
  ];
  for (let turn = 1; turn <= count; turn += 1) {
    rows.push({ role: "user", content: `유저 ${turn} UNIQUE_USER_${turn}` });
    rows.push({
      role: "assistant",
      content: `어시 ${turn} UNIQUE_ASSIST_${turn}`.padEnd(assistantPad, "가"),
      model: SOL,
    });
  }
  return messagesToTurns(rows);
}

function historyInput(
  turns: ReturnType<typeof playableTurns>,
  overrides: Partial<Parameters<typeof prepareNextTurnHistory>[0]> = {}
) {
  return {
    turns,
    modelId: SOL,
    provider: "openrouter" as const,
    memoryFeatureOn: true,
    completedTurnsForMemoryCoverage: countPlayableTurns(turns),
    summarizedTurnCount: 0,
    personaDisplayName: "여행자",
    userNickname: "닉",
    ...overrides,
  };
}

describe("production-path next-turn history/context wiring", () => {
  it("A sequential retained assistant through prepareNextTurnHistory lands near 174P", () => {
    const turns = playableTurns(2, 200);
    const next = prepareNextTurnHistory(historyInput(turns, { memoryFeatureOn: false }));
    const previous = preparePreviousRequestHistory(
      historyInput(turns, { memoryFeatureOn: false })
    );
    const lastAssistant = turns.at(-1)?.assistant ?? "";
    const delta = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
      },
      previousAssistantContent: lastAssistant,
      nextPromptHistory: next.promptHistory,
      previousPromptHistory: previous.promptHistory,
      currentUserEstimatedTokens: 12,
    });
    assert.equal(delta.previousAssistantRetained, true);
    assert.equal(delta.retainedNewHistoryTokens, TURN_N_OUT);
    assert.equal(delta.removedHistoryTokens, 0);
    const row = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [SOL]: 34_816 },
      lastVisibleAssistantChars: TURN_N_CHARS,
      observedCharsPerTokenByModel: { [SOL]: TURN_N_CHARS / TURN_N_OUT },
      providerInputCalibrationByModel: {
        [SOL]: {
          actualBillableInputTokens: TURN_N_IN,
          actualBillableOutputTokens: TURN_N_OUT,
        },
      },
      historyDeltaByModel: { [SOL]: delta },
      effectiveKrwPerUsd: FX,
    })[SOL];
    assert.equal(row?.predictedBillableInputTokens, TURN_N1_IN);
    assert.ok(Math.abs((row?.displayPoints ?? 0) - TURN_N1_SETTLED) <= 5);
  });

  it("B next promptHistory membership, not a retained=true default", () => {
    const turns = playableTurns(2, 120);
    const next = prepareNextTurnHistory(historyInput(turns, { memoryFeatureOn: false }));
    const lastAssistant = turns.at(-1)?.assistant ?? "";
    assert.equal(
      isPreviousAssistantRetainedInHistory({
        nextPromptHistory: next.promptHistory,
        previousAssistantContent: lastAssistant,
      }),
      true
    );
    const missing = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
      },
      previousAssistantContent: lastAssistant,
      nextPromptHistory: next.promptHistory.filter((message) => message.role !== "assistant"),
    });
    assert.equal(missing.previousAssistantRetained, false);
    assert.equal(missing.retainedNewHistoryTokens, 0);
  });

  it("C RAW4 eviction subtracts dropped history from prepareNextTurnHistory", () => {
    const turns = playableTurns(5, 180);
    const args = historyInput(turns, { memoryFeatureOn: false });
    const next = prepareNextTurnHistory(args);
    const previous = preparePreviousRequestHistory(args);
    assert.equal(countPlayableTurns(dropLastCompletePlayableTurn(turns)), 4);
    const evicted = resolveRemovedHistoryTexts({
      previousPromptHistory: previous.promptHistory,
      nextPromptHistory: next.promptHistory,
    });
    assert.ok(evicted.some((text) => text.includes("UNIQUE_USER_1") || text.includes("UNIQUE_ASSIST_1")));
    const lastAssistant = turns.at(-1)?.assistant ?? "";
    const delta = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
      },
      previousAssistantContent: lastAssistant,
      nextPromptHistory: next.promptHistory,
      previousPromptHistory: previous.promptHistory,
    });
    assert.equal(delta.previousAssistantRetained, true);
    assert.ok(delta.removedHistoryTokens > 0);
    assert.equal(delta.nextRawHistoryState, "raw_evicted");
  });

  it("D rolling-summary seal through prepareNextTurnHistory can shrink input", () => {
    const turns = playableTurns(5, 220);
    const previous = prepareNextTurnHistory(
      historyInput(turns, {
        memoryFeatureOn: true,
        summarizedTurnCount: 0,
        completedTurnsForMemoryCoverage: 5,
      })
    );
    const next = prepareNextTurnHistory(
      historyInput(turns, {
        memoryFeatureOn: true,
        summarizedTurnCount: 5,
        completedTurnsForMemoryCoverage: 5,
      })
    );
    const lastAssistant = turns.at(-1)?.assistant ?? "";
    const delta = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
        rawHistoryHealth: { summarizedThroughTurn: 0 },
      },
      previousAssistantContent: lastAssistant,
      nextPromptHistory: next.promptHistory,
      previousPromptHistory: previous.promptHistory,
      nextRawHistoryHealth: { summarizedThroughTurn: 5 },
    });
    assert.equal(delta.nextRawHistoryState, "summary_compacted");
    assert.ok(delta.removedHistoryTokens > 0);
    assert.ok(
      TURN_N_IN + delta.retainedNewHistoryTokens - delta.removedHistoryTokens <
        TURN_N_IN + TURN_N_OUT
    );
  });

  it("E lorebook on/off uses promptAudit section counts", () => {
    const shared = {
      systemPrompt: "rules and character",
      history: [{ role: "user" as const, content: "hi" }],
    };
    const off = auditAssembledPrompt({
      ...shared,
      systemSections: [
        { id: "rules", label: "rules", category: "systemRules", text: "규칙".repeat(40) },
        { id: "char", label: "char", category: "characterSetting", text: "캐릭터".repeat(40) },
        { id: "persona", label: "persona", category: "persona", text: "페르소나".repeat(20) },
        { id: "note", label: "note", category: "userNote", text: "노트".repeat(10) },
      ],
    });
    const on = auditAssembledPrompt({
      ...shared,
      systemSections: [
        { id: "rules", label: "rules", category: "systemRules", text: "규칙".repeat(40) },
        { id: "char", label: "char", category: "characterSetting", text: "캐릭터".repeat(40) },
        { id: "persona", label: "persona", category: "persona", text: "페르소나".repeat(20) },
        { id: "note", label: "note", category: "userNote", text: "노트".repeat(10) },
        { id: "lore", label: "lore", category: "worldLore", text: "로어북발동".repeat(80) },
      ],
    });
    const previousChars = {
      systemRules: "규칙".repeat(40).length,
      characterSettings: "캐릭터".repeat(40).length,
      dynamic: "페르소나".repeat(20).length + "노트".repeat(10).length,
    };
    const delta = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
        assembledPromptChars: previousChars,
      },
      previousAssistantRetained: true,
      nextPromptAuditSections: promptAuditSectionsFromPromptAudit({
        breakdown: on.breakdown,
      }),
    });
    assert.ok(on.breakdown.worldLore > off.breakdown.worldLore);
    assert.ok(delta.contextDeltaTokens > 0);
    assert.equal(
      delta.contextDeltaTokens,
      nonHistoryTokensFromPromptAuditSections(promptAuditSectionsFromPromptAudit({ breakdown: on.breakdown })) -
        nonHistoryTokensFromPromptAuditSections(promptAuditSectionsFromAssembledPromptChars(previousChars))
    );
  });

  it("F persona/user-note change uses promptAudit section counts", () => {
    const before = auditAssembledPrompt({
      systemPrompt: "base",
      history: [{ role: "user" as const, content: "hi" }],
      systemSections: [
        { id: "rules", label: "rules", category: "systemRules", text: "규칙".repeat(20) },
        { id: "char", label: "char", category: "characterSetting", text: "캐릭터".repeat(20) },
        { id: "persona", label: "persona", category: "persona", text: "짧은페르소나" },
        { id: "note", label: "note", category: "userNote", text: "짧은노트" },
      ],
    });
    const after = auditAssembledPrompt({
      systemPrompt: "base",
      history: [{ role: "user" as const, content: "hi" }],
      systemSections: [
        { id: "rules", label: "rules", category: "systemRules", text: "규칙".repeat(20) },
        { id: "char", label: "char", category: "characterSetting", text: "캐릭터".repeat(20) },
        { id: "persona", label: "persona", category: "persona", text: "긴페르소나변경".repeat(40) },
        { id: "note", label: "note", category: "userNote", text: "긴유저노트변경".repeat(40) },
      ],
    });
    const previousChars = {
      systemRules: "규칙".repeat(20).length,
      characterSettings: "캐릭터".repeat(20).length,
      dynamic: "짧은페르소나".length + "짧은노트".length,
    };
    const delta = resolveNextTurnHistoryDelta({
      previous: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
        assembledPromptChars: previousChars,
      },
      previousAssistantRetained: true,
      nextPromptAuditSections: promptAuditSectionsFromPromptAudit({
        breakdown: after.breakdown,
      }),
    });
    assert.ok(after.breakdown.persona > before.breakdown.persona);
    assert.ok(after.breakdown.userNote > before.breakdown.userNote);
    assert.ok(delta.contextDeltaTokens > 0);
  });
});
