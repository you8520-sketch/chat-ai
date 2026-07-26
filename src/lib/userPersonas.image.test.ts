import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  personaImageObjectPosition,
  sanitizePersonaImageFocus,
  sanitizePersonaImageUrl,
} from "@/lib/userPersonas";

describe("persona representative image helpers", () => {
  it("accepts only /uploads/ relative filenames", () => {
    assert.equal(sanitizePersonaImageUrl("/uploads/abc-123.webp"), "/uploads/abc-123.webp");
    assert.equal(sanitizePersonaImageUrl("/uploads/abc.png"), "/uploads/abc.png");
    assert.equal(sanitizePersonaImageUrl(""), "");
    assert.equal(sanitizePersonaImageUrl("https://evil.example/x.png"), "");
    assert.equal(sanitizePersonaImageUrl("/api/upload/x.png"), "");
    assert.equal(sanitizePersonaImageUrl("/uploads/../secret.png"), "");
  });

  it("clamps focus to [0, 1] with defaults", () => {
    assert.equal(sanitizePersonaImageFocus(0.2, 0.5), 0.2);
    assert.equal(sanitizePersonaImageFocus(-1, 0.5), 0);
    assert.equal(sanitizePersonaImageFocus(2, 0.5), 1);
    assert.equal(sanitizePersonaImageFocus("nope", 0.28), 0.28);
    assert.equal(PERSONA_IMAGE_FOCUS_DEFAULT.x, 0.5);
  });

  it("formats CSS object-position from focus", () => {
    assert.equal(personaImageObjectPosition(0.5, 0.28), "50.00% 28.00%");
    assert.equal(personaImageObjectPosition(0, 1), "0.00% 100.00%");
  });
});
