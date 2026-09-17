import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callBackgroundMemory } from "@/lib/ai";
import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { runPostTurnSharedInitial } from "@/lib/postTurnSharedInitial/run";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import {
  buildPostTurnSharedInitialResponseFormat,
  sharedSchemaListsAllRequiredKeys,
} from "@/lib/postTurnSharedInitial/schema";
import type { StatusWidget } from "@/lib/statusWidget/types";

function withMockFetch(run: (bodies: Record<string, unknown>[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  const bodies: Record<string, unknown>[] = [];

  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                statusWidget: {
                  character_values: { 시간: "14:00" },
                  user_values: {},
                  extracted_facts: [],
                },
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  return run(bodies).finally(() => {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  });
}

describe("post-turn shared initial wire contract", () => {
  it("A: background-post-turn-shared-initial sends response_format=json_schema strict", async () => {
    await withMockFetch(async (bodies) => {
      await runPostTurnSharedInitial({
        mode: "character",
        charName: "테스트",
        characterIdentity: null,
        characterCriticalContext: null,
        personaName: "유저",
        userMessage: "안녕",
        assistantProse: "반가워.",
        characterWidget: DEFAULT_STATUS_WIDGET,
        userWidget: null,
        primaryModelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        includeSuggestions: false,
        includeRelationship: false,
        relationshipRegenContext: null,
      });
      assert.equal(bodies.length, 1);
      const wireFormat = bodies[0]?.response_format as {
        type?: string;
        json_schema?: { strict?: boolean; name?: string };
      };
      assert.equal(wireFormat?.type, "json_schema");
      assert.equal(wireFormat?.json_schema?.strict, true);
      assert.equal(wireFormat?.json_schema?.name, "post_turn_shared_initial");
    });
  });

  it("B: background-memory-extract does NOT send response_format", async () => {
    await withMockFetch(async (bodies) => {
      await callBackgroundMemory(
        "system",
        [{ role: "user", content: "hello" }],
        undefined,
        "background-memory-extract",
        { modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL }
      );
      assert.equal(bodies.length, 1);
      assert.equal("response_format" in (bodies[0] ?? {}), false);
    });
  });

  it("C: background-episodic-extract does NOT send response_format", async () => {
    await withMockFetch(async (bodies) => {
      await callOpenRouterCompletion({
        model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        system: "system",
        history: [{ role: "user", content: "hello" }],
        requestKind: "background-episodic-extract",
      });
      assert.equal(bodies.length, 1);
      assert.equal("response_format" in (bodies[0] ?? {}), false);
    });
  });

  it("D: unrelated background task unchanged (no response_format)", async () => {
    await withMockFetch(async (bodies) => {
      await callOpenRouterCompletion({
        model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        system: "system",
        history: [{ role: "user", content: "hello" }],
        requestKind: "background-status-meta-extract",
      });
      assert.equal(bodies.length, 1);
      assert.equal("response_format" in (bodies[0] ?? {}), false);
    });
  });

  it("E: CheaperInference adapter preserves json_schema response_format for Luna", () => {
    const format = buildPostTurnSharedInitialResponseFormat({
      mode: "character",
      charName: "c",
      characterIdentity: null,
      characterCriticalContext: null,
      personaName: "u",
      userMessage: "m",
      assistantProse: "a",
      characterWidget: DEFAULT_STATUS_WIDGET,
      userWidget: null,
      primaryModelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      includeSuggestions: false,
      includeRelationship: false,
      relationshipRegenContext: null,
    });
    const adapted = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      temperature: 0.4,
      max_tokens: 4096,
      response_format: format,
    });
    assert.equal(adapted.response_format.type, "json_schema");
    assert.equal(adapted.response_format.json_schema.strict, true);
    assert.deepEqual(adapted.reasoning, { effort: "none" });
  });

  it("F: dynamic widget keys with JSON-special chars are required in wire schema", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        {
          id: 'key"quote',
          label: "라벨\n줄",
          instruction: "값",
        },
      ],
    };
    const input = {
      mode: "character" as const,
      charName: "c",
      characterIdentity: null,
      characterCriticalContext: null,
      personaName: "u",
      userMessage: "m",
      assistantProse: "a",
      characterWidget: widget,
      userWidget: null,
      primaryModelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      includeSuggestions: false,
      includeRelationship: false,
      relationshipRegenContext: null,
    };
    assert.equal(sharedSchemaListsAllRequiredKeys(input), true);
    const schemaText = JSON.stringify(buildPostTurnSharedInitialResponseFormat(input));
    assert.match(schemaText, /key\\"quote/);
    assert.match(schemaText, /라벨_줄/);
    const system = buildPostTurnSharedInitialSystem(input);
    assert.doesNotMatch(system, /Valid structural JSON example/);
  });
});
