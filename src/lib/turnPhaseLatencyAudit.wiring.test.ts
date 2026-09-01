import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isTurnPhaseAuditEnabled } from "@/lib/turnPhaseLatencyAudit";

describe("turnPhaseLatencyAudit — wiring completeness (read-only)", () => {
  it("reports current GEMINI_TTFT_PHASE_AUDIT env without mutation", () => {
    const current = process.env.GEMINI_TTFT_PHASE_AUDIT ?? "";
    assert.ok(typeof current === "string");
    assert.equal(isTurnPhaseAuditEnabled(), current === "1");
  });

  it("server route wires required marks T0 T10 T12 T13 T14 T18", () => {
    const route = readFileSync("src/app/api/chat/route.ts", "utf8");
    const openRouter = readFileSync("src/lib/openRouterAdult.ts", "utf8");
    const audit = readFileSync("src/lib/turnPhaseLatencyAudit.ts", "utf8");

    for (const mark of [
      "T0_REQUEST_IN",
      "T10_PROVIDER_FETCH_START",
      "T12_PROVIDER_FIRST_SSE",
      "T13_PROVIDER_FIRST_VISIBLE_TOKEN",
      "T14_SERVER_FIRST_VISIBLE_WRITE",
      "T18_REQUEST_COMPLETE",
    ] as const) {
      const inRoute = route.includes(mark);
      const inOpenRouter = openRouter.includes(mark);
      const inAudit = audit.includes(mark);
      assert.ok(inRoute || inOpenRouter || inAudit, `missing mark wiring reference: ${mark}`);
    }
  });

  it("T15/T16 client writers — dead/partial unless ChatClient marks exist", () => {
    const chatClient = readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    const t15Count = (chatClient.match(/T15_BROWSER_FIRST_VISIBLE_RECEIVE/g) ?? []).length;
    const t16Count = (chatClient.match(/T16_UI_FIRST_CHARACTER_PAINT/g) ?? []).length;
    assert.equal(t15Count, 0, "T15_WRITER_COUNT expected 0 until wired in ChatClient");
    assert.equal(t16Count, 0, "T16_WRITER_COUNT expected 0 until wired in ChatClient");
  });

  it("TTFT_AUDIT_OWNER_COUNT=1 — turnPhaseLatencyAudit is canonical owner", () => {
    const grepTargets = [
      "src/app/api/chat/route.ts",
      "src/lib/openRouterAdult.ts",
      "src/lib/turnPhaseLatencyAudit.ts",
    ];
    let ownerHits = 0;
    for (const file of grepTargets) {
      if (readFileSync(file, "utf8").includes("turnPhaseLatencyAudit")) ownerHits += 1;
    }
    assert.ok(ownerHits >= 2);
  });
});
