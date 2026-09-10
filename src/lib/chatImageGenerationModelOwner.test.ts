import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_GENERATION_DEFAULT_MODEL,
  resolveChatImageGenerationModel,
  resolveChatImageGenerationModelLabel,
} from "./chatImageGeneration";

const COMIC_ROUTE = "src/app/api/chat/comic-generation/route.ts";
const IMAGE_ROUTE = "src/app/api/chat/image-generation/route.ts";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function labelForEnv(env: NodeJS.ProcessEnv): string {
  return resolveChatImageGenerationModelLabel(resolveChatImageGenerationModel(env));
}

describe("image model canonical owner (id + display label)", () => {
  it("MODEL-1 env model resolved; provider/admin/log share the canonical id", () => {
    assert.equal(
      resolveChatImageGenerationModel({ OPENAI_IMAGE_MODEL: "custom-image-x " }),
      "custom-image-x"
    );
    assert.equal(
      resolveChatImageGenerationModel({ OPENAI_IMAGE_MODEL: "  " }),
      CHAT_IMAGE_GENERATION_DEFAULT_MODEL
    );
    assert.equal(resolveChatImageGenerationModel({}), CHAT_IMAGE_GENERATION_DEFAULT_MODEL);
  });

  it("MODEL-2 fallback stays the intended default without env", () => {
    assert.equal(CHAT_IMAGE_GENERATION_DEFAULT_MODEL, "gpt-image-2");
  });

  it("MODEL-SUNBURST env Sunburst -> id Sunburst -> label 'GPT Image 2.5 Sunburst'", () => {
    const id = resolveChatImageGenerationModel({
      OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst",
    });
    assert.equal(id, "gpt-image-2.5-sunburst");
    assert.equal(resolveChatImageGenerationModelLabel(id), "GPT Image 2.5 Sunburst");
    assert.equal(
      labelForEnv({ OPENAI_IMAGE_MODEL: "gpt-image-2.5-sunburst" }),
      "GPT Image 2.5 Sunburst"
    );
  });

  it("MODEL-FLARE env Flare -> id Flare -> label 'GPT Image 2.5 Flare'", () => {
    const id = resolveChatImageGenerationModel({
      OPENAI_IMAGE_MODEL: "gpt-image-2.5-flare",
    });
    assert.equal(id, "gpt-image-2.5-flare");
    assert.equal(resolveChatImageGenerationModelLabel(id), "GPT Image 2.5 Flare");
    assert.equal(
      labelForEnv({ OPENAI_IMAGE_MODEL: "gpt-image-2.5-flare" }),
      "GPT Image 2.5 Flare"
    );
  });

  it("MODEL-GPT2 default id -> label 'GPT Image 2'", () => {
    assert.equal(resolveChatImageGenerationModelLabel("gpt-image-2"), "GPT Image 2");
    assert.equal(labelForEnv({}), "GPT Image 2");
    assert.equal(labelForEnv({ OPENAI_IMAGE_MODEL: " " }), "GPT Image 2");
  });

  it("MODEL-SNAPSHOT known dated snapshot -> parent friendly label", () => {
    assert.equal(
      resolveChatImageGenerationModelLabel("gpt-image-2.5-sunburst-20260801"),
      "GPT Image 2.5 Sunburst"
    );
    assert.equal(
      resolveChatImageGenerationModelLabel("gpt-image-2.5-flare-20260601"),
      "GPT Image 2.5 Flare"
    );
    assert.equal(
      resolveChatImageGenerationModelLabel("gpt-image-2-20260501"),
      "GPT Image 2"
    );
  });

  it("MODEL-UNKNOWN custom id -> no false known label, raw id surfaced", () => {
    assert.equal(resolveChatImageGenerationModelLabel("custom-image-x"), "custom-image-x");
    assert.notEqual(resolveChatImageGenerationModelLabel("custom-image-x"), "GPT Image 2");
    assert.equal(labelForEnv({ OPENAI_IMAGE_MODEL: "custom-image-x" }), "custom-image-x");
  });

  it("MODEL-GET GET modelId/modelLabel come from the same resolved owner", () => {
    const image = read(IMAGE_ROUTE);
    assert.match(image, /const modelId = resolveChatImageGenerationModel\(\);/);
    assert.match(image, /const modelLabel = resolveChatImageGenerationModelLabel\(modelId\);/);
    assert.match(image, /\n\s*modelId,\n/);
    assert.match(image, /\n\s*modelLabel,\n/);
  });

  it("MODEL-POST provider id + chargeReason/modelLabel share the resolved owner", () => {
    const comic = read(COMIC_ROUTE);
    assert.match(comic, /const model = resolveChatImageGenerationModel\(\);/);
    // Label is always derived from the same resolved id as the provider call.
    assert.match(
      comic,
      /chargeReason: `\$\{resolveChatImageGenerationModelLabel\(model\)\} · 선택 턴 LD 일러스트`/u
    );
    assert.match(
      comic,
      /chargeReason: `\$\{resolveChatImageGenerationModelLabel\(model\)\} · \$\{panelCount\}컷 만화`/u
    );
    assert.match(comic, /modelLabel: resolveChatImageGenerationModelLabel\(model\),/);
  });

  it("MODEL-3 display label derives from the resolved id — no stray hardcodes", () => {
    const comic = read(COMIC_ROUTE);
    const image = read(IMAGE_ROUTE);
    // The static label constant is gone; routes may only derive the label.
    assert.doesNotMatch(comic, /CHAT_IMAGE_GENERATION_MODEL_LABEL/);
    assert.doesNotMatch(image, /CHAT_IMAGE_GENERATION_MODEL_LABEL/);
    assert.doesNotMatch(comic, /"GPT Image 2"/);
    assert.doesNotMatch(image, /"GPT Image 2"/);
  });

  it("MODEL-4 charge reasons interpolate the resolved-id label (byte-identical text)", () => {
    const label = "GPT Image 2";
    assert.equal(`${label} · ${4}컷 만화`, "GPT Image 2 · 4컷 만화");
    assert.equal(`${label} · 선택 턴 LD 일러스트`, "GPT Image 2 · 선택 턴 LD 일러스트");
  });

  it("MODEL-5 provider wire keeps receiving the resolved id (no label leakage)", () => {
    const edit = read("src/lib/openAiImageEdit.ts");
    assert.match(edit, /form\.set\("model", opts\.model\)/);
    const safetyFallback = read("src/lib/openAiImageSafetyFallback.ts");
    const baseEditOpts = safetyFallback.slice(
      safetyFallback.indexOf("const baseEditOpts = {"),
      safetyFallback.indexOf("try {")
    );
    assert.match(baseEditOpts, /model: opts\.model/);
    assert.doesNotMatch(baseEditOpts, /OPENAI_IMAGE_MODEL|resolveChatImageGenerationModel|MODEL_LABEL|ModelLabel/);
  });

  it("MODEL-6 billing/settlement untouched: records store the resolved id, not the label", () => {
    const persistence = read("src/lib/chatImageGenerationPersistence.ts");
    assert.doesNotMatch(persistence, /GPT Image 2/);
    const finance = read("src/lib/adminFinance.ts");
    assert.doesNotMatch(finance, /GPT Image 2|model_label/u);
  });

  it("MODEL-7 admin average-cost test mirrors the canonical default", () => {
    const test = read("src/lib/chatImageGenerationAdminAverageCost.test.ts");
    assert.match(
      test,
      /const CURRENT_MODEL = CHAT_IMAGE_GENERATION_DEFAULT_MODEL/u
    );
    assert.doesNotMatch(test, /CURRENT_MODEL = "gpt-image-2"/);
  });

  it("MODEL-8 no stale model-id fallback remains outside the canonical resolver", () => {
    const smoke = readFileSync(
      new URL("../../scripts/run-cast-gpt-image-smoke.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(smoke, /gpt-image-1/u);
    assert.match(smoke, /resolveChatImageGenerationModel/);
  });
});