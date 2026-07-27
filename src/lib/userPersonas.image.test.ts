import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  personaImageObjectPosition,
  sanitizePersonaImageFocus,
  sanitizePersonaImageUrl,
} from "@/lib/userPersonas";
import {
  PERSONA_IMAGE_SCALE_DEFAULT,
  PERSONA_IMAGE_SCALE_MAX,
  personaImageBaseUrl,
  personaImageRenderStyle,
  personaImageScale,
  sanitizePersonaImageScale,
  withPersonaImageScale,
} from "@/lib/userPersonasClient";

describe("persona representative image helpers", () => {
  it("accepts only /uploads/ relative filenames and a safe display-only zoom fragment", () => {
    assert.equal(sanitizePersonaImageUrl("/uploads/abc-123.webp"), "/uploads/abc-123.webp");
    assert.equal(
      sanitizePersonaImageUrl("/uploads/abc.png#zoom=2.375"),
      "/uploads/abc.png#zoom=2.38"
    );
    assert.equal(sanitizePersonaImageUrl(""), "");
    assert.equal(sanitizePersonaImageUrl("https://evil.example/x.png"), "");
    assert.equal(sanitizePersonaImageUrl("/api/upload/x.png"), "");
    assert.equal(sanitizePersonaImageUrl("/uploads/../secret.png"), "");
    assert.equal(sanitizePersonaImageUrl("/uploads/a.png#other=2"), "");
  });

  it("clamps focus to [0, 1] with defaults", () => {
    assert.equal(sanitizePersonaImageFocus(0.2, 0.5), 0.2);
    assert.equal(sanitizePersonaImageFocus(-1, 0.5), 0);
    assert.equal(sanitizePersonaImageFocus(2, 0.5), 1);
    assert.equal(sanitizePersonaImageFocus("nope", 0.28), 0.28);
    assert.equal(PERSONA_IMAGE_FOCUS_DEFAULT.x, 0.5);
  });

  it("stores zoom without changing the uploaded file URL", () => {
    const imageUrl = withPersonaImageScale(
      "/uploads/portrait.webp",
      PERSONA_IMAGE_SCALE_DEFAULT
    );
    assert.equal(imageUrl, "/uploads/portrait.webp#zoom=1.25");
    assert.equal(personaImageBaseUrl(imageUrl), "/uploads/portrait.webp");
    assert.equal(personaImageScale(imageUrl), 1.25);
    assert.equal(personaImageScale("/uploads/portrait.webp"), 1);
    assert.equal(withPersonaImageScale(imageUrl, 1), "/uploads/portrait.webp");
    assert.equal(sanitizePersonaImageScale(99), PERSONA_IMAGE_SCALE_MAX);
  });

  it("formats CSS object-position and zoom from display metadata", () => {
    assert.equal(personaImageObjectPosition(0.5, 0.28), "50.00% 28.00%");
    assert.equal(personaImageObjectPosition(0, 1), "0.00% 100.00%");
    assert.deepEqual(
      personaImageRenderStyle("/uploads/a.webp#zoom=2.00", 0.5, 0.28),
      {
        objectPosition: "50.00% 28.00%",
        transform: "scale(2)",
        transformOrigin: "50.00% 28.00%",
      }
    );
  });
});
