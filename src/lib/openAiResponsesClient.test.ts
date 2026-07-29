import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENAI_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  buildOpenAiTerraResponseRequest,
  TERRA_FALLBACK_PROSE_DIRECTIVE,
} from "@/lib/openAiResponsesClient";

describe("GPT-5.6 Terra Responses request", () => {
  it("uses the exact OpenAI model id and only supported Terra controls", () => {
    const request = buildOpenAiTerraResponseRequest("system rules", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    assert.equal(request.model, OPENAI_GPT_56_TERRA_MODEL);
    assert.deepEqual(request.reasoning, { effort: "none" });
    assert.deepEqual(request.text, { verbosity: "high" });
    assert.equal(request.stream, true);
    assert.equal("temperature" in request, false);
    assert.equal("top_p" in request, false);
  });

  it("adds the prose directive once, without duplicating an equivalent fixed prompt", () => {
    const absent = buildOpenAiTerraResponseRequest("system rules", []);
    assert.ok(absent.instructions.includes(TERRA_FALLBACK_PROSE_DIRECTIVE));

    const existing = `system rules\n\n${TERRA_FALLBACK_PROSE_DIRECTIVE}`;
    const present = buildOpenAiTerraResponseRequest(existing, []);
    assert.equal(present.instructions, existing);
  });
});
