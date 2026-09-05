import assert from "node:assert/strict";
import test from "node:test";
import { detectRpMetaLeakage } from "./narrativeRules";
import { streamOpenRouterAdultToClient } from "./openRouterAdult";
import type { TokenUsage } from "./ai";

const USAGE: TokenUsage = { inputTokens: 8, outputTokens: 12, estimated: true };

const RP =
  "재현은 천천히 고개를 들었다. 창밖으로 빗줄기가 떨어지고 있었다. " +
  "복도 끝에서 발소리가 가까워지자 그는 숨을 낮추고 문고리를 잡아당겼다. " +
  "차가운 공기가 뺨을 스쳤고, 그는 그대로 한 발을 내디뎠다. " +
  "「조용히 있어.」 그는 손을 내밀었다. 손가락 끝이 미세하게 떨리고 있었다.";

const LEAK_TAIL = "Need length count. Need final response.";

async function* yieldParts(parts: string[]) {
  for (const part of parts) {
    yield part;
  }
  return USAGE;
}

function replayClientText(events: object[]): string {
  let text = "";
  for (const event of events) {
    const typed = event as { type?: string; text?: string };
    if (typed.type === "reset") text = "";
    else if (typed.type === "replace" && typed.text != null) text = typed.text;
    else if (typed.type === "append" && typed.text) text += typed.text;
  }
  return text;
}

function typesOf(events: object[]): string[] {
  return events.map((event) => String((event as { type?: string }).type ?? ""));
}

async function runToClient(stream: () => AsyncGenerator<string, TokenUsage>) {
  const events: object[] = [];
  await streamOpenRouterAdultToClient(
    (event) => events.push(event),
    "You are a character.",
    [{ role: "user", content: "안녕" }],
    "gpt-5.6-luna",
    "live-stream-test",
    null,
    { allowOpenRouterUnderLengthRecovery: false },
    undefined,
    stream
  );
  return events;
}

test("first pass forwards live appends instead of one end dump", async () => {
  const t0 = Date.now();
  let lastYieldAt = 0;
  const events: Array<{ type?: string; text?: string; atMs: number }> = [];

  await streamOpenRouterAdultToClient(
    (event) => events.push({ ...(event as { type?: string; text?: string }), atMs: Date.now() - t0 }),
    "You are a character.",
    [{ role: "user", content: "안녕" }],
    "gpt-5.6-luna",
    "live-stream-test",
    null,
    { allowOpenRouterUnderLengthRecovery: false },
    undefined,
    async function* () {
      yield RP.slice(0, 40);
      await new Promise((resolve) => setTimeout(resolve, 30));
      lastYieldAt = Date.now() - t0;
      yield RP.slice(40);
      return USAGE;
    }
  );

  const appends = events.filter((event) => event.type === "append");
  const firstAppend = events.find((event) => event.type === "append");
  assert.ok(appends.length >= 1, "expected live append events");
  assert.ok(firstAppend, "expected at least one append");
  assert.ok(
    (firstAppend.atMs ?? 9999) <= lastYieldAt,
    `first append should arrive during generation, not after (${firstAppend.atMs} vs last yield ${lastYieldAt})`
  );
  assert.equal(events.some((event) => event.type === "reset"), false);
});

test("trailing working notes are clipped without regenerating", async () => {
  const leaked = `${RP}\n\n${LEAK_TAIL}`;
  assert.equal(detectRpMetaLeakage(leaked).status, "FAILURE");
  assert.equal(detectRpMetaLeakage(leaked).tailOnly, true);

  let streamCalls = 0;
  const events = await runToClient(() => {
    streamCalls += 1;
    return yieldParts([leaked]);
  });

  assert.equal(streamCalls, 1, "tail leak should not start a second generation");
  assert.equal(events.some((event) => (event as { type?: string }).type === "reset"), false);
  const visible = replayClientText(events);
  assert.doesNotMatch(visible, /Need length/i);
  assert.match(visible, /재현은 천천히 고개를 들었다/);
});

test("early working notes block the turn without a second generation", async () => {
  const leaked = `${LEAK_TAIL}\n\n${RP}`;
  assert.equal(detectRpMetaLeakage(leaked).status, "FAILURE");
  assert.equal(detectRpMetaLeakage(leaked).tailOnly, false);

  let streamCalls = 0;
  await assert.rejects(
    () =>
      runToClient(() => {
        streamCalls += 1;
        return yieldParts([leaked]);
      }),
    (error: unknown) => {
      assert.equal((error as Error).name, "MetaLeakageAbortError");
      return true;
    }
  );
  assert.equal(
    streamCalls,
    1,
    "strict Main RP single attempt — meta leak must not start a second generation"
  );
});
