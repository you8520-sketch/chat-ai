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
import { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } from "@/lib/terraTerminalLengthOwner";
import { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } from "@/lib/deepseekPromptStructure";

const FROZEN_ARM_E_SHA256 =
  "05225756dc2b19abebcf7ae2d5bc01717a6a98fed4494b25108901cca90e28ca";

describe("opusTerminalLengthOwner", () => {
  it("freezes Audit 58 Arm E byte-identical SHA-256", () => {
    assert.equal(
      createHash("sha256").update(OPUS_ARM_E_TERMINAL).digest("hex"),
      FROZEN_ARM_E_SHA256
    );
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
  });

  it("applies only for Opus + interactive + character + non-party", () => {
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        party: false,
        runtimeMode: "interactive",
      }),
      true
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        runtimeMode: "auto_progression",
      }),
      false
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        runtimeMode: "ooc_user_impersonation_allowed",
      }),
      false
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "simulation",
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        contentKind: "character",
        party: true,
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      false
    );
    assert.equal(
      shouldUseOpusArmETerminal({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        contentKind: "character",
        runtimeMode: "interactive",
      }),
      false
    );
  });

  it("appends Arm E once at absolute user-turn end for Opus interactive", () => {
    const out = appendCompactTerminalLengthToUserTurn("시키는 대로 할게요.", 3200, {
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      party: false,
      runtimeMode: "interactive",
    });
    assert.ok(out.trimEnd().endsWith(OPUS_ARM_E_TERMINAL));
    assert.equal(out.split(OPUS_ARM_E_TERMINAL).length - 1, 1);
    assert.ok(!out.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(!out.includes(OPUS_ARM_F_REJECTED_STOP_MARKER));
    assert.equal(resolveOpusArmETerminal({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      contentKind: "character",
      runtimeMode: "interactive",
    }), OPUS_ARM_E_TERMINAL);
  });

  it("does not leak Arm E into Terra or DeepSeek user-tail paths", () => {
    const terra = appendCompactTerminalLengthToUserTurn("같이 가요?", 3200, {
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
      terraTerminalLengthOwner: true,
      runtimeMode: "interactive",
    });
    assert.ok(terra.trimEnd().endsWith(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT));
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
    // Compact future-instruction boundary is DeepSeek-only (not Arm E).
    assert.ok(
      deepseek.includes(
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
