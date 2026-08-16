import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { hasPromptTranslationTransport } from "@/lib/promptTranslation";

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/promptTranslation.ts"),
  "utf8"
);
const CHAT_ROUTE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("English layer backfill gate + admin metadata", () => {
  it("schedules backfill when the default CI translation chain has a CI key", () => {
    assert.match(SOURCE, /hasPromptTranslationTransport/);
    assert.match(SOURCE, /CHEAPER_INFERENCE_API_KEY/);
    assert.match(SOURCE, /OPENROUTER_API_KEY/);
    assert.equal(
      hasPromptTranslationTransport({
        CHEAPER_INFERENCE_API_KEY: "x",
      } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      hasPromptTranslationTransport({
        OPENROUTER_API_KEY: "or",
      } as NodeJS.ProcessEnv),
      false
    );
  });

  it("stores usedEnglishCharacterPrompt on admin usage only", () => {
    assert.match(CHAT_ROUTE, /usedEnglishCharacterPrompt,/);
    assert.match(CHAT_ROUTE, /characterPromptLanguage:/);
  });
});
