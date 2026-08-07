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
import { buildCompactTerminalLayoutRecencyLine } from "@/lib/webnovelOutputFormat";
import { OPUS_ARM_E_TERMINAL_MARKER } from "@/lib/opusTerminalLengthOwner";

describe("deepseekFutureInstructionBoundary", () => {
  it("uses the exact compact wording once and forbids Arm-E-style stop sentence", () => {
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
    assert.ok(
      !DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY.includes(
        "첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다"
      )
    );
  });

  it("applies only for DeepSeek V4 Pro + interactive + character + non-party", () => {
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        party: false,
        runtimeMode: "interactive",
      }),
      true
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "auto_progression",
      }),
      false
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "ooc_user_impersonation_allowed",
      }),
      false
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "simulation",
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        party: true,
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      false
    );
  });

  it("places compact boundary once between layout and USER_TAIL; style reminder unchanged", () => {
    const layout = buildCompactTerminalLayoutRecencyLine();
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
    assert.equal(
      out.split(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY).length - 1,
      1
    );
    assert.equal(out.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1, 1);
    assert.equal(out.split(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY).length - 1, 1);
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL_MARKER));
    const layoutIdx = out.indexOf(layout);
    const boundaryIdx = out.indexOf(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY);
    const tailIdx = out.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
    assert.ok(layoutIdx >= 0 && boundaryIdx > layoutIdx && tailIdx > boundaryIdx);
    assert.equal(
      resolveDeepSeekCompactFutureInstructionBoundary({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY
    );
  });

  it("does not inject compact boundary for Opus or Terra user-tail paths", () => {
    const opus = appendCompactTerminalLengthToUserTurn("시키는 대로 할게요.", 3200, {
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    });
    assert.ok(!opus.includes(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER));

    const terra = appendCompactTerminalLengthToUserTurn("같이 가요?", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      terraTerminalLengthOwner: true,
      runtimeMode: "interactive",
    });
    assert.ok(!terra.includes(DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER));
  });
});
