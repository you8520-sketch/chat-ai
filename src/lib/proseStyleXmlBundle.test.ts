import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";

import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";

describe("buildProseStyleXmlBundle", () => {
  it("aliases merged advanced prose guidelines (no duplicate blocks)", () => {
    const opts = { nsfwEnabled: true, literaryEnhanced: true };

    const bundle = buildProseStyleXmlBundle(opts);
    const advanced = buildAdvancedProseNsfwGuidelines(opts);

    assert.equal(bundle, advanced);
    assert.doesNotMatch(bundle, /<PROSE_STYLE_POLICY>/);
    assert.doesNotMatch(bundle, /<ADVANCED_PROSE_NSFW>/);
    assert.doesNotMatch(bundle, /<KOREAN_WEBNOVEL_STYLE>/);
    assert.match(bundle, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.match(bundle, /\[KOREAN WEBNOVEL STYLE\]/);
    assert.doesNotMatch(bundle, /\[SHOW OVER TELL\]/);
    assert.doesNotMatch(bundle, /<STYLE_REFERENCE>/);
    assert.doesNotMatch(bundle, /SCENE_PROGRESSION_&_NARRATION_PARAGRAPH_FLOOR/);
    assert.doesNotMatch(bundle, /\[ANTI-RESOLUTION RULE\]/);
    assert.doesNotMatch(bundle, /FORBIDDEN early stop/);
  });

  it("SFW bundle includes Korean webnovel style once", () => {
    const bundle = buildProseStyleXmlBundle({ nsfwEnabled: false });

    assert.doesNotMatch(bundle, /=== 19\+ 플랫폼 컨텍스트 ===/);
    assert.match(bundle, /\[KOREAN WEBNOVEL STYLE\]/);
    assert.doesNotMatch(bundle, /\[SHOW OVER TELL\]/);
    assert.doesNotMatch(bundle, /<STYLE_REFERENCE>/);
  });
});
