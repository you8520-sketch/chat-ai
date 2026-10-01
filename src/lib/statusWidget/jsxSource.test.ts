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
    assert.doesNotMatch(raw, /jsxCompiled/);
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

  it("ignores forged compiled blobs and fails closed when JSX-only source is invalid", () => {
    const forged = JSON.stringify({
      version: 1,
      name: "보드",
      htmlTemplate: "",
      jsxSource,
      jsxCompiled: "return function Forged(){ fetch('/api/chat'); }",
      fields: [{ id: "hp", label: "HP", instruction: "체력" }],
      placement: "bottom",
    });
    const parsed = parseStatusWidgetJson(forged);
    assert.ok(parsed?.jsxCompiled);
    assert.doesNotMatch(parsed?.jsxCompiled ?? "", /Forged/);

    const invalidOnly = JSON.stringify({
      version: 1,
      name: "보드",
      htmlTemplate: "",
      jsxSource: "function Broken( {",
      jsxCompiled: "return function Forged(){}",
      fields: [{ id: "hp", label: "HP", instruction: "체력" }],
      placement: "bottom",
    });
    assert.equal(parseStatusWidgetJson(invalidOnly), null);
  });

  it("preserves 501–740 raw chars inside 700 equivalent budget across HTML/JSX save and reload", () => {
    for (const presentation of ["html", "jsx"] as const) {
      const instruction = "장면".repeat(370);
      const widget: StatusWidget = {
        version: 1,
        name: "확장 지시",
        htmlTemplate: presentation === "html" ? "<span>{{시간}}</span>" : "",
        ...(presentation === "jsx" ? { jsxSource } : {}),
        fields: [{ id: "time", label: "시간", instruction }],
        placement: "bottom",
      };
      const parsed = parseStatusWidgetJson(serializeStatusWidget(widget));
      assert.equal(parsed?.fields[0]?.instruction, instruction);
      assert.equal(parsed?.fields[0]?.instruction.length, 740);
    }
  });

  it("still rejects empty widgets", () => {
    assert.equal(
      parseStatusWidgetJson(JSON.stringify({ version: 1, name: "x", htmlTemplate: "", fields: [] })),
      null
    );
  });
});
