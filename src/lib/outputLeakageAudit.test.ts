import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOutputLeakageAudit } from "@/lib/outputLeakageAudit";
import { partitionModelStatusArtifacts } from "@/lib/statusMeta/stripArtifacts";

describe("outputLeakageAudit", () => {
  it("detects hidden status json table and html", () => {
    const model =
      "RP 본문입니다.\n\n| 항목 | 내용 |\n|:---:|:---:|\n| 시간 | 밤 |\n\n```html\n<div>x</div>\n```\n```json\n{\"a\":1}\n```";
    const pre = model;
    const statusArtifacts = partitionModelStatusArtifacts(pre);
    const audit = buildOutputLeakageAudit({
      apiOutputTokens: 100,
      finishReason: "stop",
      targetTier: 2000,
      modelDeliveredText: model,
      preStatusPartitionText: pre,
      statusArtifacts,
      afterClampText: statusArtifacts.prose,
      savedBeforeHtmlFlash: statusArtifacts.prose,
      savedFinalText: statusArtifacts.prose,
      savedVisibleBillable: statusArtifacts.prose.length,
    });
    assert.equal(audit.hiddenArtifacts.detected, true);
    assert.ok(audit.hiddenArtifacts.statusTableChars > 0);
    assert.ok(audit.hiddenArtifacts.statusHtmlChars > 0);
    assert.ok(audit.hiddenArtifacts.statusJsonChars > 0);
  });

  it("reports no hidden artifacts for prose-only model output", () => {
    const model = "RP 본문만 있습니다. 대화와 묘사가 이어집니다.";
    const statusArtifacts = partitionModelStatusArtifacts(model);
    const audit = buildOutputLeakageAudit({
      apiOutputTokens: 50,
      targetTier: 2000,
      modelDeliveredText: model,
      preStatusPartitionText: model,
      statusArtifacts,
      afterClampText: statusArtifacts.prose,
      savedBeforeHtmlFlash: statusArtifacts.prose,
      savedFinalText: statusArtifacts.prose,
      savedVisibleBillable: statusArtifacts.prose.length,
    });
    assert.equal(audit.hiddenArtifacts.detected, false);
    assert.equal(audit.hiddenArtifacts.totalArtifactChars, 0);
  });
});
