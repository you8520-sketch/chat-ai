import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import { mockReadableStreamFromText, buildMockOpenRouterStreamChunks } from "@/lib/mockApiMode";
import {
  assertHealthyGmProviderCompletion,
  callTrpgGm,
  finishReasonFromSsePayload,
  isGmAbnormalProviderFinishReason,
} from "./gmCall";
import {
  createGmStreamParser,
  feedGmStreamParser,
  gmStreamParserComplete,
} from "./gmStreamParser";
import { feedGmProviderSseBytes } from "./gmProviderSse";
import { parseTrpgGmOutput } from "./gmPrompt";
import { TRPG_GM_MODEL } from "./types";

const VALID_DELTA = JSON.stringify({
  players: [],
  location: "문턱",
  next_round_context: "다음",
  campaign_finished: false,
});

const previousFetch = globalThis.fetch;
const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
const previousMock = process.env.MOCK_MODE;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
  else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  if (previousMock === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = previousMock;
});

function installGmSseStream(chunks: string[]): void {
  delete process.env.MOCK_MODE;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-completion";
  globalThis.fetch = (async () =>
    new Response(mockReadableStreamFromText(chunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;
}

function sseGmPayload(
  content: string,
  finishReason?: string,
  usage = { prompt_tokens: 4, completion_tokens: 6 }
): string {
  const lines = [`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`];
  if (finishReason !== undefined) {
    lines.push(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: finishReason }],
        usage,
      })}\n\n`
    );
  }
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}

function parseStreamNarration(raw: string): string {
  const parser = createGmStreamParser();
  for (let i = 0; i < raw.length; i += 7) {
    feedGmStreamParser(parser, raw.slice(i, i + 7));
  }
  gmStreamParserComplete(parser);
  return parser.narration;
}

describe("gmCompletionIntegrity fixtures", () => {
  it("C1 healthy stop preserves full narration and accepts completion", async () => {
    const narration = "GM: 환풍구 발판으로 단숨에 도약해 빠져나갈지, 아니면 태현과 함께 버틴다.";
    const text = `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(text, "stop")]);
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.match(result.text, /함께 버틴다/);
    assert.equal(result.finishReason, "stop");
    const parsed = parseTrpgGmOutput(result.text);
    assert.match(parsed.narration, /함께 버틴다/);
  });

  it("C2 abnormal provider length is rejected (BEFORE_ACCEPTS_LENGTH_AS_SUCCESS=false)", async () => {
    const truncated = `<<<NARRATION>>>\nGM: ...환풍구 발판으로 단숨에 도약해 빠져나갈지,\n아니면 태현과\n<<<DELTA>>>\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(truncated, "length")]);
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }),
      /abnormal provider completion: length/
    );
    assert.equal(isGmAbnormalProviderFinishReason("length"), true);
  });

  it("C3 early DELTA with provider stop still parses truncated narration (model boundary, not transport loss)", () => {
    const raw = `<<<NARRATION>>>\nGM: ...아니면 태현과\n<<<DELTA>>>\n${VALID_DELTA}`;
    const narration = parseStreamNarration(raw).trim();
    assert.match(narration, /아니면 태현과$/);
    const parsed = parseTrpgGmOutput(raw);
    assert.match(parsed.narration.trim(), /아니면 태현과$/);
    assert.ok(parsed.delta.nextRoundContext, "valid delta still parses");
  });

  it("C4 complete closing + DELTA remains healthy", async () => {
    const text = `<<<NARRATION>>>\nGM: 문이 닫히고 숨이 고르다.\n<<<DELTA>>>\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(text, "stop")]);
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.match(parseTrpgGmOutput(result.text).narration, /숨이 고르다/);
  });

  it("C5 SSE arbitrary chunk splits preserve Korean and markers", async () => {
    const korean = "한글 장면";
    const fullText = `<<<NARRATION>>>\n${korean}\n<<<DELTA>>>\n{}`;
    const payload = JSON.stringify({ choices: [{ delta: { content: fullText } }] });
    const line = `data: ${payload}\n\n`;
    const usageLine = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    })}\n\n`;
    const bytes = new TextEncoder().encode(`${line}${usageLine}data: [DONE]\n\n`);
    const hanIndex = line.indexOf("한");
    const splitAt = new TextEncoder().encode(line.slice(0, hanIndex)).length + 1;
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-completion";
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, splitAt));
            controller.enqueue(bytes.slice(splitAt));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.match(result.text, /한글 장면/);
    assert.match(parseStreamNarration(result.text), /한글 장면/);
  });

  it("C6 EOF without semantic [DONE] still completes trailing buffer", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-completion";
    const text = `<<<NARRATION>>>\neof tail\n<<<DELTA>>>\n{}`;
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(line));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.match(result.text, /eof tail/);
    assert.equal(result.finishReason, null);
  });

  it("C7 malformed SSE JSON is ignored without losing prior content", () => {
    const payloads: unknown[] = [];
    const state = { buffer: "" };
    feedGmProviderSseBytes(
      state,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: {broken\n\n`,
      (payload) => payloads.push(payload),
      true
    );
    assert.equal(payloads.length, 1);
    assert.equal(
      (payloads[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content,
      "ok"
    );
  });

  it("C8 reroll path uses the same GM transport owner (finish_reason gate)", async () => {
    const text = `<<<NARRATION>>>\n재생성 장면.\n<<<DELTA>>>\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(text, "stop")]);
    const result = await callTrpgGm({ system: "sys", user: "재생성", timeoutMs: 5_000 });
    assert.equal(result.finishReason, "stop");
    assert.throws(() => assertHealthyGmProviderCompletion("length"), /abnormal provider completion/);
  });

  it("finishReasonFromSsePayload preserves last non-null terminal reason", () => {
    assert.equal(finishReasonFromSsePayload({ choices: [{ finish_reason: "stop" }] }), "stop");
    assert.equal(
      finishReasonFromSsePayload({ choices: [{ delta: {}, finish_reason: "length" }] }),
      "length"
    );
    assert.equal(finishReasonFromSsePayload({ choices: [{ delta: { content: "x" } }] }), null);
  });

  it("content_filter terminal reason is rejected", async () => {
    const text = `<<<NARRATION>>>\n필터.\n<<<DELTA>>>\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(text, "content_filter")]);
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }),
      /abnormal provider completion: content_filter/
    );
  });
});

describe("gmCompletionIntegrity real provider probe", () => {
  it("bounded Gemini finish_reason probe (skipped without API key)", async () => {
    const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
    if (!key || key.startsWith("your_")) {
      console.info("FINISH_REASON_PROBE_SKIPPED=true");
      return;
    }
    delete process.env.MOCK_MODE;
    const result = await callTrpgGm({
      system: "You are a TRPG GM. Korean only.",
      user: `<<<NARRATION>>>\nWrite one short sentence.\n<<<DELTA>>>\n${VALID_DELTA}`,
      timeoutMs: 60_000,
    });
    console.info("FINISH_REASON_PROBE", {
      finishReasonPresent: result.finishReason != null,
      finishReason: result.finishReason,
      rawCharCount: result.text.length,
      narrationCharCount: parseTrpgGmOutput(result.text).narration.length,
      model: TRPG_GM_MODEL,
    });
    assert.ok(result.text.length > 0);
  });
});
