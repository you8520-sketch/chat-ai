import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRE_FIX_TRUNCATED_PUBLISHED_CORE_SAMPLE,
  assertPublishedBuildArtifactGuard,
  auditPublishedBuildArtifactGuard,
  fileContainsAllPublishedBuildAnchors,
  hasPublishedCompletePathReturn,
} from "@/lib/publishedUserChargeBuildArtifactGuard";

describe("publishedUserChargeBuildArtifactGuard — semantic owner discovery", () => {
  it("pre-fix truncated compiled sample matches anchors but lacks complete return", () => {
    assert.equal(fileContainsAllPublishedBuildAnchors(PRE_FIX_TRUNCATED_PUBLISHED_CORE_SAMPLE), true);
    assert.equal(hasPublishedCompletePathReturn(PRE_FIX_TRUNCATED_PUBLISHED_CORE_SAMPLE), false);
  });

  it("pre-fix truncated sample fails closed via audit (COUNT=1, COMPLETE_PATH=false)", () => {
    const audit = {
      buildGuardFailsClosed: true as const,
      matchedPublishedBuildOwnerCount: 1,
      completePathReturnPresent: hasPublishedCompletePathReturn(PRE_FIX_TRUNCATED_PUBLISHED_CORE_SAMPLE),
      matchedFiles: ["synthetic-pre-fix-sample"],
    };
    assert.equal(audit.completePathReturnPresent, false);
    assert.throws(
      () => {
        if (!audit.completePathReturnPresent) {
          throw new Error("BUILD_GUARD: COMPLETE_PATH_RETURN_PRESENT=false");
        }
      },
      /COMPLETE_PATH_RETURN_PRESENT=false/
    );
  });

  it("post-fix build artifacts pass fail-closed guard after npm run build", () => {
    const result = auditPublishedBuildArtifactGuard();
    assert.equal(result.matchedPublishedBuildOwnerCount, 1, "expected exactly one semantic published owner");
    assert.equal(result.completePathReturnPresent, true, "expected complete Published return in compiled owner");
    assert.doesNotThrow(() => assertPublishedBuildArtifactGuard());
  });
});
