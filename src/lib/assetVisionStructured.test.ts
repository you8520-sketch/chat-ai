import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ASSET_PERSON_TAGS,
  buildAssetVisionJsonSchema,
  deriveFinalAssetTag,
  normalizeBackgroundTag,
  validateStructuredAssetVisionResult,
} from "@/lib/assetPersonTags";
import {
  finalizeStructuredVisionResult,
  parseAssetVisionResponseText,
  buildAssetVisionRequestBody,
  visionModels,
} from "@/lib/vision";
import { resolveAssetVisionPrimaryModel } from "@/lib/assetVisionModels";
import {
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";

function personPayload(
  personTag: string,
  opts: Partial<{ adult: boolean; reject: boolean; reason: string; backgroundTag: string | null }> = {}
) {
  return {
    imageType: "person",
    personTag,
    backgroundTag: opts.backgroundTag ?? null,
    adult: opts.adult ?? false,
    reject: opts.reject ?? false,
    reason: opts.reason ?? "",
  };
}

function backgroundPayload(
  backgroundTag: string,
  opts: Partial<{ adult: boolean; reject: boolean; reason: string; personTag: string | null }> = {}
) {
  return {
    imageType: "background",
    personTag: opts.personTag ?? null,
    backgroundTag,
    adult: opts.adult ?? false,
    reject: opts.reject ?? false,
    reason: opts.reason ?? "",
  };
}

describe("assetPersonTags validation", () => {
  it("accepts canonical person tags", () => {
    for (const tag of ["미소", "부끄러움", "전투자세", "무표정"] as const) {
      const validated = validateStructuredAssetVisionResult(personPayload(tag));
      assert.ok(validated);
      assert.equal(deriveFinalAssetTag(validated!), tag);
    }
  });

  it("rejects clothing/location as person tags", () => {
    assert.equal(validateStructuredAssetVisionResult(personPayload("검은 옷")), null);
    assert.equal(validateStructuredAssetVisionResult(personPayload("침실")), null);
    assert.equal(validateStructuredAssetVisionResult(personPayload("역광")), null);
    assert.equal(validateStructuredAssetVisionResult(personPayload("젖은 상의")), null);
  });

  it("rejects multi-value person tags", () => {
    assert.equal(validateStructuredAssetVisionResult(personPayload("미소, 행복")), null);
  });

  it("requires personTag for person imageType", () => {
    assert.equal(
      validateStructuredAssetVisionResult({
        imageType: "person",
        personTag: null,
        backgroundTag: null,
        adult: false,
        reject: false,
        reason: "",
      }),
      null
    );
  });

  it("ignores backgroundTag on person results", () => {
    const validated = validateStructuredAssetVisionResult(
      personPayload("미소", { backgroundTag: "침실" })
    );
    assert.ok(validated);
    assert.equal(validated!.backgroundTag, null);
    assert.equal(deriveFinalAssetTag(validated!), "미소");
  });

  it("accepts bounded background place tags", () => {
    for (const tag of ["침실", "도시 거리", "우주선 내부"] as const) {
      assert.equal(normalizeBackgroundTag(tag), tag);
      const validated = validateStructuredAssetVisionResult(backgroundPayload(tag));
      assert.ok(validated);
      assert.equal(deriveFinalAssetTag(validated!), tag);
    }
  });

  it("rejects background meta/visual garbage descriptors", () => {
    for (const tag of [
      "역광",
      "푸른 조명",
      "고화질",
      "클로즈업",
      "몽환적 분위기",
      "high quality",
    ] as const) {
      assert.equal(normalizeBackgroundTag(tag), null, tag);
      assert.equal(validateStructuredAssetVisionResult(backgroundPayload(tag)), null, tag);
    }
  });

  it("rejects long or compound background tags", () => {
    assert.equal(
      normalizeBackgroundTag("푸른 조명의 현대적인 침실"),
      null
    );
    assert.equal(normalizeBackgroundTag("도시, 야경"), null);
    assert.equal(
      validateStructuredAssetVisionResult(backgroundPayload("푸른 조명의 현대적인 침실")),
      null
    );
  });

  it("rejects background with personTag set", () => {
    const validated = validateStructuredAssetVisionResult(
      backgroundPayload("침실", { personTag: "미소" })
    );
    assert.ok(validated);
    assert.equal(validated!.personTag, null);
  });
});

const ADULT_RP_TAGS = [
  "키스",
  "밀착",
  "유혹",
  "도발",
  "욕망",
  "황홀",
  "애정",
  "흥분",
] as const;

describe("adult-RP person tag taxonomy", () => {
  it("includes all 8 adult-RP tags in canonical ASSET_PERSON_TAGS", () => {
    assert.equal(ASSET_PERSON_TAGS.length, 36);
    for (const tag of ADULT_RP_TAGS) {
      assert.equal(ASSET_PERSON_TAGS.includes(tag), true, tag);
    }
  });

  it("reflects new tags in JSON Schema enum from canonical owner", () => {
    const schema = buildAssetVisionJsonSchema();
    const personTagProp = (schema.properties as Record<string, unknown>)
      .personTag as { anyOf: { enum?: string[] }[] };
    const enumValues = personTagProp.anyOf[0]?.enum ?? [];
    for (const tag of ADULT_RP_TAGS) {
      assert.equal(enumValues.includes(tag), true, tag);
    }
    assert.equal(enumValues.length, ASSET_PERSON_TAGS.length);
  });

  it("accepts each adult-RP tag as valid structured personTag", () => {
    for (const tag of ADULT_RP_TAGS) {
      const validated = validateStructuredAssetVisionResult(personPayload(tag));
      assert.ok(validated, tag);
      assert.equal(deriveFinalAssetTag(validated!), tag);
    }
  });

  it("keeps tag and moderation independent", () => {
    const kissClear = validateStructuredAssetVisionResult(
      personPayload("키스", { adult: false, reject: false })
    );
    assert.ok(kissClear);
    assert.equal(finalizeStructuredVisionResult(kissClear!).adultFlagged, false);
    assert.equal(finalizeStructuredVisionResult(kissClear!).moderationReject, false);

    const seduceClear = validateStructuredAssetVisionResult(
      personPayload("유혹", { adult: false, reject: false })
    );
    assert.ok(seduceClear);
    assert.equal(finalizeStructuredVisionResult(seduceClear!).adultFlagged, false);

    const ecstasyReview = validateStructuredAssetVisionResult(
      personPayload("황홀", { adult: true, reject: false, reason: "선정성 애매" })
    );
    assert.ok(ecstasyReview);
    assert.equal(finalizeStructuredVisionResult(ecstasyReview!).adultFlagged, true);
    assert.equal(finalizeStructuredVisionResult(ecstasyReview!).moderationReject, false);
    assert.equal(deriveFinalAssetTag(ecstasyReview!), "황홀");
  });
});

describe("asset vision moderation invariants", () => {
  it("preserves three-tier moderation semantics", () => {
    const normal = finalizeStructuredVisionResult(
      validateStructuredAssetVisionResult(personPayload("미소"))!
    );
    assert.equal(normal.adultFlagged, false);
    assert.equal(normal.moderationReject, false);

    const review = finalizeStructuredVisionResult(
      validateStructuredAssetVisionResult(
        personPayload("부끄러움", { adult: true, reason: "속옷 노출 애매" })
      )!
    );
    assert.equal(review.adultFlagged, true);
    assert.equal(review.moderationReject, false);

    const hard = finalizeStructuredVisionResult(
      validateStructuredAssetVisionResult(
        personPayload("분노", { reject: true, reason: "유두 노출" })
      )!
    );
    assert.equal(hard.moderationReject, true);
    assert.equal(hard.adultFlagged, true);
  });

  it("never puts moderation reason into asset tag", () => {
    const result = finalizeStructuredVisionResult(
      validateStructuredAssetVisionResult(
        personPayload("미소", { adult: true, reason: "젖은 상의" })
      )!
    );
    assert.equal(result.tag, "미소");
    assert.doesNotMatch(result.tag, /젖은|상의/);
  });
});

describe("asset vision prompt contract", () => {
  it("lists canonical person tags once and avoids clothing positive examples", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /PERSON_TAGS:/);
    assert.match(prompt, /무표정/);
    assert.doesNotMatch(prompt, /좋은 예:.*젖은 상의/s);
    assert.doesNotMatch(prompt, /좋은 예:.*검은 옷/s);
    assert.doesNotMatch(prompt, /역광/);
    assert.doesNotMatch(prompt, /고화질/);
    assert.doesNotMatch(prompt, /클로즈업/);
    for (const tag of ASSET_PERSON_TAGS) {
      assert.match(prompt, new RegExp(tag));
    }
  });

  it("explicitly prioritizes relation action and pose over neutral face", () => {
    const prompt = buildAssetVisionPrompt();
    assert.match(prompt, /명확한 관계\/상호작용 행동/);
    assert.match(prompt, /키스\+부끄러움→키스/);
    assert.match(prompt, /밀착\+미소→밀착/);
    assert.match(prompt, /무표정\+누움→누움/);
    assert.match(prompt, /무표정\+앉음→앉음/);
    assert.match(prompt, /무표정\+전투자세→전투자세/);
    assert.match(prompt, /tag 선택이 adult\/reject를 자동으로 정하지 않는다/);
  });

  it("documents short meanings for adult-RP tags without moderation terms", () => {
    const prompt = buildAssetVisionPrompt();
    const tagSection = prompt.split("TASK 3 — MODERATION")[0] ?? prompt;
    assert.match(prompt, /키스 = 입맞춤이 명확히 보임/);
    assert.match(prompt, /밀착 = 두 인물이 몸을 붙이거나/);
    assert.match(prompt, /유혹 = 상대를 끌어들이려는/);
    assert.match(prompt, /도발 = 상대를 자극하거나/);
    assert.match(prompt, /욕망 = 무엇\/누군가를 강하게 원하는/);
    assert.match(prompt, /황홀 = 강한 감각·감정에 빠져/);
    assert.match(prompt, /애정 = 다정함·사랑스러움/);
    assert.match(prompt, /흥분 = 감정\/신체적으로 고조/);
    assert.doesNotMatch(tagSection, /personTag=키스.*adult=true/s);
    assert.doesNotMatch(tagSection, /성관계|신체부위/);
  });
});

describe("asset vision request body contract", () => {
  const dataUrl = "data:image/png;base64,abc";

  it("Qwen3.8 disables reasoning and requires structured-output provider", () => {
    const body = buildAssetVisionRequestBody(OPENROUTER_QWEN38_FLASH_MODEL, dataUrl);
    assert.equal(body.model, OPENROUTER_QWEN38_FLASH_MODEL);
    assert.equal(body.temperature, 0.1);
    assert.deepEqual(body.reasoning, { effort: "none" });
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.equal(
      (body.response_format as { type?: string }).type,
      "json_schema"
    );
  });

  it("Qwen3-VL fallback omits reasoning but keeps structured provider routing", () => {
    const body = buildAssetVisionRequestBody(
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
      dataUrl
    );
    assert.equal(body.model, OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL);
    assert.equal("reasoning" in body, false);
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.equal(
      (body.response_format as { type?: string }).type,
      "json_schema"
    );
  });
});

describe("asset vision model routing", () => {
  it("defaults to Qwen3.8 Flash primary and Qwen3-VL fallback", () => {
    const prevPrimary = process.env.ASSET_VISION_MODEL;
    const prevBackground = process.env.BACKGROUND_VISION_MODEL;
    const prevFallback = process.env.ASSET_VISION_MODEL_FALLBACK;
    delete process.env.ASSET_VISION_MODEL;
    delete process.env.BACKGROUND_VISION_MODEL;
    delete process.env.ASSET_VISION_MODEL_FALLBACK;
    try {
      assert.deepEqual(visionModels(), [
        OPENROUTER_QWEN38_FLASH_MODEL,
        OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
      ]);
    } finally {
      if (prevPrimary === undefined) delete process.env.ASSET_VISION_MODEL;
      else process.env.ASSET_VISION_MODEL = prevPrimary;
      if (prevBackground === undefined) delete process.env.BACKGROUND_VISION_MODEL;
      else process.env.BACKGROUND_VISION_MODEL = prevBackground;
      if (prevFallback === undefined) delete process.env.ASSET_VISION_MODEL_FALLBACK;
      else process.env.ASSET_VISION_MODEL_FALLBACK = prevFallback;
    }
  });

  it("ASSET_VISION_MODEL wins over BACKGROUND_VISION_MODEL for vision.ts and ai export", () => {
    const prevPrimary = process.env.ASSET_VISION_MODEL;
    const prevBackground = process.env.BACKGROUND_VISION_MODEL;
    process.env.ASSET_VISION_MODEL = "model/A";
    process.env.BACKGROUND_VISION_MODEL = "model/B";
    try {
      assert.deepEqual(visionModels(), ["model/A", OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL]);
      assert.equal(resolveAssetVisionPrimaryModel(), "model/A");
    } finally {
      if (prevPrimary === undefined) delete process.env.ASSET_VISION_MODEL;
      else process.env.ASSET_VISION_MODEL = prevPrimary;
      if (prevBackground === undefined) delete process.env.BACKGROUND_VISION_MODEL;
      else process.env.BACKGROUND_VISION_MODEL = prevBackground;
    }
  });
});

describe("parseAssetVisionResponseText", () => {
  it("parses fenced JSON and derives final tag", () => {
    const parsed = parseAssetVisionResponseText(
      '```json\n' + JSON.stringify(personPayload("웃음")) + "\n```"
    );
    assert.ok(parsed);
    assert.equal(deriveFinalAssetTag(parsed!), "웃음");
  });

  it("rejects legacy freeform tag-only JSON", () => {
    const parsed = parseAssetVisionResponseText(
      JSON.stringify({ tag: "검은 옷", adult: false, reject: false, reason: "" })
    );
    assert.equal(parsed, null);
  });
});

describe("asset vision provider routing (mocked)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOpenRouterSequence(
    responses: Array<{ model: string; status: number; body: unknown }>
  ) {
    const openRouterCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openrouter.ai")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        const model = payload.model ?? "";
        openRouterCalls.push(model);
        const next = responses.find((row) => row.model === model);
        if (!next) {
          return new Response("missing mock", { status: 500 });
        }
        return new Response(JSON.stringify(next.body), { status: next.status });
      }
      return new Response(Buffer.from("fake-image"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    return openRouterCalls;
  }

  it("primary success uses fallback 0 times", async () => {
    const calls = mockOpenRouterSequence([
      {
        model: OPENROUTER_QWEN38_FLASH_MODEL,
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify(personPayload("미소")) } }] },
      },
    ]);
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.ASSET_VISION_MODEL;
    delete process.env.ASSET_VISION_MODEL_FALLBACK;
    const { analyzeAssetImage } = await import("./vision");
    const result = await analyzeAssetImage("https://example.com/a.png", 0);
    assert.equal(result.tag, "미소");
    assert.equal(result.estimated, false);
    assert.deepEqual(calls, [OPENROUTER_QWEN38_FLASH_MODEL]);
  });

  it("primary invalid schema triggers one fallback call", async () => {
    const calls = mockOpenRouterSequence([
      {
        model: OPENROUTER_QWEN38_FLASH_MODEL,
        status: 200,
        body: {
          choices: [{ message: { content: JSON.stringify(personPayload("검은 옷")) } }],
        },
      },
      {
        model: OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify(personPayload("부끄러움")) } }] },
      },
    ]);
    process.env.OPENROUTER_API_KEY = "test-key";
    const { analyzeAssetImage } = await import("./vision");
    const result = await analyzeAssetImage("https://example.com/a.png", 0);
    assert.equal(result.tag, "부끄러움");
    assert.deepEqual(calls, [
      OPENROUTER_QWEN38_FLASH_MODEL,
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
    ]);
  });

  it("primary HTTP failure triggers one fallback call", async () => {
    const calls = mockOpenRouterSequence([
      { model: OPENROUTER_QWEN38_FLASH_MODEL, status: 503, body: { error: "busy" } },
      {
        model: OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify(personPayload("긴장")) } }] },
      },
    ]);
    process.env.OPENROUTER_API_KEY = "test-key";
    const { analyzeAssetImage } = await import("./vision");
    const result = await analyzeAssetImage("https://example.com/a.png", 0);
    assert.equal(result.tag, "긴장");
    assert.deepEqual(calls, [
      OPENROUTER_QWEN38_FLASH_MODEL,
      OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
    ]);
  });

  it("both models fail returns unresolved estimated tag", async () => {
    mockOpenRouterSequence([
      { model: OPENROUTER_QWEN38_FLASH_MODEL, status: 503, body: {} },
      { model: OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL, status: 503, body: {} },
    ]);
    process.env.OPENROUTER_API_KEY = "test-key";
    const { analyzeAssetImage } = await import("./vision");
    const result = await analyzeAssetImage("https://example.com/a.png", 2);
    assert.equal(result.tag, "미분류 3");
    assert.equal(result.estimated, true);
  });
});
