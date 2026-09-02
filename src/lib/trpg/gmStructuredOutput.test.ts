import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgGmResponseFormat, isTrpgGmStructuredShape, parseTrpgGmStructuredJson } from "./gmStructuredOutput";

describe("gmStructuredOutput", () => {
  it("buildTrpgGmResponseFormat exposes narration+delta json_schema", () => {
    const format = buildTrpgGmResponseFormat();
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.name, "trpg_gm_output");
    assert.deepEqual(format.json_schema.schema.required, ["narration", "delta"]);
  });

  it("parseTrpgGmStructuredJson accepts wrapped object text", () => {
    const raw = '{"narration":"장면","delta":{"players":[]}}';
    const parsed = parseTrpgGmStructuredJson(raw);
    assert.equal(isTrpgGmStructuredShape(parsed), true);
  });
});
