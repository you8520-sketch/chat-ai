import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLengthInstruction } from "@/lib/responseLength";
import {
  logBannedVerbCheck,
  logCharsPerTokenDiagnostic,
  logHanjaLeakCheck,
  probeAntiResolutionRuleIndex,
  probeLengthPromptBlocks,
} from "@/lib/lengthDiagnosticV2";

describe("probeLengthPromptBlocks", () => {
  it("detects length control without turn handoff shell", () => {
    const system = buildLengthInstruction();
    const probe = probeLengthPromptBlocks(system);
    assert.equal(probe.time_dilation_active, false);
    assert.equal(probe.scene_blueprint_active, false);
    assert.equal(probe.length_control_active, true);
    assert.equal(probe.turn_handoff_active, false);
    assert.equal(probe.scene_blueprint_occurrences, 0);
    assert.ok(probe.length_control_occurrences >= 1);
  });

  it("returns false flags when blocks are missing", () => {
    const probe = probeLengthPromptBlocks("minimal system");
    assert.equal(probe.time_dilation_active, false);
    assert.equal(probe.scene_blueprint_active, false);
    assert.equal(probe.length_control_active, false);
  });
});

describe("logCharsPerTokenDiagnostic", () => {
  it("computes sanitize loss and chars per token", () => {
    const system = buildLengthInstruction(2400);
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[chars-per-token-diagnostic]") logs.push(args[1]);
    };
    try {
      logCharsPerTokenDiagnostic({
        outputTokens: 2000,
        rawModelText: "가".repeat(2500),
        finalSavedText: "가".repeat(1800),
        usageData: { completion_tokens_details: { reasoning_tokens: 400 } },
        systemPrompt: system,
      });
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.api_output_tokens, 2000);
    assert.equal(row.raw_model_chars, 2500);
    assert.equal(row.final_saved_chars, 1800);
    assert.equal(row.reasoning_tokens, 400);
    assert.equal(row.chars_lost_in_sanitize, 700);
    assert.equal(row.chars_per_output_token, 0.9);
    assert.equal(row.time_dilation_index_in_prompt, null);
    assert.equal(row.scene_blueprint_index_in_prompt, null);
  });

  it("uses total output tokens and recovery breakdown when recovery ran", () => {
    const system = buildLengthInstruction(2400);
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[chars-per-token-diagnostic]") logs.push(args[1]);
    };
    try {
      logCharsPerTokenDiagnostic({
        outputTokens: 3034,
        primaryOutputTokens: 1589,
        recoveryOutputTokens: 1445,
        rawModelText: "가".repeat(1453),
        primaryRawModelChars: 1453,
        finalSavedText: "가".repeat(2577),
        systemPrompt: system,
      });
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.api_output_tokens, 3034);
    assert.equal(row.primary_output_tokens, 1589);
    assert.equal(row.recovery_output_tokens, 1445);
    assert.equal(row.raw_model_chars, 1453);
    assert.equal(row.final_saved_chars, 2577);
    assert.equal(row.recovery_merge_net_chars, 1124);
    assert.equal(row.chars_per_output_token, 0.849);
    assert.equal(row.primary_chars_per_output_token, 0.914);
    assert.equal(row.chars_lost_in_sanitize, undefined);
  });

  it("reports recovery split and merge_rejected when recovery ran but did not extend prose", () => {
    const system = buildLengthInstruction(2400);
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[chars-per-token-diagnostic]") logs.push(args[1]);
    };
    try {
      logCharsPerTokenDiagnostic({
        outputTokens: 3581,
        primaryOutputTokens: 2129,
        recoveryOutputTokens: 1623,
        rawModelText: "가".repeat(1956),
        primaryRawModelChars: 1956,
        finalSavedText: "가".repeat(1774),
        recoveryMergeRejected: true,
        systemPrompt: system,
      });
    } finally {
      console.log = orig;
    }
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.api_output_tokens, 3581);
    assert.equal(row.primary_output_tokens, 2129);
    assert.equal(row.recovery_output_tokens, 1623);
    assert.equal(row.recovery_merge_rejected, true);
    assert.equal(row.chars_lost_in_sanitize, 182);
    assert.equal(row.recovery_merge_net_chars, undefined);
  });
});

describe("logBannedVerbCheck", () => {
  it("detects banned ending verbs and anti-resolution rule index", () => {
    const system = buildLengthInstruction(2400);
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[banned-verb-check]") logs.push(args[1]);
    };
    try {
      logBannedVerbCheck("본문.\n\n백하율은 렌의 대답을 기다리며", system);
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.output_ends_with_banned_verb, true);
    assert.equal(row.anti_resolution_rule_index_in_prompt, null);
    assert.ok(system.includes("[SCENE CONTINUATION PRIORITY]"));
  });
});

describe("logHanjaLeakCheck", () => {
  it("reports CJK ideographs in saved text", () => {
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[hanja-leak-check]") logs.push(args[1]);
    };
    try {
      logHanjaLeakCheck("qwen/qwen3.7-max", "그는 愛를 느꼈다.");
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.model, "qwen/qwen3.7-max");
    assert.equal(row.contains_hanja, true);
    assert.deepEqual(row.hanja_chars_found, ["愛"]);
  });
});
