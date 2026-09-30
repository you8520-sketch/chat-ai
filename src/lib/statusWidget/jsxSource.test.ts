import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileJsxComponentSource } from "../jsxComponent/compile.ts";
import { renderStatusWidgetsForTurn } from "./render.ts";
import { parseStatusWidgetJson, serializeStatusWidget } from "./serialize.ts";
import type { StatusWidget } from "./types.ts";

const jsxSource = `export default function StatusBoard(props) {
  return <div>{props.hp}/{props.maxHp}</div>;
}`;

describe("status widget optional jsxSource", () => {
  it("parses jsx-only widgets and keeps them in the render list", () => {
    const compiled = compileJsxComponentSource(jsxSource);
    assert.equal(compiled.ok, true);
    const widget: StatusWidget = {
      version: 1,
      name: "보드",
      htmlTemplate: "",
      jsxSource,
      jsxCompiled: compiled.ok ? compiled.compiled : "",
      fields: [{ id: "hp", label: "HP", instruction: "체력" }],
      placement: "bottom",
    };
    const raw = serializeStatusWidget(widget);
    const parsed = parseStatusWidgetJson(raw);
    assert.ok(parsed);
    assert.equal(parsed?.htmlTemplate, "");
    assert.ok(parsed?.jsxCompiled);
    const rendered = renderStatusWidgetsForTurn([
      { source: "character", widget: parsed!, values: { hp: "45" } },
    ]);
    assert.equal(rendered.length, 1);
    assert.ok(rendered[0]?.jsxCompiled);
    assert.equal(rendered[0]?.html, "");
  });

  it("still rejects empty widgets", () => {
    assert.equal(
      parseStatusWidgetJson(JSON.stringify({ version: 1, name: "x", htmlTemplate: "", fields: [] })),
      null
    );
  });
});
