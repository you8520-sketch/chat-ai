/**
 * Regression — platform narration few-shot fallback must stay OFF in production (default).
 * Verifies Leon-like empty example_dialog produces pre-rollout prompt shape.
 *
 * Usage: npx tsx scripts/regression-narration-fewshot-fallback.ts
 */
import "./lib/server-only-mock";

import assert from "node:assert/strict";
import { parseCharacterSetting } from "@/utils/characterParser";
import {
  disableNarrationFewShotFallbackForTests,
  enableNarrationFewShotFallbackForTests,
} from "@/lib/narrationFewShotFallbackFeature";
import {
  defaultPlatformNarrationFewShot,
  resolveExampleDialogForPrompt,
} from "@/lib/narrationFewShotTemplates";

const PLATFORM_MARKER = "에스프레소 머신 소음";

const LEON_LIKE = {
  characterId: "18",
  characterName: "레온",
  gender: "male" as const,
  systemPrompt: "# 성격\n냉정하고 규율적이다.\n\n# 말투\n- 평소: 존댓말",
  world: "# 세계관\n현대 도시.",
};

function chunksText(exampleDialog: string): string {
  return parseCharacterSetting({ ...LEON_LIKE, exampleDialog })
    .map((c) => c.content)
    .join("\n");
}

disableNarrationFewShotFallbackForTests();

assert.equal(resolveExampleDialogForPrompt("", "레온"), "", "empty dialog → empty (flag OFF)");
assert.equal(
  resolveExampleDialogForPrompt("유저: hi\n레온: …", "레온"),
  "유저: hi\n레온: …",
  "creator dialog preserved"
);

const viaResolver = chunksText(resolveExampleDialogForPrompt("", LEON_LIKE.characterName));
const directEmpty = chunksText("");
assert.equal(viaResolver, directEmpty, "Leon-like chunks match pre-rollout empty parse");
assert.doesNotMatch(viaResolver, /\[예시\s*대화\]/, "no [예시 대화] section");
assert.doesNotMatch(viaResolver, new RegExp(PLATFORM_MARKER), "no platform few-shot body");

enableNarrationFewShotFallbackForTests();
const withFallback = resolveExampleDialogForPrompt("", "레온");
assert.equal(withFallback, defaultPlatformNarrationFewShot("레온"), "flag ON injects template");
assert.match(withFallback, new RegExp(PLATFORM_MARKER), "flag ON has space/sound anchors");
disableNarrationFewShotFallbackForTests();

console.log("regression-narration-fewshot-fallback: PASS (production default OFF, opt-in ON verified)");
