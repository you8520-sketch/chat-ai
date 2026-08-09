import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeNumericStateDefinition,
} from "@/lib/statusWidget/numericStateDefinition";
import { fingerprintNumericStateDefinition } from "@/lib/statusWidget/numericStateFingerprint";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "@/lib/statusWidget/serialize";
import type { StatusWidget } from "@/lib/statusWidget/types";

const validInteger = {
  version: 1 as const,
  mode: "server_meter" as const,
  min: 0,
  max: 100,
  initial: 40,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
  manualEditable: true,
};

describe("Phase B1-A — numeric definition (D1-D10)", () => {
  it("D1 valid integer 0-100", () => {
    const d = normalizeNumericStateDefinition(validInteger);
    assert.ok(d);
    assert.equal(d!.min, 0);
    assert.equal(d!.max, 100);
    assert.equal(d!.initial, 40);
    assert.equal(d!.integer, true);
  });

  it("D2 valid decimal", () => {
    const d = normalizeNumericStateDefinition({
      version: 1,
      mode: "server_meter",
      min: 0,
      max: 1,
      initial: 0.25,
      integer: false,
      maxIncreasePerTurn: 0.1,
    });
    assert.ok(d);
    assert.equal(d!.initial, 0.25);
    assert.equal(d!.integer, false);
  });

  it("D3 min > max reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, min: 80, max: 20 }),
      null
    );
  });

  it("D4 initial outside range reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, initial: 150 }),
      null
    );
  });

  it("D5 NaN/Infinity reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, min: Number.NaN }),
      null
    );
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, max: Number.POSITIVE_INFINITY }),
      null
    );
  });

  it("D6 negative delta limit reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, maxIncreasePerTurn: -1 }),
      null
    );
  });

  it("D7 integer definition with decimal bound reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({
        ...validInteger,
        maxIncreasePerTurn: 2.5,
      }),
      null
    );
  });

  it("D8 wrong version reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, version: 2 }),
      null
    );
  });

  it("D9 wrong mode reject", () => {
    assert.equal(
      normalizeNumericStateDefinition({ ...validInteger, mode: "server_counter" }),
      null
    );
  });

  it("D10 legacy field without numericState unchanged", () => {
    assert.equal(normalizeNumericStateDefinition(undefined), null);
    assert.equal(normalizeNumericStateDefinition(null), null);
  });
});

describe("Phase B1-A — widget numeric serialization (S1-S6)", () => {
  const legacyWidget: StatusWidget = {
    version: 1,
    name: "상태창",
    htmlTemplate: "<div>{{affection}}</div>",
    fields: [
      {
        id: "affection",
        label: "호감도",
        instruction: "숫자",
        initialValue: "40",
      },
    ],
    placement: "bottom",
  };

  it("S1 numericState parse", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "상태창",
      htmlTemplate: "<div>{{affection}}</div>",
      fields: [
        {
          id: "affection",
          label: "호감도",
          instruction: "숫자",
          numericState: validInteger,
          unknownJunk: "drop-me",
        },
      ],
      placement: "bottom",
    });
    const parsed = parseStatusWidgetJson(raw);
    assert.ok(parsed);
    assert.deepEqual(parsed!.fields[0]!.numericState, {
      version: 1,
      mode: "server_meter",
      min: 0,
      max: 100,
      initial: 40,
      integer: true,
      maxIncreasePerTurn: 5,
      maxDecreasePerTurn: 5,
      manualEditable: true,
    });
    assert.equal(
      "unknownJunk" in (parsed!.fields[0] as object),
      false,
      "unknown field props not preserved"
    );
  });

  it("S2 numericState serialize", () => {
    const widget: StatusWidget = {
      ...legacyWidget,
      fields: [{ ...legacyWidget.fields[0]!, numericState: validInteger }],
    };
    const json = JSON.parse(serializeStatusWidget(widget)) as StatusWidget;
    assert.deepEqual(json.fields[0]!.numericState, validInteger);
  });

  it("S3 parse→serialize→parse identical numericState", () => {
    const raw = serializeStatusWidget({
      ...legacyWidget,
      fields: [{ ...legacyWidget.fields[0]!, numericState: validInteger }],
    });
    const once = parseStatusWidgetJson(raw)!;
    const twice = parseStatusWidgetJson(serializeStatusWidget(once))!;
    assert.deepEqual(once.fields[0]!.numericState, twice.fields[0]!.numericState);
    assert.equal(
      fingerprintNumericStateDefinition(once.fields[0]!.numericState!),
      fingerprintNumericStateDefinition(twice.fields[0]!.numericState!)
    );
  });

  it("S4 invalid numericState stripped safely", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "상태창",
      htmlTemplate: "<div>{{affection}}</div>",
      fields: [
        {
          id: "affection",
          label: "호감도",
          instruction: "숫자",
          numericState: { version: 1, mode: "server_meter", min: 10, max: 0, initial: 5, integer: true },
        },
      ],
      placement: "bottom",
    });
    const parsed = parseStatusWidgetJson(raw)!;
    assert.equal(parsed.fields[0]!.numericState, undefined);
    assert.equal(parsed.fields[0]!.id, "affection");
  });

  it("S5 legacy widget semantic roundtrip", () => {
    const once = parseStatusWidgetJson(serializeStatusWidget(legacyWidget))!;
    const twice = parseStatusWidgetJson(serializeStatusWidget(once))!;
    assert.equal(twice.fields[0]!.id, "affection");
    assert.equal(twice.fields[0]!.initialValue, "40");
    assert.equal(twice.fields[0]!.numericState, undefined);
    assert.equal(twice.htmlTemplate, legacyWidget.htmlTemplate);
  });

  it("S6 arbitrary unknown field properties are NOT blindly persisted", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "상태창",
      htmlTemplate: "<div>{{x}}</div>",
      fields: [
        {
          id: "x",
          label: "X",
          instruction: "x",
          secretClientField: { evil: true },
          authority: "client",
        },
      ],
      placement: "bottom",
    });
    const parsed = parseStatusWidgetJson(raw)!;
    const round = JSON.parse(serializeStatusWidget(parsed)) as {
      fields: Array<Record<string, unknown>>;
    };
    assert.deepEqual(Object.keys(round.fields[0]!).sort(), [
      "id",
      "instruction",
      "label",
    ]);
  });
});
