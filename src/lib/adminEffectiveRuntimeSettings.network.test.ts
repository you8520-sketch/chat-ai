import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

const fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetchCalls.push(String(input));
  throw new Error(`projection-must-not-fetch:${String(input)}`);
}) as typeof fetch;

describe("effective runtime settings projection network side-effect", async () => {
  const beforeImport = fetchCalls.length;
  const { buildEffectiveRuntimeSettingsProjection } = await import(
    "@/lib/adminEffectiveRuntimeSettings"
  );
  const importFetchCalls = fetchCalls.slice(beforeImport);

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("importing and building the projection does not call fetch", () => {
    assert.deepEqual(importFetchCalls, []);
    const before = fetchCalls.length;
    const projection = buildEffectiveRuntimeSettingsProjection(
      new Date("2026-10-07T00:00:00.000Z")
    );
    assert.equal(projection.mainRp.models.length, 4);
    assert.equal(projection.mutationSupported, false);
    assert.deepEqual(fetchCalls.slice(before), []);
  });
});
