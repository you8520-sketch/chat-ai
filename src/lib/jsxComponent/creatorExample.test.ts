import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { compileJsxComponentDraft, resolveJsxCatalogDraft } from "./catalog";
import { compileJsxComponentSource } from "./compile";
import {
  CREATOR_JSX_EXAMPLE_NAME,
  CREATOR_JSX_EXAMPLE_PROPS,
  CREATOR_JSX_EXAMPLE_SOURCE,
  CREATOR_JSX_EXAMPLES,
  jsxPropPreviewValues,
} from "./creatorExample";
import type { JsxComponentRecord } from "./types";

describe("creator JSX example", () => {
  it("uses a HAV-neutral example instead of the internal PitWall fixture", () => {
    assert.equal(CREATOR_JSX_EXAMPLE_NAME, "InteractiveCardExample");
    assert.deepEqual(
      CREATOR_JSX_EXAMPLE_PROPS.map((prop) => prop.name),
      ["title", "value", "max", "note"]
    );
    assert.doesNotMatch(CREATOR_JSX_EXAMPLE_SOURCE, /PitWall|PIT WALL|Dante|tyre|tire|fuel/i);
    assert.equal(
      CREATOR_JSX_EXAMPLE_PROPS.some((prop) =>
        /driver|lap|tyre|tire|fuel|compound|trackTemp|airTemp/i.test(prop.name)
      ),
      false
    );

    const compiled = compileJsxComponentDraft({
      name: CREATOR_JSX_EXAMPLE_NAME,
      source: CREATOR_JSX_EXAMPLE_SOURCE,
      props: CREATOR_JSX_EXAMPLE_PROPS,
    });
    assert.equal(compiled.ok, true);
    if (compiled.ok) {
      assert.equal(compiled.record.chatSend, false);
      assert.ok(compiled.record.capabilities.includes("local_state"));
    }
  });

  it("compiles four distinct gallery examples without chat send or network", () => {
    assert.deepEqual(
      CREATOR_JSX_EXAMPLES.map((example) => example.label),
      ["진행 상황 카드", "퀘스트 카드", "선택지 카드", "인물 정보 패널"]
    );
    const names = new Set<string>();
    for (const example of CREATOR_JSX_EXAMPLES) {
      names.add(example.name);
      assert.doesNotMatch(example.source, /sendToChat|fetch\(|localStorage|PitWall|import /);
      const compiled = compileJsxComponentDraft({
        name: example.name,
        source: example.source,
        props: example.props,
      });
      assert.equal(compiled.ok, true, example.id);
      if (!compiled.ok) continue;
      assert.equal(compiled.record.chatSend, false);
      assert.ok(compiled.record.capabilities.includes("local_state"));
      const preview = jsxPropPreviewValues(example.props, { [example.props[0]!.name]: "바꾼값" });
      assert.equal(preview[example.props[0]!.name], "바꾼값");
      assert.notEqual(example.props[0]!.example, "바꾼값");
    }
    assert.equal(names.size, 4);
    assert.doesNotMatch(readFileSync("src/lib/jsxComponent/prompt.ts", "utf8"), /creatorExample|CREATOR_JSX_EXAMPLES/);
  });

  it("keeps a saved catalog unchanged until an example is explicitly applied", () => {
    const savedSource = `export default function Board(props) { return <div>{props.hp}</div>; }`;
    const compiled = compileJsxComponentSource(savedSource, "Board");
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const tailSource = `export default function Extra(props) { return <i>{props.title}</i>; }`;
    const tail = compileJsxComponentSource(tailSource, "Extra");
    assert.equal(tail.ok, true);
    if (!tail.ok) return;
    const saved: JsxComponentRecord[] = [
      {
        name: "Board",
        source: savedSource,
        compiled: compiled.compiled,
        props: [{ name: "hp", type: "number", required: true, example: "3" }],
        capabilities: compiled.capabilities,
        chatSend: compiled.chatSend,
      },
      {
        name: "Extra",
        source: tailSource,
        compiled: tail.compiled,
        props: [{ name: "title", type: "string", required: true }],
        capabilities: tail.capabilities,
        chatSend: tail.chatSend,
      },
    ];
    const quest = CREATOR_JSX_EXAMPLES.find((example) => example.id === "quest");
    assert.ok(quest);
    const browsed = jsxPropPreviewValues(quest!.props, { step: "3" });
    assert.equal(browsed.step, 3);
    assert.equal(saved[0]?.name, "Board");

    const applied = resolveJsxCatalogDraft(saved, {
      name: quest!.name,
      source: quest!.source,
      props: quest!.props,
    });
    assert.equal(applied.error, "");
    assert.equal(applied.catalog[0]?.name, "QuestCardExample");
    assert.equal(applied.catalog[1]?.name, "Extra");
    assert.equal(saved[0]?.name, "Board");
  });

  it("browses examples in the editor without writing the catalog", () => {
    const editor = readFileSync("src/components/JsxComponentCatalogEditor.tsx", "utf8");
    const create = readFileSync("src/components/CreateCharacter.tsx", "utf8");
    const galleryStart = editor.indexOf('aria-label="예제 갤러리"');
    const galleryEnd = editor.indexOf("예시 값");
    const gallery = editor.slice(galleryStart, galleryEnd);
    assert.ok(galleryStart > 0 && galleryEnd > galleryStart);
    assert.doesNotMatch(gallery, /applyDraft|onChange\(/);
    assert.match(editor, /chatSendEnabled=\{false\}/);
    assert.doesNotMatch(editor, /bridge=/);
    assert.match(editor, /교체 대상/);
    assert.match(editor, /구조분해와 계산된 키는 직접 입력합니다/);
    assert.match(create, /대화용 인터랙티브 화면 만들기/);
    assert.doesNotMatch(create, /채팅 중 호출 컴포넌트 · 고급/);
    const previewAt = editor.indexOf("예제 미리보기");
    const applyAt = editor.indexOf("이 예제 적용");
    const advancedAt = editor.indexOf("고급 JSX 코드 및 Props");
    assert.ok(previewAt > 0 && previewAt < applyAt && applyAt < advancedAt);
  });
});
