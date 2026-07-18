import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";

import {
  LEGACY_GENRE_TONE_HINTS,
  STEP43_GENRE_TONE_HINTS,
  resolveGenreToneHints,
} from "@/lib/registerPatchExperiment";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

describe("registerPatchExperiment", () => {
  const prev = process.env.REGISTER_PATCH;

  afterEach(() => {
    if (prev === undefined) delete process.env.REGISTER_PATCH;
    else process.env.REGISTER_PATCH = prev;
  });

  it("production default uses atmosphere-only genre hints (Patch A)", () => {
    delete process.env.REGISTER_PATCH;
    const hints = resolveGenreToneHints();
    assert.equal(hints["판타지"], STEP43_GENRE_TONE_HINTS["판타지"]);
    const layer = buildNarrativeStyleLayer({ genres: ["판타지"] });
    assert.doesNotMatch(layer, /대사 register/);
  });

  it("REGISTER_PATCH=none uses legacy register hints for audit baseline", () => {
    process.env.REGISTER_PATCH = "none";
    const hints = resolveGenreToneHints();
    assert.equal(hints["판타지"], LEGACY_GENRE_TONE_HINTS["판타지"]);
    const layer = buildNarrativeStyleLayer({ genres: ["판타지"] });
    assert.match(layer, /대사 register|존댓말/);
  });
});
