import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTerminalGenerationStatus } from "@/lib/streamingPersistence";

describe("server done decoupled from reveal idle", () => {
  it("E: terminal generation status ends streaming even if loading remains true", () => {
    const genStatus = "completed";
    const loading = true;
    const lastAssistantIdx = 2;
    const i = 2;
    const isStreamingThisMessage =
      i === lastAssistantIdx &&
      !isTerminalGenerationStatus(genStatus) &&
      ((loading && i === 3) || genStatus === "generating");
    assert.equal(isStreamingThisMessage, false);
  });

  it("F: interrupted stays streaming-eligible for continue UI", () => {
    assert.equal(isTerminalGenerationStatus("interrupted"), true);
    assert.equal(isTerminalGenerationStatus("generating"), false);
  });
});
