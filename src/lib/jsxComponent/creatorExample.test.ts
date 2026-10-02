import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileJsxComponentDraft } from "./catalog";
import {
  CREATOR_JSX_EXAMPLE_NAME,
  CREATOR_JSX_EXAMPLE_PROPS,
  CREATOR_JSX_EXAMPLE_SOURCE,
} from "./creatorExample";

describe("creator JSX example", () => {
  it("uses a HAV-neutral example instead of the internal PitWall fixture", () => {
    assert.equal(CREATOR_JSX_EXAMPLE_NAME, "InteractiveCardExample");
    assert.doesNotMatch(CREATOR_JSX_EXAMPLE_SOURCE, /PitWall|PIT WALL|Dante|tyre|tire|fuel/i);
    assert.equal(
      CREATOR_JSX_EXAMPLE_PROPS.some((prop) =>
        /driver|lap|tyre|tire|fuel|compound|trackTemp|airTemp/i.test(prop.name)
      ),
      false
    );

    const compiled = compileJsxComponentDraft({
      name: CREATOR_JSX_EXAMPLE_NAME,
      source: CREATOR_JSX_EXAMPLE_SOURCE,
      props: CREATOR_JSX_EXAMPLE_PROPS,
    });
    assert.equal(compiled.ok, true);
    if (compiled.ok) {
      assert.equal(compiled.record.chatSend, false);
      assert.ok(compiled.record.capabilities.includes("local_state"));
    }
  });
});
