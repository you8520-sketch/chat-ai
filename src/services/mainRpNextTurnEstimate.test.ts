import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
} from "@/lib/chatModels";
import {
  readMainRpNextTurnOutputHistory,
  readMainRpNextTurnProviderInputCalibration,
  type EstimateMessageRow,
} from "@/services/mainRpNextTurnEstimate";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FLASH = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
const SERVICE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/services/mainRpNextTurnEstimate.ts"),
  "utf8"
);

function assistantRow(
  usage: Record<string, unknown>,
  extras: Partial<EstimateMessageRow> = {}
): EstimateMessageRow {
  return {
    role: "assistant",
    content: "saved reply",
    model: typeof extras.model === "string" ? extras.model : SOL,
    usage: JSON.stringify(usage),
    generation_status: extras.generation_status ?? "completed",
  };
}

function validSolUsage(overrides: Record<string, unknown> = {}) {
  return {
    selectedAI: SOL,
    model: SOL,
    apiInputTokens: 14_312,
    assembledInputTokens: 34_816,
    apiOutputTokens: 2_780,
    estimated: false,
    htmlFlashOnly: false,
    apiCallCount: 1,
    lengthRecoveryPasses: 0,
    adultRouting: { actualModel: SOL, fallbackAttempted: false },
    ...overrides,
  };
}

describe("main RP next-turn provider-input calibration reader", () => {
  it("reads the latest valid same-model durable usage sample", () => {
    const rows: EstimateMessageRow[] = [
      {
        role: "user",
        content: "hi",
        model: null,
        usage: null,
        generation_status: null,
      },
      assistantRow(validSolUsage({ apiInputTokens: 10_000, assembledInputTokens: 24_000 })),
      assistantRow(validSolUsage()),
    ];
    assert.deepEqual(readMainRpNextTurnProviderInputCalibration(rows)[SOL], {
      actualProviderInputTokens: 14_312,
      assembledInputTokens: 34_816,
    });
  });

  it("excludes estimated, fallback, multi-call, recovery, greeting, and failed rows", () => {
    const rows: EstimateMessageRow[] = [
      assistantRow(validSolUsage()),
      assistantRow(validSolUsage({ estimated: true, apiInputTokens: 1 })),
      assistantRow(validSolUsage({ fallback: "provider-fallback", apiInputTokens: 2 })),
      assistantRow(
        validSolUsage({
          adultRouting: { actualModel: SOL, fallbackAttempted: true },
          apiInputTokens: 3,
        })
      ),
      assistantRow(validSolUsage({ apiCallCount: 2, apiInputTokens: 4 })),
      assistantRow(validSolUsage({ lengthRecoveryPasses: 1, apiInputTokens: 5 })),
      assistantRow(validSolUsage({ htmlFlashOnly: true, apiInputTokens: 6 })),
      assistantRow(validSolUsage({ apiInputTokens: 7 }), { model: "greeting" }),
      assistantRow(validSolUsage({ apiInputTokens: 8 }), { generation_status: "failed" }),
      assistantRow(validSolUsage({ apiInputTokens: 9, assembledInputTokens: undefined })),
    ];
    assert.deepEqual(readMainRpNextTurnProviderInputCalibration(rows)[SOL], {
      actualProviderInputTokens: 14_312,
      assembledInputTokens: 34_816,
    });
  });

  it("does not reuse another model's sample after a switch", () => {
    const rows: EstimateMessageRow[] = [
      assistantRow(validSolUsage()),
      assistantRow(
        {
          ...validSolUsage(),
          selectedAI: FLASH,
          model: FLASH,
          apiInputTokens: 9_000,
          assembledInputTokens: 9_500,
          adultRouting: { actualModel: FLASH, fallbackAttempted: false },
        },
        { model: FLASH }
      ),
    ];
    const picked = readMainRpNextTurnProviderInputCalibration(rows);
    assert.deepEqual(picked[SOL], {
      actualProviderInputTokens: 14_312,
      assembledInputTokens: 34_816,
    });
    assert.deepEqual(picked[FLASH], {
      actualProviderInputTokens: 9_000,
      assembledInputTokens: 9_500,
    });
  });

  it("excludes a Sol-selected turn that actually delivered another model", () => {
    const rows: EstimateMessageRow[] = [
      assistantRow(
        validSolUsage({
          adultRouting: { actualModel: FLASH, fallbackAttempted: false },
        })
      ),
    ];
    assert.equal(readMainRpNextTurnProviderInputCalibration(rows)[SOL], undefined);
  });

  it("reads last 3-5 same-model apiOutputTokens and skips contaminated rows", () => {
    const rows: EstimateMessageRow[] = [
      assistantRow(validSolUsage({ apiOutputTokens: 2100 })),
      assistantRow(validSolUsage({ apiOutputTokens: 2700 })),
      assistantRow(validSolUsage({ apiOutputTokens: 2750 })),
      assistantRow(validSolUsage({ apiOutputTokens: 2780 })),
      assistantRow(validSolUsage({ apiCallCount: 2, apiOutputTokens: 9000 })),
      assistantRow(validSolUsage({ apiOutputTokens: 2800 })),
      assistantRow(
        {
          ...validSolUsage(),
          selectedAI: FLASH,
          model: FLASH,
          apiOutputTokens: 4000,
          adultRouting: { actualModel: FLASH, fallbackAttempted: false },
        },
        { model: FLASH }
      ),
    ];
    assert.deepEqual(readMainRpNextTurnOutputHistory(rows)[SOL], [
      2100, 2700, 2750, 2780, 2800,
    ]);
    assert.deepEqual(readMainRpNextTurnOutputHistory(rows)[FLASH], [4000]);
  });

  it("picker omits unsent draft instead of inventing lorebook prompt", () => {
    const prep = fs.readFileSync(
      path.join(process.cwd(), "src/services/nextTurnAssemblyPreparation.ts"),
      "utf8"
    );
    assert.match(prep, /keywordLorebookFromUnsentDraft: "omitted"/);
    assert.match(SERVICE_SOURCE, /currentUserMessage=""/);
    assert.match(SERVICE_SOURCE, /recentApiOutputTokensByModel/);
  });

  it("picker and admission both consume estimatesFromRoomRows", () => {
    assert.match(SERVICE_SOURCE, /function estimatesFromRoomRows/);
    assert.match(SERVICE_SOURCE, /providerInputCalibrationByModel/);
    assert.match(
      SERVICE_SOURCE,
      /const estimates = estimatesFromRoomRows\(rows, \{\s*\[opts\.modelId\]: opts\.promptTokens,/
    );
    assert.match(
      SERVICE_SOURCE,
      /const estimates = estimatesFromRoomRows\(rows, promptTokensByModel\)/
    );
  });
});
