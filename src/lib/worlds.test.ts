import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { squareCropRect } from "./worldCoverCrop";
import { parseWorldStudioKind, sanitizeWorldCoverUrl } from "./worlds";

describe("world cover helpers", () => {
  it("accepts only /uploads/ filenames", () => {
    assert.equal(sanitizeWorldCoverUrl("/uploads/abc-123.webp"), "/uploads/abc-123.webp");
    assert.equal(sanitizeWorldCoverUrl(""), "");
    assert.equal(sanitizeWorldCoverUrl("https://evil.example/x.png"), "");
    assert.equal(sanitizeWorldCoverUrl("/uploads/../secret.png"), "");
  });

  it("center-crops landscape and portrait to a square", () => {
    assert.deepEqual(squareCropRect(1200, 800), { sx: 200, sy: 0, size: 800 });
    assert.deepEqual(squareCropRect(600, 1000), { sx: 0, sy: 200, size: 600 });
    assert.deepEqual(squareCropRect(512, 512), { sx: 0, sy: 0, size: 512 });
  });

  it("parses the world/scenario studio tab", () => {
    assert.equal(parseWorldStudioKind("scenario"), "scenario");
    assert.equal(parseWorldStudioKind("trpg"), "scenario");
    assert.equal(parseWorldStudioKind("world"), "world");
    assert.equal(parseWorldStudioKind(null), "world");
  });
});
