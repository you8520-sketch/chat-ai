import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERSONA_CONTENT_MAX,
  capPersonaFieldToSharedBudget,
  personaCombinedContentLength,
  validatePersonaCombinedContentLength,
} from "@/lib/persona";

describe("persona shared content budget", () => {
  it("counts public and secret toward one 1200 limit", () => {
    const publicPart = "가".repeat(800);
    const secretPart = "나".repeat(400);
    assert.equal(personaCombinedContentLength(publicPart, secretPart), 1200);
    assert.equal(validatePersonaCombinedContentLength(publicPart, secretPart).ok, true);
    assert.equal(
      validatePersonaCombinedContentLength(publicPart, secretPart + "다").ok,
      false
    );
  });

  it("caps the next field so the shared budget is not exceeded", () => {
    const other = "a".repeat(1000);
    const next = capPersonaFieldToSharedBudget(other, "b".repeat(300));
    assert.equal(next.length, PERSONA_CONTENT_MAX - 1000);
    assert.equal(personaCombinedContentLength(other, next), PERSONA_CONTENT_MAX);
  });
});
