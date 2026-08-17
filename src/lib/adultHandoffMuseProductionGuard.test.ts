import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const PRODUCTION_FILES = [
  "src/lib/adultHandoffSourceRouting.ts",
  "src/lib/adultHandoffPricing.ts",
  "src/lib/cheaperInferenceConfig.ts",
  "src/lib/chatModels.ts",
  "src/services/contextBuilder.ts",
  "src/app/api/chat/route.ts",
] as const;

const FORBIDDEN_PRODUCTION_PHRASES = [
  "미세한 환경음과 거리감",
  "얇은 농담",
  "능글맞음",
  "어색하게 비치는 진심",
  "장난스러운 반응",
  "[MUSE SOURCE STYLE MIRROR V2]",
  "[MUSE SOURCE STYLE CONTINUITY — OPUS 5]",
  "[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]",
] as const;

describe("production Muse resolver excludes audit-only V1/V2 text", () => {
  it("has zero Like-specific V1 and V2 occurrences in production files", () => {
    for (const rel of PRODUCTION_FILES) {
      const text = readFileSync(resolve(process.cwd(), rel), "utf8");
      for (const phrase of FORBIDDEN_PRODUCTION_PHRASES) {
        assert.equal(
          text.includes(phrase),
          false,
          `${rel} must not contain ${phrase}`
        );
      }
    }
  });
});
