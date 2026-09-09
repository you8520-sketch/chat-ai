import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveChatImageGenerationPrice,
} from "./chatImageGeneration";

describe("chatImageGeneration", () => {
  it("uses the fixed 180P price even when a stale env override exists", () => {
    assert.equal(resolveChatImageGenerationPrice({} as NodeJS.ProcessEnv), 180);
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "399.1" } as NodeJS.ProcessEnv),
      180
    );
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "nope" } as NodeJS.ProcessEnv),
      180
    );
  });
});
