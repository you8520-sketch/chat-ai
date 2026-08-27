import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveNovelTextRenderStructure } from "@/components/NovelText";
import { resolveTrpgTaggedNovelInlineFlowFromParts } from "@/app/trpg/TrpgTaggedNovelText";
import type { TrpgInlineProsePart } from "@/lib/trpg/trpgTaggedProse";

function part(kind: TrpgInlineProsePart["kind"]): TrpgInlineProsePart {
  switch (kind) {
    case "text":
      return { kind: "text", text: "본문" };
    case "scenario":
      return { kind: "scenario", tag: "폐역", asset: { url: "/a.png", tag: "폐역" } as never };
    case "character":
      return {
        kind: "character",
        participantId: 1,
        tag: "분노",
        asset: { url: "/b.png", tag: "분노" } as never,
      };
  }
}

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

  it("tagged inline adjacency uses first rendered part kind from split parts", () => {
    const cases: Array<{
      name: string;
      parts: TrpgInlineProsePart[];
      inlineFirstParagraph: boolean;
      expected: "fragment" | "block-wrapper";
    }> = [
      { name: "text only", parts: [part("text")], inlineFirstParagraph: true, expected: "fragment" },
      {
        name: "text then asset",
        parts: [part("text"), part("scenario")],
        inlineFirstParagraph: true,
        expected: "fragment",
      },
      {
        name: "asset then text",
        parts: [part("scenario"), part("text")],
        inlineFirstParagraph: true,
        expected: "block-wrapper",
      },
      {
        name: "character then text",
        parts: [part("character"), part("text")],
        inlineFirstParagraph: true,
        expected: "block-wrapper",
      },
      {
        name: "multiple assets before text",
        parts: [part("scenario"), part("character"), part("text")],
        inlineFirstParagraph: true,
        expected: "block-wrapper",
      },
      {
        name: "text first but inline disabled",
        parts: [part("text")],
        inlineFirstParagraph: false,
        expected: "block-wrapper",
      },
    ];

    for (const { name, parts, inlineFirstParagraph, expected } of cases) {
      assert.equal(
        resolveTrpgTaggedNovelInlineFlowFromParts(parts, inlineFirstParagraph),
        expected,
        name
      );
    }
  });
});

// Full react-dom/server markup is unavailable under --conditions=react-server in this repo.
// resolveTrpgTaggedNovelInlineFlowFromParts mirrors TrpgTaggedNovelText after splitTrpgGmProseForAssets.
