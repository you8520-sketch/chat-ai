import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY,
  DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER,
  DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE,
  resolveDeepSeekCompactFutureInstructionBoundary,
  shouldUseDeepSeekCompactFutureInstructionBoundary,
} from "@/lib/deepseekFutureInstructionBoundary";
import {
  appendCompactTerminalLengthToUserTurn,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } from "@/lib/deepseekPromptStructure";
import { OPUS_ARM_E_TERMINAL_MARKER } from "@/lib/opusTerminalLengthOwner";

describe("deepseekFutureInstructionBoundary", () => {
  it("keeps retired boundary constant markers", () => {
    assert.ok(
      DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
        DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER
      )
    );
    assert.ok(
      !DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
        DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE
      )
    );
  });

  it("never applies future boundary (retired)", () => {
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        party: false,
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      resolveDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      null
    );
  });

  it("DeepSeek user-tail: style reminder + USER_TAIL; no future boundary", () => {
    const out = appendCompactTerminalLengthToUserTurn(
      `${DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY}\n\n시키는 대로 할게요. 뭘 하면 돼요?`,
      3200,
      {
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        party: false,
        runtimeMode: "interactive",
      }
    );
    assert.equal(out.split(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY).length - 1, 0);
    assert.equal(out.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1, 1);
    assert.equal(out.split(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY).length - 1, 1);
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL_MARKER));
    assert.ok(
      DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.includes(
        "하나의 행동이나 대사가 가진 핵심 의미는 가장 선명한 해석 한 번으로 충분히 살리고"
      )
    );
  });

  it("does not inject compact boundary for Opus or Terra user-tail paths", () => {
    const opus = appendCompactTerminalLengthToUserTurn("시키는 대로 할게요.", 3200, {
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    });
    assert.ok(!opus.includes(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER));
    assert.ok(opus.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));

    const terra = appendCompactTerminalLengthToUserTurn("같이 가요?", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    });
    assert.ok(!terra.includes(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER));
    assert.ok(terra.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });
});
