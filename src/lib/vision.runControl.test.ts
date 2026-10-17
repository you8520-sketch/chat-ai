import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";

import { OPENROUTER_QWEN38_FLASH_MODEL, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL } from "@/lib/chatModels";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "@/lib/openRouterConfig";
import { analyzeAssetImage, type VisionProviderPost, type VisionRunControl } from "@/lib/vision";

/**
 * Run control of the canonical asset vision owner against a mock provider.
 * Every network call is intercepted; no request leaves the process.
 */
const IMAGE_URL = "https://images.test/candidate.webp";
const DUMMY_KEY = "test-dummy-key-not-a-credential";
const PARSED = JSON.stringify({
  imageType: "person",
  personTag: "미소",
  backgroundTag: null,
  adult: false,
  reject: false,
  reason: "mock provider",
  nippleExposure: "none",
});

type ProviderReply = { status: number; content?: string; costUsd?: number; usage?: boolean } | "transport_error";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.ASSET_VISION_MODEL;
const originalFallback = process.env.ASSET_VISION_MODEL_FALLBACK;
let replies: ProviderReply[] = [];
let imageStatus = 200;
let providerPosts: string[] = [];
let otherRequests: string[] = [];

function reply(content: string, costUsd?: number, usage = true): ProviderReply {
  return { status: 200, content, costUsd, usage };
}

function recordingControl(refuseAt: number | null = null) {
  const before: string[] = [];
  const settled: VisionProviderPost[] = [];
  const control: VisionRunControl = {
    beforeProviderPost(model) {
      before.push(model);
      return refuseAt !== null && before.length >= refuseAt ? "budget stop" : null;
    },
    afterProviderPost(post) {
      settled.push(post);
    },
  };
  return { control, before, settled };
}

before(() => {
  delete process.env.ASSET_VISION_MODEL;
  delete process.env.ASSET_VISION_MODEL_FALLBACK;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === IMAGE_URL && !init?.method) {
      return new Response(imageStatus === 200 ? new Uint8Array([1, 2, 3]) : "missing", {
        status: imageStatus,
        headers: { "content-type": "image/webp" },
      });
    }
    if (url === OPENROUTER_CHAT_COMPLETIONS_URL && init?.method === "POST") {
      providerPosts.push((JSON.parse(String(init.body)) as { model: string }).model);
      const next = replies.shift();
      if (!next) throw new Error("mock provider has no scripted reply");
      if (next === "transport_error") throw new TypeError("fetch failed");
      if (next.status !== 200) return new Response("upstream error", { status: next.status });
      const usage = next.usage
        ? { prompt_tokens: 3000, completion_tokens: 40, ...(next.costUsd != null ? { cost: next.costUsd } : {}) }
        : undefined;
      return Response.json({ choices: [{ message: { content: next.content } }], ...(usage ? { usage } : {}) });
    }
    otherRequests.push(url);
    throw new Error(`network egress is not allowed: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  assert.deepEqual(replies, [], "unused scripted replies");
  assert.deepEqual(otherRequests, []);
  replies = [];
  imageStatus = 200;
  providerPosts = [];
  otherRequests = [];
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalModel !== undefined) process.env.ASSET_VISION_MODEL = originalModel;
  if (originalFallback !== undefined) process.env.ASSET_VISION_MODEL_FALLBACK = originalFallback;
});

describe("asset vision run control (mock provider)", () => {
  it("without a key or a readable image no provider POST is made and the control is never asked", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const noKey = recordingControl();
    const unkeyed = await analyzeAssetImage(IMAGE_URL, 0, noKey.control);
    assert.equal(unkeyed.estimated, true);
    assert.deepEqual(unkeyed.costAttempts, []);
    assert.deepEqual(noKey.before, []);

    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    imageStatus = 404;
    const unreadable = recordingControl();
    const missing = await analyzeAssetImage(IMAGE_URL, 0, unreadable.control);
    assert.equal(missing.estimated, true);
    assert.deepEqual(unreadable.before, []);
    assert.deepEqual(providerPosts, []);
  });

  it("a parsed primary is one POST and the fallback is never asked for", async () => {
    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    replies = [reply(PARSED, 0.0004)];
    const run = recordingControl();
    const result = await analyzeAssetImage(IMAGE_URL, 0, run.control);
    assert.equal(result.estimated, false);
    assert.deepEqual(providerPosts, [OPENROUTER_QWEN38_FLASH_MODEL]);
    assert.deepEqual(run.before, [OPENROUTER_QWEN38_FLASH_MODEL]);
    assert.equal(run.settled.length, 1);
    assert.equal(run.settled[0]!.outcome, "parsed");
    assert.equal(run.settled[0]!.cost?.upstreamCostUsd, 0.0004);
  });

  it("a failed primary settles before the fallback POST is checked and sent", async () => {
    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    replies = [{ status: 500 }, reply(PARSED, 0.0006)];
    const order: string[] = [];
    const control: VisionRunControl = {
      beforeProviderPost: (model) => {
        order.push(`before ${model} posts=${providerPosts.length}`);
        return null;
      },
      afterProviderPost: (post) => {
        order.push(`after ${post.model} ${post.outcome}`);
      },
    };
    const result = await analyzeAssetImage(IMAGE_URL, 0, control);
    assert.equal(result.estimated, false);
    assert.deepEqual(providerPosts, [OPENROUTER_QWEN38_FLASH_MODEL, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL]);
    assert.deepEqual(order, [
      `before ${OPENROUTER_QWEN38_FLASH_MODEL} posts=0`,
      `after ${OPENROUTER_QWEN38_FLASH_MODEL} http_error`,
      `before ${OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL} posts=1`,
      `after ${OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL} parsed`,
    ]);
  });

  it("a refusal after the primary sends no fallback POST", async () => {
    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    replies = [reply("not json", 0.02)];
    const run = recordingControl(2);
    const result = await analyzeAssetImage(IMAGE_URL, 0, run.control);
    assert.equal(result.estimated, true);
    assert.equal(result.stoppedBeforeProviderPost, "budget stop");
    assert.deepEqual(providerPosts, [OPENROUTER_QWEN38_FLASH_MODEL]);
    assert.deepEqual(run.settled.map((post) => post.outcome), ["unparsed"]);
    assert.equal(result.costAttempts[0]?.upstreamCostUsd, 0.02);
  });

  it("transport errors and replies without usage are sent POSTs with no usage witness", async () => {
    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    replies = ["transport_error", reply(PARSED, undefined, false)];
    const run = recordingControl();
    const result = await analyzeAssetImage(IMAGE_URL, 0, run.control);
    assert.equal(result.estimated, false);
    assert.equal(providerPosts.length, 2);
    assert.deepEqual(
      run.settled.map((post) => [post.outcome, post.cost?.usageEstimated ?? null, post.cost?.upstreamCostUsd ?? null]),
      [
        ["transport_error", null, null],
        ["parsed", true, null],
      ]
    );
  });

  it("without a control the primary → fallback order is unchanged", async () => {
    process.env.OPENROUTER_API_KEY = DUMMY_KEY;
    replies = [{ status: 502 }, reply(PARSED, 0.0006)];
    const result = await analyzeAssetImage(IMAGE_URL);
    assert.equal(result.estimated, false);
    assert.equal(result.stoppedBeforeProviderPost, undefined);
    assert.deepEqual(providerPosts, [OPENROUTER_QWEN38_FLASH_MODEL, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL]);
  });
});
