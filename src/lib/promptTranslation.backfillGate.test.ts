import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { hasPromptTranslationTransport } from "./promptTranslation";

const SOURCE = readFileSync(new URL("./promptTranslation.ts", import.meta.url), "utf8");

describe("hasPromptTranslationTransport", () => {
  it("accepts Cheaper Inference even when OpenRouter is unset", () => {
    assert.equal(
      hasPromptTranslationTransport({
        CHEAPER_INFERENCE_API_KEY: "ci-key",
      }),
      true
    );
  });

  it("accepts OpenRouter when Cheaper Inference is unset", () => {
    assert.equal(
      hasPromptTranslationTransport({
        OPENROUTER_API_KEY: "or-key",
      }),
      true
    );
  });

  it("rejects an empty env", () => {
    assert.equal(hasPromptTranslationTransport({}), false);
  });
});

describe("scheduleEnglishBackfill gate", () => {
  it("uses the shared transport helper instead of OpenRouter-only", () => {
    assert.match(SOURCE, /if \(!hasPromptTranslationTransport\(\)\) return;/);
    assert.doesNotMatch(
      SOURCE,
      /scheduleEnglishBackfill[\s\S]*if \(!process\.env\.OPENROUTER_API_KEY\?\.trim\(\)\) return;/
    );
  });
});
