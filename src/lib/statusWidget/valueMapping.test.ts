import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { normalizeParsedStatusWidgetValuesForTurn } from "./parseValues";
import { renderStatusWidgetHtml } from "./render";
import { logStatusWidgetValuesMissingDev, logV3StatusExtractDev } from "./telemetry";
import type { StatusWidget } from "./types";

const widget: StatusWidget = {
  id: "status",
  title: "상태",
  placement: "bottom",
  htmlTemplate:
    '<section><p>몸 상태: {{몸상태}}</p><p>현재상황: {{현재상황}}</p></section>',
  fields: [
    { id: "몸상태", label: "몸 상태", instruction: "몸 상태" },
    { id: "현재상황", label: "현재상황", instruction: "현재 상황" },
  ],
};

const originalWarn = console.warn;

afterEach(() => {
  console.warn = originalWarn;
});

describe("status widget value key mapping", () => {
  it("maps Korean labels to configured schema keys", () => {
    const normalized = normalizeParsedStatusWidgetValuesForTurn(
      { character: { "몸 상태": "지침", 현재상황: "복도에서 대치 중" } },
      { characterWidget: widget }
    );

    assert.equal(normalized.character?.["몸상태"], "지침");
    assert.equal(normalized.character?.["현재상황"], "복도에서 대치 중");
  });

  it("maps machine keys to configured schema keys", () => {
    const normalized = normalizeParsedStatusWidgetValuesForTurn(
      { character: { body_state: "부상", current_situation: "문 앞에서 멈춤" } },
      { characterWidget: widget }
    );

    assert.equal(normalized.character?.["몸상태"], "부상");
    assert.equal(normalized.character?.["현재상황"], "문 앞에서 멈춤");
  });

  it("maps spacing variants to compact configured keys", () => {
    const normalized = normalizeParsedStatusWidgetValuesForTurn(
      { character: { "현재 상황": "계단을 내려가는 중" } },
      { characterWidget: widget }
    );

    assert.equal(normalized.character?.["현재상황"], "계단을 내려가는 중");
  });

  it("renderer displays stored values and shows a missing marker only for truly missing fields", () => {
    const html = renderStatusWidgetHtml(widget, { body_state: "안정" });

    assert.match(html, /안정/);
    assert.match(html, /—/);
  });

  it("logs missing required fields without private content", () => {
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    logStatusWidgetValuesMissingDev({
      messageId: 42,
      expectedKeys: ["몸상태", "현재상황"],
      parsedKeys: ["몸상태"],
      rawStatusBlockPresent: true,
    });

    assert.equal(warnings.length, 1);
    assert.equal((warnings[0] as unknown[])[0], "[StatusWidgetValuesMissing]");
    assert.deepEqual((warnings[0] as unknown[])[1], {
      messageId: 42,
      expectedKeys: ["몸상태", "현재상황"],
      parsedKeys: ["몸상태"],
      missingKeys: ["현재상황"],
      rawStatusBlockPresent: true,
      parseError: null,
    });
  });

  it("logs V3 extract reliability without prose", () => {
    const infos: unknown[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      infos.push(args);
    };
    try {
      logV3StatusExtractDev({
        message_id: 7,
        requiredKeys: ["속마음", "현재상황"],
        parsedKeys: ["속마음"],
        missingKeys: ["현재상황"],
        extractedFactsRawCount: 2,
        extractedFactsValidCount: 1,
        v3Used: true,
        fallbackUsed: false,
        parseError: null,
      });
    } finally {
      console.info = originalInfo;
    }
    assert.equal(infos.length, 1);
    assert.equal((infos[0] as unknown[])[0], "[V3StatusExtract]");
    const payload = JSON.parse(String((infos[0] as unknown[])[1])) as {
      missingKeys: string[];
      v3Used: boolean;
    };
    assert.deepEqual(payload.missingKeys, ["현재상황"]);
    assert.equal(payload.v3Used, true);
  });
});
