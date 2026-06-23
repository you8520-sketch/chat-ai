import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyFieldLabelChange,
  fieldPlaceholderKey,
  replacePlaceholderInHtml,
  statusValueKeyFromLabel,
  uniqueStatusValueKey,
} from "./fieldKeys";
import type { StatusWidget } from "./types";

describe("statusWidget fieldKeys", () => {
  it("derives Caveduck-style keys from labels", () => {
    assert.equal(statusValueKeyFromLabel("시간"), "시간");
    assert.equal(statusValueKeyFromLabel("NPC의 속마음 한 줄"), "NPC의_속마음_한_줄");
    assert.equal(statusValueKeyFromLabel("하고 싶은 것 1"), "하고_싶은_것_1");
    assert.equal(statusValueKeyFromLabel("의식의흐름"), "의식의흐름");
  });

  it("replaces placeholders when label changes", () => {
    const widget: StatusWidget = {
      version: 1,
      name: "t",
      placement: "bottom",
      htmlTemplate: "<p>{{시간}} · {{장소}}</p>",
      fields: [
        { id: "시간", label: "시간", instruction: "a" },
        { id: "장소", label: "장소", instruction: "b" },
      ],
    };
    const next = applyFieldLabelChange(widget, 0, "현재 시각");
    assert.equal(next.fields[0]!.id, "현재_시각");
    assert.ok(next.htmlTemplate.includes("{{현재_시각}}"));
    assert.ok(!next.htmlTemplate.includes("{{시간}}"));
  });

  it("dedupes colliding keys", () => {
    assert.equal(uniqueStatusValueKey("시간", ["시간"]), "시간_2");
  });

  it("replacePlaceholderInHtml swaps tokens", () => {
    assert.equal(
      replacePlaceholderInHtml("{{a}} x {{a}}", "a", "b"),
      "{{b}} x {{b}}"
    );
  });

  it("fieldPlaceholderKey prefers label-derived key", () => {
    assert.equal(
      fieldPlaceholderKey({ id: "time", label: "시간", instruction: "" }),
      "시간"
    );
  });
});
