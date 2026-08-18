import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const PRODUCTION_IMPORT_SURFACES = [
  "src/lib/adultHandoffSourceRouting.ts",
  "src/lib/adultHandoffPricing.ts",
  "src/services/contextBuilder.ts",
  "src/app/api/chat/route.ts",
] as const;

describe("Muse V1/V2 audit constants stay out of the production resolver", () => {
  it("does not import the audit-only constants module", () => {
    for (const rel of PRODUCTION_IMPORT_SURFACES) {
      const text = readFileSync(resolve(process.cwd(), rel), "utf8");
      assert.equal(text.includes("muse12-source-style-generalization"), false);
      assert.equal(text.includes("auditOnlyConstants"), false);
      assert.equal(text.includes("MUSE12_AUDIT_V2_STYLE_MIRROR"), false);
      assert.equal(text.includes("MUSE12_AUDIT_V1_OPUS_POSITIVE"), false);
    }
  });
});
