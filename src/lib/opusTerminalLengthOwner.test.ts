import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  OPUS_ARM_E_INSTRUCTION_BOUNDARY_MARKER,
  OPUS_ARM_E_TERMINAL,
  OPUS_ARM_E_TERMINAL_MARKER,
  OPUS_ARM_F_REJECTED_STOP_MARKER,
  resolveOpusArmETerminal,
  shouldUseOpusArmETerminal,
} from "@/lib/opusTerminalLengthOwner";
import {
  appendCompactTerminalLengthToUserTurn,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } from "@/lib/deepseekPromptStructure";

describe("opusTerminalLengthOwner", () => {
  it("keeps retired Arm E constant markers (historical freeze text)", () => {
    assert.ok(OPUS_ARM_E_TERMINAL.includes(OPUS_ARM_E_TERMINAL_MARKER));
    assert.ok(
      OPUS_ARM_E_TERMINAL.includes(OPUS_ARM_E_INSTRUCTION_BOUNDARY_MARKER)
    );
    assert.ok(!OPUS_ARM_E_TERMINAL.includes(OPUS_ARM_F_REJECTED_STOP_MARKER));
    assert.ok(
      OPUS_ARM_E_TERMINAL.includes(
        "첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다."
      )
    );
    assert.equal(
      typeof createHash("sha256").update(OPUS_ARM_E_TERMINAL).digest("hex"),
      "string"
    );
  });

  it("never applies Arm E (retired → USER_TAIL for Opus)", () => {
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        party: false,
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      resolveOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      null
    );
  });

  it("appends generic USER_TAIL for Opus interactive (no Arm E)", () => {
    const out = appendCompactTerminalLengthToUserTurn("시키는 대로 할게요.", 3200, {
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      party: false,
      runtimeMode: "interactive",
    });
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL_MARKER));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL));
    assert.ok(!out.includes(OPUS_ARM_F_REJECTED_STOP_MARKER));
  });

  it("strips stale Arm E and ends with USER_TAIL", () => {
    const out = appendCompactTerminalLengthToUserTurn(
      `안녕.\n\n${OPUS_ARM_E_TERMINAL}`,
      3200,
      {
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }
    );
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL_MARKER));
  });

  it("does not leak Arm E into Terra or DeepSeek user-tail paths", () => {
    const terra = appendCompactTerminalLengthToUserTurn("같이 가요?", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    });
    assert.ok(terra.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!terra.includes(OPUS_ARM_E_TERMINAL_MARKER));

    const deepseek = appendCompactTerminalLengthToUserTurn(
      `${DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY}\n\n시키는 대로 할게요.`,
      3200,
      {
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }
    );
    assert.ok(deepseek.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY));
    assert.ok(deepseek.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!deepseek.includes(OPUS_ARM_E_TERMINAL_MARKER));
    assert.ok(
      !deepseek.includes(
        "포괄적으로 순응 의사를 밝혀도 이후 모든 행동·대사·선택을 대신 수행하라는 뜻은 아니다"
      )
    );
  });

  it("keeps numeric user-tail for Opus auto progression", () => {
    const out = appendCompactTerminalLengthToUserTurn("계속.", 3200, {
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      runtimeMode: "auto_progression",
    });
    assert.ok(out.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_E_TERMINAL_MARKER));
  });
});
