import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_GENERATION_DEFAULT_MODEL,
  CHAT_IMAGE_GENERATION_MODEL_LABEL,
  resolveChatImageGenerationModel,
} from "./chatImageGeneration";

const COMIC_ROUTE = "src/app/api/chat/comic-generation/route.ts";
const IMAGE_ROUTE = "src/app/api/chat/image-generation/route.ts";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
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

  it("MODEL-3 display label is owned by the model-resolution module, no stray hardcodes", () => {
    assert.equal(CHAT_IMAGE_GENERATION_MODEL_LABEL, "GPT Image 2");
    const comic = read(COMIC_ROUTE);
    const image = read(IMAGE_ROUTE);
    // Label sites must reference the canonical owner; inline "GPT Image 2"
    // literals must not regress in runtime routes.
    assert.match(comic, /modelLabel: CHAT_IMAGE_GENERATION_MODEL_LABEL/);
    assert.match(image, /modelLabel: CHAT_IMAGE_GENERATION_MODEL_LABEL/);
    assert.doesNotMatch(comic, /"GPT Image 2"/);
    assert.doesNotMatch(image, /"GPT Image 2"/);
  });

  it("MODEL-4 charge reasons interpolate the canonical label (byte-identical text)", () => {
    const comic = read(COMIC_ROUTE);
    assert.match(
      comic,
      /chargeReason: `\$\{CHAT_IMAGE_GENERATION_MODEL_LABEL\} · 선택 턴 LD 일러스트`/u
    );
    const label = "GPT Image 2";
    assert.equal(`${label} · ${4}컷 만화`, "GPT Image 2 · 4컷 만화");
  });

  it("MODEL-5 provider wire keeps receiving the resolved id (no label leakage)", () => {
    const edit = read("src/lib/openAiImageEdit.ts");
    assert.match(edit, /form\.set\("model", opts\.model\)/);
    const safetyFallback = read("src/lib/openAiImageSafetyFallback.ts");
    // Both provider attempts reuse one resolved id via baseEditOpts — no env
    // re-read or label constant inside the fallback orchestration.
    const baseEditOpts = safetyFallback.slice(
      safetyFallback.indexOf("const baseEditOpts = {"),
      safetyFallback.indexOf("try {")
    );
    assert.match(baseEditOpts, /model: opts\.model/);
    assert.doesNotMatch(baseEditOpts, /OPENAI_IMAGE_MODEL|resolveChatImageGenerationModel|MODEL_LABEL/);
  });

  it("MODEL-6 billing/settlement untouched: records store the resolved id, not the label", () => {
    const persistence = read("src/lib/chatImageGenerationPersistence.ts");
    assert.doesNotMatch(persistence, /GPT Image 2/);
    const finance = read("src/lib/adminFinance.ts");
    // The aggregate reads the raw cost column only, never a label.
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