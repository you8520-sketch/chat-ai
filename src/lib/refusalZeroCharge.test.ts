import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSelfDeclaredGenerationRefusal } from "./adultSceneRouting";
import { detectAdultGenerationFailure, generationFailureUserMessage } from "./responseLength";
import { streamOpenRouterAdult } from "./openRouterAdult";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
} from "./chatModels";

const FROZEN_B2_GEMINI_REFUSAL =
  "요청하신 명시적인 성적 묘사(삽입, 성교 등 노골적인 성인 콘텐츠)는 안전 가이드라인에 위배되어 작성할 수 없습니다. 캐릭터 간의 다른 상호작용이나 다른 방향의 이야기 전개로 수정해 주시면 계속해서 롤플레이를 진행해 드리겠습니다.";
const FROZEN_B3_GEMINI_REFUSAL =
  "죄송합니다만, 요청하신 노골적인 성적 행위 묘사(삽입, 구체적인 성행위, 사정 등)를 포함한 장면은 안전 가이드라인에 위배되므로 생성할 수 없습니다. 다른 방향의 이야기 전개나 설정에 대해서는 기꺼이 도움을 드릴 수 있으니, 원하시는 다른 상황이 있다면 말씀해 주시기 바랍니다.";

const REFUSAL_CORE =
  "죄송합니다. 요청하신 장면은 안전 가이드라인에 위배되어 작성할 수 없습니다. 다른 방향의 이야기라면 이어서 도와드리겠습니다.";

function longRefusal(): string {
  return [
    REFUSAL_CORE,
    ...Array.from({ length: 28 }, (_, index) => {
      const n = index + 1;
      return `${n}번째 안내로, 이번 요청의 장면 생성은 여기서 멈추고 새로운 상황 번호 ${n * 17}만 남깁니다.`;
    }),
  ].join(" ");
}

function longProse(seed: string): string {
  return Array.from({ length: 24 }, (_, index) => {
    const n = index + 1;
    return `${seed} 창가의 ${n}번째 호흡에서 그는 그녀의 손을 꼭 쥐고 번호 ${n * 13}의 고요만 남겼다.`;
  }).join(" ");
}

const CHARACTER_BOUNDARY = longProse("「싫어. 하지 마.」 그녀가 고개를 저었다.");
const QUOTED_REFUSAL = longProse(
  "그는 화면에 뜬 문장을 읽었다. 「요청하신 내용은 안전 정책상 작성할 수 없습니다.」 그리고 다시 창밖을 보았다."
);
const FIFTEEN_PLUS = longProse(
  "그는 그녀의 손을 잡고 창가로 이끌었다. 가벼운 입맞춤 뒤, 오늘은 감정만 이어가자고 낮게 말했다."
);

describe("self-declared generation refusal", () => {
  it("treats a long finish=stop refusal as model_refusal regardless of length", () => {
    const text = longRefusal();
    assert.ok(text.length > 1000);
    assert.equal(isSelfDeclaredGenerationRefusal(text), true);
    assert.equal(detectAdultGenerationFailure("stop", text, 3200), "model_refusal");
    assert.equal(detectAdultGenerationFailure("STOP", FROZEN_B2_GEMINI_REFUSAL, 3200), "model_refusal");
    assert.equal(detectAdultGenerationFailure("stop", FROZEN_B3_GEMINI_REFUSAL, 3200), "model_refusal");
  });

  it("keeps native refusal, safety, and content_filter on their existing reasons", () => {
    assert.equal(detectAdultGenerationFailure("refusal", "", 3200), "model_refusal");
    assert.equal(detectAdultGenerationFailure("SAFETY", longProse("장면"), 3200), "safety");
    assert.equal(
      detectAdultGenerationFailure("content_filter", longProse("장면"), 3200),
      "content_filter"
    );
    assert.equal(detectAdultGenerationFailure("error", longRefusal(), 3200), "provider_error");
  });

  it("does not treat character boundaries, quoted refusals, or 15+ transitions as AI refusal", () => {
    for (const text of [CHARACTER_BOUNDARY, QUOTED_REFUSAL, FIFTEEN_PLUS, longProse("평범한 오후")]) {
      assert.ok(text.length > 1000, text.slice(0, 24));
      assert.equal(isSelfDeclaredGenerationRefusal(text), false, text.slice(0, 40));
      assert.equal(detectAdultGenerationFailure("stop", text, 3200), null, text.slice(0, 40));
    }
    assert.equal(
      isSelfDeclaredGenerationRefusal("그는 왕의 요청에 응할 수 없었다. 창가로 걸어가 숨을 골랐다."),
      false
    );
    assert.equal(
      isSelfDeclaredGenerationRefusal(
        "그녀는 그 요청에 응할 수 없습니다. 창가에 앉아 그의 손을 잡고 숨을 골랐다."
      ),
      false
    );
    assert.equal(
      isSelfDeclaredGenerationRefusal("「그건 안 돼.」 그녀가 고개를 저었다. 오늘은 여기까지만 하자."),
      false
    );
  });

  it("uses the settlement-matching user notice", () => {
    assert.equal(
      generationFailureUserMessage("model_refusal"),
      "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다."
    );
  });
});

type Shape = {
  id: string;
  model: string;
  transport: "openrouter" | "cheaperinference";
  terminal: Record<string, unknown>;
};

const SHAPES: Shape[] = [
  {
    id: "gemini-3.8-flash",
    model: OPENROUTER_GEMINI_38_FLASH_MODEL,
    transport: "openrouter",
    terminal: {
      model: OPENROUTER_GEMINI_38_FLASH_MODEL,
      choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
      usage: {
        prompt_tokens: 800,
        completion_tokens: 300,
        cost: 0.004,
        cost_details: { upstream_inference_cost: 0.004 },
      },
    },
  },
  {
    id: "gemini-4-argon",
    model: OPENROUTER_GEMINI_4_ARGON_MODEL,
    transport: "openrouter",
    terminal: {
      model: OPENROUTER_GEMINI_4_ARGON_MODEL,
      choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
      usage: {
        prompt_tokens: 800,
        completion_tokens: 300,
        cost: 0.0123,
        cost_details: { upstream_inference_cost: 0.0123 },
      },
    },
  },
  {
    id: "gpt-6.1-sol",
    model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
    transport: "cheaperinference",
    terminal: {
      id: "sol-shape-req",
      model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 800, completion_tokens: 300, cost: 0.008 },
      cheaper_inference: {
        request_id: "sol-shape-req",
        billing: { status: "settled", billed_cost_usd: "0.008000", currency: "USD" },
      },
    },
  },
  {
    id: "claude-opus-5.5",
    model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    transport: "cheaperinference",
    terminal: {
      id: "opus-shape-req",
      model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      choices: [{ delta: {}, finish_reason: "stop" }],
      stop_reason: "end_turn",
      usage: { prompt_tokens: 800, completion_tokens: 300, cost: 0.021 },
      cheaper_inference: {
        request_id: "opus-shape-req",
        billing: { status: "settled", billed_cost_usd: "0.021000", currency: "USD" },
      },
    },
  },
];

function sseFor(text: string, terminal: Record<string, unknown>): Response {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 240) {
    parts.push(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 240) } }] })}\n\n`
    );
  }
  parts.push(`data: ${JSON.stringify(terminal)}\n\n`);
  parts.push("data: [DONE]\n\n");
  return new Response(parts.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function consume(text: string, shape: Shape): Promise<{ text: string; finish: string | undefined }> {
  const previous = globalThis.fetch;
  const previousOr = process.env.OPENROUTER_API_KEY;
  const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-fixture";
  process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-fixture";
  globalThis.fetch = (async () => sseFor(text, shape.terminal)) as typeof fetch;
  try {
    const gen = streamOpenRouterAdult(
      "system",
      [{ role: "user", content: "continue" }],
      shape.model,
      3200,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: shape.transport,
      }
    );
    let body = "";
    let finish: string | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        finish = next.value.finishReason;
        break;
      }
      body += next.value;
    }
    return { text: body, finish };
  } finally {
    globalThis.fetch = previous;
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
    if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
  }
}

describe("Main RP provider response shapes", () => {
  for (const shape of SHAPES) {
    it(`${shape.id} stop refusal is model_refusal and normal prose is not`, async () => {
      const refused = await consume(longRefusal(), shape);
      assert.equal(refused.finish, "stop", shape.id);
      assert.ok(refused.text.length > 1000);
      assert.equal(detectAdultGenerationFailure(refused.finish, refused.text, 3200), "model_refusal");

      const prose = await consume(longProse("두 사람은 창가에 남았다."), shape);
      assert.equal(prose.finish, "stop", shape.id);
      assert.equal(detectAdultGenerationFailure(prose.finish, prose.text, 3200), null);
    });
  }

  it("gemini native_finish_reason=refusal stays model_refusal", async () => {
    const shape = SHAPES[0]!;
    const native = await consume(longRefusal(), {
      ...shape,
      terminal: {
        model: shape.model,
        choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "refusal" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001, cost_details: { upstream_inference_cost: 0.001 } },
      },
    });
    assert.equal(native.finish, "refusal");
    assert.equal(detectAdultGenerationFailure(native.finish, native.text, 3200), "model_refusal");
  });
});
