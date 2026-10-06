import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  LUCIAN_DRAFT_KEY,
  LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
  resolveCanonicalOfficialDraftKey,
} from "@/lib/officialSupply/officialDraftIdentity";

describe("official semantic draft identity owner", () => {
  it("maps the published predecessor onto the Lucian compile key and leaves unknown keys unchanged", () => {
    assert.equal(resolveCanonicalOfficialDraftKey(LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY), LUCIAN_DRAFT_KEY);
    assert.equal(resolveCanonicalOfficialDraftKey(LUCIAN_DRAFT_KEY), LUCIAN_DRAFT_KEY);
    assert.equal(resolveCanonicalOfficialDraftKey("pilot-rf-01"), "pilot-rf-01");
    assert.equal(resolveCanonicalOfficialDraftKey("pilot-rf-v4-01"), "pilot-rf-v4-01");
    assert.equal(resolveCanonicalOfficialDraftKey(""), "");
  });

  it("is the only predecessor→canonical mapping owner", () => {
    const identity = fs.readFileSync(
      path.join(process.cwd(), "src/lib/officialSupply/officialDraftIdentity.ts"),
      "utf8"
    );
    const display = fs.readFileSync(path.join(process.cwd(), "src/lib/officialDisplayCreatorName.ts"), "utf8");
    const shot = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/shotPlan.ts"), "utf8");
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
    assert.match(identity, /resolveCanonicalOfficialDraftKey/);
    assert.match(identity, /LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY/);
    assert.doesNotMatch(display, /LUCIAN_DRAFT_KEY/);
    assert.doesNotMatch(display, /LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY/);
    assert.doesNotMatch(display, /pilot-rf-v4-03/);
    assert.match(shot, /resolveCanonicalOfficialDraftKey/);
    assert.doesNotMatch(prompt, /resolveCanonicalOfficialDraftKey/);
    assert.doesNotMatch(shot, /replace\s*\(/);
    assert.doesNotMatch(shot, /pilot-rf-v4/);
    assert.doesNotMatch(identity, /replace\s*\(/);
    assert.doesNotMatch(identity, /\/-vN-|\/.*v\\d/);
  });
});
