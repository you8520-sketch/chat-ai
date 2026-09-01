import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TextEncoder } from "node:util";
import { mockReadableStreamFromText } from "@/lib/mockApiMode";
import { callTrpgGm } from "./gmCall";
import {
  assertGmCompletionCanCommit,
  assessGmCompletionIntegrity,
  finishReasonFromSsePayload,
  isGmAbnormalProviderFinishReason,
} from "./gmCompletionIntegrity";
import {
  createGmStreamParser,
  feedGmStreamParser,
  gmStreamParserComplete,
} from "./gmStreamParser";
import { feedGmProviderSseBytes } from "./gmProviderSse";
import { parseTrpgGmOutput, TRPG_GM_DELTA_OPEN, TRPG_GM_NARRATION_OPEN } from "./gmPrompt";
import { TRPG_BOT_MODEL, TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";
import { adaptTrpgGmChatBody } from "./gmClient";

const VALID_DELTA = JSON.stringify({
  players: [],
  location: "문턱",
  next_round_context: "다음",
  campaign_finished: false,
});

/** Production-shaped incident ending mid-sentence before DELTA. */
const INCIDENT_TRUNCATED_BEFORE_DELTA = `${TRPG_GM_NARRATION_OPEN}
GM: 권태현이 ... 강이현이 환풍구로 이어지는 안전한 우회로를 확보했지만 ... 태현의 방벽 뒤에서 이현이 찾은 환풍구 발판으로 단숨에 도약해 빠져나갈지, 아니면 태현과`;

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

function sseGmPayload(content: string, finishReason?: string, usage = { prompt_tokens: 4, completion_tokens: 6 }): string {
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

describe("gmCompletionIntegrity BEFORE reproduction", () => {
  it("CURRENT_INCIDENT_SHAPE: parser accepts truncated output with empty delta today", () => {
    const parsed = parseTrpgGmOutput(INCIDENT_TRUNCATED_BEFORE_DELTA);
    assert.match(parsed.narration, /아니면 태현과$/);
    assert.deepEqual(parsed.delta.players, []);
  });

  it("FAIL_BEFORE: truncated before DELTA cannot commit after integrity gate", () => {
    const assessment = assessGmCompletionIntegrity(INCIDENT_TRUNCATED_BEFORE_DELTA, { finishReason: "stop" });
    assert.equal(assessment.ok, false);
    assert.equal(assessment.status, "missing_delta_envelope");
    assert.throws(
      () => assertGmCompletionCanCommit(INCIDENT_TRUNCATED_BEFORE_DELTA, { finishReason: "stop" }, assessment),
      /missing required NARRATION\/DELTA envelope/
    );
  });
});

describe("gmCompletionIntegrity fixtures", () => {
  it("C1 — healthy stop + complete envelope commits", () => {
    const narration =
      "GM: 태현의 방벽 뒤에서 이현이 찾은 환풍구 발판으로 단숨에 도약해 빠져나갈지, 아니면 태현과 함께 버틴다.";
    const text = `${TRPG_GM_NARRATION_OPEN}\n${narration}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    assert.doesNotThrow(() => assertGmCompletionCanCommit(text, { finishReason: "stop" }));
    assert.match(parseTrpgGmOutput(text).narration, /함께 버틴다/);
  });

  it("C2 — finish_reason=length rejects (TRUNCATED_BEFORE_DELTA_CAN_COMMIT=false)", () => {
    const truncated = `${INCIDENT_TRUNCATED_BEFORE_DELTA}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    assert.throws(
      () => assertGmCompletionCanCommit(truncated, { finishReason: "length" }),
      /abnormal provider completion: length/
    );
    assert.equal(isGmAbnormalProviderFinishReason("length"), true);
  });

  it("C3 — finish_reason=content_filter rejects", () => {
    const text = `${TRPG_GM_NARRATION_OPEN}\n필터.\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    assert.throws(
      () => assertGmCompletionCanCommit(text, { finishReason: "content_filter" }),
      /abnormal provider completion: content_filter/
    );
  });

  it("C4 — EOF before DELTA with stop still rejects envelope", () => {
    assert.throws(
      () => assertGmCompletionCanCommit(INCIDENT_TRUNCATED_BEFORE_DELTA, { finishReason: "stop" }),
      /missing required NARRATION\/DELTA envelope/
    );
  });

  it("C5 — complete stream with DELTA missing rejects", () => {
    assert.throws(
      () => assertGmCompletionCanCommit(INCIDENT_TRUNCATED_BEFORE_DELTA, { finishReason: "stop" }),
      /missing required NARRATION\/DELTA envelope/
    );
  });

  it("C6 — finish_reason=stop but truncated DELTA JSON rejects", () => {
    const text = `${TRPG_GM_NARRATION_OPEN}\n장면.\n${TRPG_GM_DELTA_OPEN}\n{"players":[`;
    assert.throws(() => assertGmCompletionCanCommit(text, { finishReason: "stop" }), /not parseable JSON/);
  });

  it("C7 — EOF after complete envelope without [DONE] remains acceptable", () => {
    const text = `${TRPG_GM_NARRATION_OPEN}\neof complete\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    assert.doesNotThrow(() => assertGmCompletionCanCommit(text, { finishReason: null }));
  });

  it("empty narration between markers rejects (EMPTY_NARRATION_CAN_COMMIT=false)", () => {
    const text = `${TRPG_GM_NARRATION_OPEN}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    const assessment = assessGmCompletionIntegrity(text, { finishReason: "stop" });
    assert.equal(assessment.ok, false);
    assert.equal(assessment.status, "empty_narration");
    assert.throws(() => assertGmCompletionCanCommit(text, { finishReason: "stop" }, assessment), /NARRATION section is empty/);
    assert.match(parseTrpgGmOutput(text).narration, /장면이 잠시 멈췄다/);
  });

  it("C8 — arbitrary SSE chunk split around DELTA marker stays healthy", async () => {
    const korean = "한글 장면";
    const fullText = `${TRPG_GM_NARRATION_OPEN}\n${korean}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    const payload = JSON.stringify({ choices: [{ delta: { content: fullText } }] });
    const line = `data: ${payload}\n\n`;
    const usageLine = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    })}\n\n`;
    const bytes = new TextEncoder().encode(`${line}${usageLine}data: [DONE]\n\n`);
    const marker = TRPG_GM_DELTA_OPEN;
    const splitAt = line.indexOf(marker) + Math.floor(marker.length / 2);
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
    assert.doesNotThrow(() => assertGmCompletionCanCommit(result.text, { finishReason: result.finishReason }));
    assert.match(parseStreamNarration(result.text), /한글 장면/);
  });

  it("C9 — UTF-8 Korean byte split stays healthy", async () => {
    const korean = "한글";
    const fullText = `${TRPG_GM_NARRATION_OPEN}\n${korean}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(fullText, "stop")]);
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.doesNotThrow(() => assertGmCompletionCanCommit(result.text, { finishReason: "stop" }));
  });

  it("C10 — terminal finish_reason preserved separately from usage", () => {
    assert.equal(finishReasonFromSsePayload({ choices: [{ finish_reason: "stop" }] }), "stop");
    assert.equal(
      finishReasonFromSsePayload({
        choices: [{ delta: {}, finish_reason: "length" }],
        usage: { completion_tokens: 99 },
      }),
      "length"
    );
  });

  it("C11 — reroll transport uses same integrity owner", async () => {
    const text = `${TRPG_GM_NARRATION_OPEN}\n재생성.\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
    installGmSseStream([sseGmPayload(text, "stop")]);
    const result = await callTrpgGm({ system: "sys", user: "재생성", timeoutMs: 5_000 });
    assert.doesNotThrow(() => assertGmCompletionCanCommit(result.text, { finishReason: result.finishReason }));
  });

  it("C12 — invalid completion must not pass integrity even if parser would accept", () => {
    const parsed = parseTrpgGmOutput(INCIDENT_TRUNCATED_BEFORE_DELTA);
    assert.ok(parsed.narration.length > 0);
    assert.throws(() => assertGmCompletionCanCommit(INCIDENT_TRUNCATED_BEFORE_DELTA), /missing required NARRATION\/DELTA envelope/);
  });

  it("malformed SSE JSON is ignored without losing prior content", () => {
    const payloads: unknown[] = [];
    const state = { buffer: "" };
    feedGmProviderSseBytes(
      state,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: {broken\n\n`,
      (payload) => payloads.push(payload),
      true
    );
    assert.equal(payloads.length, 1);
  });
});

describe("gmCompletionIntegrity transport + config", () => {
  it("TRPG_GM_MAX_TOKENS equals Gemini 3.7 Flash model max through adapter", () => {
    const body = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: true,
      max_tokens: TRPG_GM_MAX_TOKENS,
    });
    assert.equal(body.max_tokens, TRPG_GM_MAX_TOKENS);
    assert.equal(TRPG_GM_MAX_TOKENS, TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS);
    assert.equal(TRPG_GEMINI_37_FLASH_MAX_OUTPUT_TOKENS, 65_536);
  });

  it("length SSE through callTrpgGm returns text but integrity gate rejects commit", async () => {
    installGmSseStream([sseGmPayload(INCIDENT_TRUNCATED_BEFORE_DELTA, "length")]);
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.match(result.text, /아니면 태현과/);
    assert.equal(result.finishReason, "length");
    assert.throws(
      () => assertGmCompletionCanCommit(result.text, { finishReason: result.finishReason }),
      /abnormal provider completion: length/
    );
  });
});

describe("gmCompletionIntegrity real provider probe", () => {
  it("bounded finish_reason probe (skipped without API key)", async () => {
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
      finishReason: result.finishReason,
      semanticDone: result.semanticDone,
      rawCharCount: result.text.length,
    });
    assert.ok(result.text.length > 0);
  });
});
