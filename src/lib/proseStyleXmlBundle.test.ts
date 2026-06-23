import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";

import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";

import { KOREAN_WEBNOVEL_STYLE } from "@/lib/writingStylePreset";



describe("buildProseStyleXmlBundle", () => {

  it("wraps prose/style blocks without duplicate scene stop policy", () => {

    const opts = { nsfwEnabled: true, literaryEnhanced: true };

    const bundle = buildProseStyleXmlBundle(opts);

    const advanced = buildAdvancedProseNsfwGuidelines(opts);



    assert.match(bundle, /<PROSE_STYLE_POLICY>/);

    assert.match(bundle, /<\/PROSE_STYLE_POLICY>/);

    assert.match(bundle, /<ADVANCED_PROSE_NSFW>/);

    assert.match(bundle, /<KOREAN_WEBNOVEL_STYLE>/);



    assert.ok(bundle.includes(advanced));

    assert.ok(bundle.includes(KOREAN_WEBNOVEL_STYLE));
    assert.doesNotMatch(bundle, /\[SHOW OVER TELL\]/);

    assert.doesNotMatch(bundle, /<STYLE_REFERENCE>/);

    assert.doesNotMatch(bundle, /SCENE_PROGRESSION_&_NARRATION_PARAGRAPH_FLOOR/);

    assert.doesNotMatch(bundle, /\[ANTI-RESOLUTION RULE\]/);

    assert.doesNotMatch(bundle, /FORBIDDEN early stop/);

  });



  it("SFW bundle omits NSFW-only advanced prose blocks", () => {

    const bundle = buildProseStyleXmlBundle({ nsfwEnabled: false });

    assert.doesNotMatch(bundle, /=== 19\+ 플랫폼 컨텍스트 ===/);

    assert.ok(bundle.includes(KOREAN_WEBNOVEL_STYLE));
    assert.doesNotMatch(bundle, /\[SHOW OVER TELL\]/);

    assert.doesNotMatch(bundle, /<STYLE_REFERENCE>/);

  });

});

