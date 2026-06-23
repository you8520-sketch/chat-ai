import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoBoldFieldLabels, normalizeBiographyStructure } from "@/lib/profileMarkdown";

describe("profile field labels", () => {
  it("auto-bolds same-line label:value", () => {
    const out = autoBoldFieldLabels("이름: 백하율\n성격: 차분함");
    assert.match(out, /\*\*이름:\*\* 백하율/);
    assert.match(out, /\*\*성격:\*\* 차분함/);
  });

  it("pairs label line with following value line", () => {
    const out = normalizeBiographyStructure("이름:\n백하율\n성격:\n차분함");
    assert.match(out, /\*\*이름:\*\* 백하율/);
    assert.match(out, /\*\*성격:\*\* 차분함/);
  });

  it("auto-bolds label-only lines", () => {
    const out = autoBoldFieldLabels("나이:");
    assert.equal(out, "**나이:**");
  });
});
