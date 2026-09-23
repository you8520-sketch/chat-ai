import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StatusWidgetExtractCaller } from "@/lib/statusWidget/extract";
import { runPostTurnSharedInitial } from "@/lib/postTurnSharedInitial/run";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import { SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX } from "./decisionQualityTelemetry";

function reply(seed: string, length = 80): string {
  return (seed + "가".repeat(length)).slice(0, length);
}

function suggestionsJson(): string {
  return JSON.stringify({
    suggestedReplies: {
      items: [
        { kind: "natural", text: reply("정석 반응 ") },
        { kind: "twist", text: reply("한 수 반응 ") },
        { kind: "banter", text: reply("드립 반응 ") },
      ],
    },
  });
}

function input(): PostTurnSharedInitialInput {
  return {
    mode: "relationship_only",
    charName: "유나",
    personaName: "렌",
    userMessage: "계속해.",
    assistantProse: "유나가 고개를 든다.",
    primaryModelId: "gpt-5.6-luna",
    includeSuggestions: true,
    includeRelationship: false,
    includeEpisodic: false,
  };
}

async function captureTelemetry(text: string): Promise<string[]> {
  const caller: StatusWidgetExtractCaller = async () => ({
    text,
    usage: { inputTokens: 10, outputTokens: 10, estimated: true },
  });
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.startsWith(SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX)) lines.push(line);
  };
  try {
    await runPostTurnSharedInitial(input(), caller);
  } finally {
    console.info = original;
  }
  return lines;
}

describe("P3-A suggested replies runtime telemetry wiring", () => {
  it("shared production path emits one valid metadata-only event", async () => {
    const raw = suggestionsJson();
    const lines = await captureTelemetry(raw);

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /"source":"post-turn-shared"/);
    assert.match(lines[0]!, /"contractValid":true/);
    assert.match(lines[0]!, /"issueCount":0/);
    assert.equal(lines[0]!.includes("정석 반응"), false);
    assert.equal(lines[0]!.includes(raw), false);
  });

  it("shared malformed output is classified without logging raw output", async () => {
    const raw = "not-json-secret-payload";
    const lines = await captureTelemetry(raw);

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /"contractValid":false/);
    assert.match(lines[0]!, /"malformed_json"/);
    assert.equal(lines[0]!.includes(raw), false);
  });
});
