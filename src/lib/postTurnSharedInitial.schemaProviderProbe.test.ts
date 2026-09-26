import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import type { StatusWidget } from "@/lib/statusWidget/types";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "@/lib/postTurnSharedInitial/prompt";
import { buildPostTurnSharedInitialResponseFormat } from "@/lib/postTurnSharedInitial/schema";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import { resolveOptInTestCheaperInferenceApiKey } from "../../scripts/lib/benchmarkCheaperInferenceCredential";

const USER_WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
};

/** Maximum production envelope: dual widget + suggestions + relationship + regen. */
function fullProductionProbeInput(): PostTurnSharedInitialInput {
  return {
    mode: "dual",
    charName: "레온",
    characterIdentity: null,
    characterCriticalContext: null,
    personaName: "렌",
    userMessage: "안녕, 오늘 기분이 어때?",
    assistantProse: "레온은 창가에 기대어 하늘을 바라본다. \"괜찮아, 그냥 조용한 하루였어.\"",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: USER_WIDGET,
    primaryModelId: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    includeSuggestions: true,
    includeRelationship: true,
    includeEpisodic: false,
    relationshipRegenContext: { previousAssistantMessage: "rejected shorter draft" },
  };
}

const REAL_PROVIDER_SCHEMA_PROBE = "REAL_PROVIDER_SCHEMA_PROBE";
const probeDescribe =
  resolveOptInTestCheaperInferenceApiKey(REAL_PROVIDER_SCHEMA_PROBE) ? describe : describe.skip;

probeDescribe("postTurnSharedInitial exact production schema provider probe", () => {
  it("accepts exact buildPostTurnSharedInitialResponseFormat on CheaperInference GPT-6 Luna (1 call)", async () => {
    const key = resolveOptInTestCheaperInferenceApiKey(REAL_PROVIDER_SCHEMA_PROBE);
    assert.ok(
      key,
      "requires REGULAR_TEST_REAL_PROVIDER_CALLS=1 + REAL_PROVIDER_SCHEMA_PROBE=1 + CHEAPER_INFERENCE_BENCHMARK_API_KEY"
    );

    const input = fullProductionProbeInput();
    const responseFormat = buildPostTurnSharedInitialResponseFormat(input);
    const system = buildPostTurnSharedInitialSystem(input);
    const user = buildPostTurnSharedInitialUserBlock(input);
    const body = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 1024,
      response_format: responseFormat,
    });

    const started = Date.now();
    const res = await fetch("https://api.cheaperinference.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    assert.equal(res.status, 200, text.slice(0, 500));
    const json = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    assert.ok(content.trim().startsWith("{"), "provider returned JSON object");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(parsed.statusWidget, "statusWidget section present");
    assert.ok(parsed.suggestedReplies, "suggestedReplies section present");
    assert.ok(parsed.relationship, "relationship section present");

    console.info("[schema-provider-probe]", {
      calls: 1,
      elapsedMs,
      costUsd: json.usage?.cost ?? null,
      promptTokens: json.usage?.prompt_tokens ?? null,
      completionTokens: json.usage?.completion_tokens ?? null,
      schemaName: responseFormat.json_schema.name,
      topLevelKeys: Object.keys(parsed).sort(),
    });
  });
});
