import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  hydrateJsxCatalogEditorState,
  removeJsxCatalogHead,
  resolveJsxCatalogDraft,
  serializeJsxComponentCatalog,
} from "./catalog.ts";
import { compileJsxComponentSource, suggestJsxPropNamesFromCompiled } from "./compile.ts";
import { extractJsxInvocations, resolveJsxInvocationProps } from "./invocation.ts";
import { buildPitWallFixtureRecord } from "./pitWallFixture.ts";
import type { JsxPropDefinition } from "./types.ts";

const SAVED_SOURCE = `export default function Board(props) {
  return <div>{props.hp}{props["mp"]}</div>;
}`;

function savedBoard() {
  const compiled = compileJsxComponentSource(SAVED_SOURCE, "Board");
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("fixture");
  const props: JsxPropDefinition[] = [
    { name: "hp", type: "number", required: true },
    { name: "mp", type: "number", required: false },
  ];
  return {
    name: "Board",
    source: SAVED_SOURCE,
    compiled: compiled.compiled,
    props,
    capabilities: compiled.capabilities,
    chatSend: compiled.chatSend,
  };
}

describe("jsx catalog draft", () => {
  it("does not treat a blank editor as an unsaved draft", () => {
    const resolved = resolveJsxCatalogDraft([], { name: "  ", source: "", props: [] });
    assert.equal(resolved.unsaved, false);
    assert.equal(resolved.catalog.length, 0);
  });

  it("keeps the saved catalog when compilation fails", () => {
    const saved = [savedBoard()];
    const resolved = resolveJsxCatalogDraft(saved, {
      name: "Board",
      source: "function Board(",
      props: saved[0]!.props,
    });
    assert.equal(resolved.catalog, saved);
    assert.equal(resolved.catalog[0]?.source, SAVED_SOURCE);
    assert.equal(resolved.preview, null);
    assert.match(resolved.error, /.+/);
    assert.equal(resolved.unsaved, true);
    assert.match(serializeJsxComponentCatalog(resolved.catalog), /props\.hp/);
  });

  it("replaces the saved slot only after a successful compile", () => {
    const saved = [savedBoard()];
    const nextSource = `export default function Board(props) { return <section>{props.hp}</section>; }`;
    const resolved = resolveJsxCatalogDraft(saved, {
      name: "Board",
      source: nextSource,
      props: [{ name: "hp", type: "number", required: true }],
    });
    assert.equal(resolved.error, "");
    assert.equal(resolved.unsaved, false);
    assert.equal(resolved.catalog.length, 1);
    assert.equal(resolved.catalog[0]?.source, nextSource.trim());
    assert.notEqual(resolved.catalog, saved);
  });

  it("preserves later saved components on failed and successful edits to the first", () => {
    const tailSource = 'export default function Extra(props) { return <div>{props.title}</div>; }';
    const tailCompiled = compileJsxComponentSource(tailSource, "Extra");
    assert.equal(tailCompiled.ok, true);
    if (!tailCompiled.ok) throw new Error("fixture");
    const extra = {
      name: "Extra",
      source: tailSource,
      compiled: tailCompiled.compiled,
      props: [{ name: "title", type: "string" as const, required: true }],
      capabilities: tailCompiled.capabilities,
      chatSend: tailCompiled.chatSend,
    };
    const saved = [savedBoard(), extra];
    const failed = resolveJsxCatalogDraft(saved, {
      name: "Board",
      source: "function Board(",
      props: saved[0]!.props,
    });
    assert.equal(failed.catalog, saved);
    assert.equal(failed.catalog[1], extra);

    const validSource = 'export default function Board(props) { return <strong>{props.hp}</strong>; }';
    const succeeded = resolveJsxCatalogDraft(saved, {
      name: "Board",
      source: validSource,
      props: saved[0]!.props,
    });
    assert.equal(succeeded.error, "");
    assert.equal(succeeded.catalog.length, 2);
    assert.equal(succeeded.catalog[0]?.source, validSource);
    assert.equal(succeeded.catalog[1], extra);
    assert.equal(JSON.parse(serializeJsxComponentCatalog(succeeded.catalog)).length, 2);

    const afterRemoval = removeJsxCatalogHead(succeeded.catalog);
    assert.deepEqual(afterRemoval.map((item) => item.name), ["Extra"]);
    assert.equal(serializeJsxComponentCatalog(afterRemoval).includes('"name":"Extra"'), true);
  });

  it("still resolves chat invocation props from the catalog a failed draft did not clear", () => {
    const saved = [buildPitWallFixtureRecord()];
    const resolved = resolveJsxCatalogDraft(saved, {
      name: "PitWallFixture",
      source: "export default function PitWallFixture(",
      props: saved[0]!.props,
    });
    assert.equal(resolved.catalog[0]?.name, "PitWallFixture");
    const found = extractJsxInvocations(
      `<PitWallFixture tyreWearPct={38} fuelPct={62} lap={18} maxLap={58} driver="Dante" compound="M" pitWindowOpen={true} />`
    );
    const props = resolveJsxInvocationProps(resolved.catalog[0]!.props, found[0]!.props);
    assert.equal(props.ok, true);
    if (props.ok) assert.equal(props.props.driver, "Dante");
  });

  it("hydrates a saved component into an empty editor and does not clobber a dirty draft", () => {
    const saved = savedBoard();
    const hydrated = hydrateJsxCatalogEditorState({
      appliedSavedFingerprint: "",
      draft: { name: "", source: "", props: [] },
      saved,
    });
    assert.equal(hydrated.hydrated, true);
    assert.equal(hydrated.draft.name, "Board");
    assert.equal(hydrated.draft.source, SAVED_SOURCE);

    const dirty = hydrateJsxCatalogEditorState({
      appliedSavedFingerprint: "",
      draft: { name: "Draft", source: "export default function Draft(){ return <i/>; }", props: [] },
      saved,
    });
    assert.equal(dirty.hydrated, false);
    assert.equal(dirty.draft.name, "Draft");
  });

  it("does not clear the catalog from the compile-failure branch", () => {
    const source = readFileSync("src/components/JsxComponentCatalogEditor.tsx", "utf8");
    const applyStart = source.indexOf("function applyDraft");
    const applyEnd = source.indexOf("function removeSaved", applyStart);
    const applyBlock = source.slice(applyStart, applyEnd);
    assert.doesNotMatch(applyBlock, /onChange\(\s*\[\s*\]\s*\)/);
    assert.match(source, /미저장 초안/);
    assert.match(source, /저장된 컴포넌트는 유지됩니다/);
  });
});

describe("suggestJsxPropNamesFromCompiled", () => {
  it("suggests only static prop reads the compiler kept", () => {
    const compiled = compileJsxComponentSource(
      `export default function Board(props) {
        const hidden = props[key];
        return <div>{props.hp}{props["mp"]}{props?.shield}{props["시간"]}</div>;
      }`,
      "Board"
    );
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.deepEqual(suggestJsxPropNamesFromCompiled(compiled.compiled), ["hp", "mp"]);
  });

  it("does not invent props from destructuring", () => {
    const compiled = compileJsxComponentSource(
      `export default function Board({ title }) { return <div>{title}</div>; }`,
      "Board"
    );
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.deepEqual(suggestJsxPropNamesFromCompiled(compiled.compiled), []);
  });
});
