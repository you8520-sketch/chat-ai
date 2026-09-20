import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_ROOT_RUNTIME_PACKAGES,
  REQUIRED_ROOT_RUNTIME_PACKAGES,
} from "./runtimeTreeExpectations.ts";

describe("runtime tree expectations", () => {
  it("requires tsx and forbids playwright/typescript at root after prune", () => {
    assert.ok(REQUIRED_ROOT_RUNTIME_PACKAGES.includes("tsx"));
    assert.ok(FORBIDDEN_ROOT_RUNTIME_PACKAGES.includes("@playwright/test"));
    assert.ok(FORBIDDEN_ROOT_RUNTIME_PACKAGES.includes("typescript"));
  });
});
