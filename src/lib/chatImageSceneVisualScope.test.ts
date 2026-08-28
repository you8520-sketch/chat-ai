import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptySceneVisualScopeState } from "@/lib/chatImageSceneVisualScope";

describe("chatImageSceneVisualScope", () => {
  it("clears visual scope on new source epoch", () => {
    const prior = {
      visualSubjects: [{ subjectKey: "vis_test", name: "A", representativeAssetUrl: "/a.webp" }],
      castSelectableAssets: [{ url: "/a.webp", tag: "a", visualSubjectKey: "vis_test" }],
    };
    assert.equal(prior.visualSubjects.length, 1);
    assert.equal(prior.castSelectableAssets.length, 1);
    const reset = emptySceneVisualScopeState();
    assert.deepEqual(reset, { visualSubjects: [], castSelectableAssets: [] });
  });
});
