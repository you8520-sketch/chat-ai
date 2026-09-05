import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("/api/chat strict Main RP single-call invariant", () => {
  it("hard-disables both live adult refusal fallback callsites", () => {
    assert.equal(
      (routeSource.match(/fallbackContextAvailable:\s*false/g) ?? []).length,
      2
    );
    assert.doesNotMatch(
      routeSource,
      /fallbackContextAvailable:\s*fallbackAdultContext\s*!=\s*null/
    );
  });

  it("keeps only general refusal fallback request kind in route source", () => {
    assert.match(routeSource, /requestKind:\s*"adult-general-refusal-fallback"/);
    assert.doesNotMatch(routeSource, /requestKind:\s*"adult-hard-failure-fallback"/);
  });
});
