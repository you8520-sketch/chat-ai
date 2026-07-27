import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { TURN_LENGTH_SUPPLEMENT_API_ENABLED } from "@/lib/turnApiBudget";

const routeUrl = new URL("./route.ts", import.meta.url);

describe("/api/chat Muse acceptance client/DB usage split", () => {
  it("keeps recovery APIs off", () => {
    assert.equal(TURN_LENGTH_SUPPLEMENT_API_ENABLED, false);
  });

  it("builds dbUsageRecord with museAcceptance and clientUsageRecord without it", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(src, /let dbUsageRecord:\s*Usage/);
    assert.match(src, /const clientUsageRecord\s*=\s*stripMuseAcceptanceFromUsage\(dbUsageRecord\)/);
    assert.match(src, /usageJson:\s*JSON\.stringify\(dbUsageRecord\)/);
    assert.match(src, /usage:\s*clientUsageRecord/);
    // Must not re-attach museAcceptance onto the SSE usage object after strip.
    assert.doesNotMatch(
      src,
      /clientUsageRecord\s*=\s*\{[\s\S]*museAcceptance/
    );
  });

  it("never sends museAcceptance even for full billing receipt", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(
      src,
      /Even for full billing receipt admins — never send museAcceptance to clients/
    );
    assert.match(src, /stripMuseAcceptanceFromUsage\(dbUsageRecord\)/);
  });

  it("stores museAcceptance in context_json via museAcceptanceFields", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(src, /museAcceptance:\s*museAcceptanceFields/);
    assert.match(src, /isRegenerationRequest:/);
    assert.match(src, /isContinueRequest:/);
    assert.match(src, /requestLatencyMs:/);
  });

  it("does not invent auto-continuation after SHORT_QUALITY_PASS", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.doesNotMatch(src, /SHORT_QUALITY_PASS[\s\S]{0,200}continueNarrative/);
    assert.doesNotMatch(src, /acceptanceClass[\s\S]{0,120}NARRATIVE_LENGTH_CONTINUATION/);
  });
});
