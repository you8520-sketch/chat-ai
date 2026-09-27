import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inferSalienceWithReason,
  shouldPromoteCharacterIdentitySectionChunk,
} from "@/lib/canonPlan/canonSalience";

describe("identity section chunk-level promotion", () => {
  it("promotes short identity facts under [정체성]", () => {
    assert.equal(
      shouldPromoteCharacterIdentitySectionChunk("성별: 남성"),
      true
    );
    const d = inferSalienceWithReason({
      text: "성별: 남성",
      bucket: "character",
      sectionTitle: "[정체성]",
    });
    assert.equal(d.salience, "core");
    assert.equal(d.reason, "IDENTITY_SECTION");
  });

  it("keeps example-dialogue sections dormant even under speech-like titles", () => {
    const d = inferSalienceWithReason({
      text: "“왜 그렇게 딱딱하게 굴어~ 무섭게.”",
      bucket: "character",
      sectionTitle: "[예시 대사]",
    });
    assert.equal(d.salience, "dormant");
  });

  it("keeps markdown encyclopedia subsections dormant under identity titles", () => {
    const text = "#Faction\n- trait one\n- trait two\n- trait three";
    assert.equal(shouldPromoteCharacterIdentitySectionChunk(text), false);
    const d = inferSalienceWithReason({
      text,
      bucket: "character",
      sectionTitle: "[정체성]",
    });
    assert.equal(d.salience, "dormant");
  });
});
