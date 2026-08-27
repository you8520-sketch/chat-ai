import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveNovelTextRenderStructure,
} from "@/components/NovelText";
import { resolveTrpgTaggedNovelInlineFlow } from "@/app/trpg/TrpgTaggedNovelText";

describe("GM prose render structure — inline-first DOM contract", () => {
  it("plain inline-first uses span root for first paragraph (no blocking div)", () => {
    const single = resolveNovelTextRenderStructure({
      inlineFirstParagraph: true,
      paragraphCount: 1,
    });
    assert.deepEqual(single, { layout: "inline-first", restParagraphCount: 0 });

    const multi = resolveNovelTextRenderStructure({
      inlineFirstParagraph: true,
      paragraphCount: 3,
    });
    assert.deepEqual(multi, { layout: "inline-first", restParagraphCount: 2 });
  });

  it("default NovelText callers remain block layout", () => {
    assert.deepEqual(
      resolveNovelTextRenderStructure({ inlineFirstParagraph: false, paragraphCount: 2 }),
      { layout: "block" }
    );
  });

  it("tagged text-first path avoids block wrapper between GM label and prose", () => {
    assert.equal(
      resolveTrpgTaggedNovelInlineFlow({
        inlineFirstParagraph: true,
        firstPartKind: "text",
      }),
      "fragment"
    );
  });

  it("tagged asset-first path does not fake inline adjacency", () => {
    assert.equal(
      resolveTrpgTaggedNovelInlineFlow({
        inlineFirstParagraph: true,
        firstPartKind: "scenario",
      }),
      "block-wrapper"
    );
    assert.equal(
      resolveTrpgTaggedNovelInlineFlow({
        inlineFirstParagraph: true,
        firstPartKind: "character",
      }),
      "block-wrapper"
    );
  });
});

// Full react-dom/server markup is unavailable under --conditions=react-server in this repo.
// These structure helpers mirror the actual NovelText / TrpgTaggedNovelText render branches.
