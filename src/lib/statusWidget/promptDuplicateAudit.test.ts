import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditStatusWidgetPromptDuplicates } from "./promptDuplicateAudit";

describe("auditStatusWidgetPromptDuplicates", () => {
  it("reports overlapping widget and firewall instructions reduced after dedupe", () => {
    const audit = auditStatusWidgetPromptDuplicates();
    assert.ok(audit.combinedChars < 1500);
    assert.ok(audit.findings.length <= 2);
    const highJson = audit.findings.find((f) => f.category === "json_example" && f.severity === "high");
    assert.equal(highJson, undefined);
  });
});
