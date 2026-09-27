import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("temporary romance_fantasy_v2 proof boot launcher", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");

  it("is restricted to the one Railway production service", () => {
    assert.match(source, /process\.env\.NODE_ENV !== "production"/);
    assert.match(source, /process\.env\.RAILWAY_SERVICE_ID !== targetRailwayService/);
    assert.match(source, /5e36bd2b-5557-4765-949f-5569a8a79628/);
  });

  it("invokes only the canonical bounded proof operator with its explicit opt-in", () => {
    assert.match(source, /scripts\/official-supply-style-proof\.ts/);
    assert.match(source, /OFFICIAL_STYLE_PROOF_LIVE: "1"/);
    assert.match(source, /OFFICIAL_STYLE_PROOF_CANDIDATE: "rf-02"/);
    assert.match(source, /officialStyleProofBootStarted/);
    assert.match(source, /return new Promise\(\(resolve\) =>/);
  });

  it("starts proof only after HTTP readiness and does not replace the normal server owner", () => {
    const ready = source.indexOf("Ready on http://");
    const serialized = source.indexOf("runOfficialStyleProofV2BootOnce().finally(() => runBackgroundInitialization())", ready);
    assert.ok(ready >= 0 && serialized > ready);
    assert.match(source, /const app = next\(/);
    assert.match(source, /httpServer\.listen\(/);
  });
});
